// Seed a long-running nine-person hand through the public API, then play the
// host's decision in a real phone-sized browser. No external services are used.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium, request } from 'playwright';
import { makeServer } from '../server.mjs';

const server=makeServer({publicOrigin:null});
server.listen(0,'127.0.0.1');
await once(server,'listening');
const base='http://127.0.0.1:'+server.address().port;
const clients=[];
const players=new Map();
let browser;
async function post(client,path,data) {
  const response=await client.post(base+path,{data});
  assert.ok(response.ok(),await response.text());
  return response.json();
}
try {
  browser=await chromium.launch();
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const host=context.request;
  const created=await post(host,'/api/create',{name:'Platform lead'});
  const prefix='/api/rooms/'+created.roomId;
  const command=(who,type,fields={})=>post(who,prefix+'/command',{type,...fields});
  players.set(created.me.id,host);
  for (const name of ['Mina','Ren','Theo','Sol','Jun','Ari','Kai','Night shift']) {
    const guest=await request.newContext();
    clients.push(guest);
    const joined=await post(guest,prefix+'/join',{name});
    players.set(joined.me.id,guest);
    await command(host,'approve',{id:joined.me.id});
  }
  await command(host,'settings',{baseSeconds:120,initialCards:2,cardSeconds:15});
  let state=await command(host,'start');
  while (state.hand.street==='preflop' || state.hand.actorId!==created.me.id) {
    assert.notEqual(state.hand.street,'complete');
    const actor=players.get(state.hand.actorId);
    const own=await (await actor.get(base+prefix)).json();
    const action={type:own.hand.legal.check?'check':'call'};
    state=await command(actor,'action',{turnKey:own.turnKey,action});
  }
  const original=await (await host.get(base+prefix)).json();
  assert.ok(original.hand.events.length>=17);
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/r/'+created.roomId);
  await page.locator('[data-play="bet"]').waitFor();
  assert.match(await page.locator('.gw-actor').innerText(),/BTN Platform lead/);
  assert.match(await page.locator('.gw-next').innerText(),/After a check · round closes/);
  const trace=page.locator('.gw-trace');
  await trace.locator('summary').click();
  const events=original.hand.events.filter(e=>e.id && e.street===original.hand.street);
  assert.equal(await trace.locator('li').count(),events.length);
  assert.equal(await trace.locator('li').first().innerText(),'SB Check');
  await page.locator('.gw-sizing').waitFor({state:'visible'});
  await page.locator('[data-pct="75"]').click();
  const amount=await page.locator('.gw-amount').inputValue();
  const pot=await page.locator('[data-pot-total]').getAttribute('data-pot-total');
  for (const skin of ['document','cli','chat']) {
    await page.locator('[data-skin-option="'+skin+'"]').click();
    await page.locator('[data-ui="language"]').click();
    assert.equal(await page.locator('.gw-seat-list tbody tr').count(),9);
    assert.equal(await page.locator('.gw-hand-data .gw-card').count(),5);
    assert.equal(await page.locator('[data-pot-total]').getAttribute('data-pot-total'),pot);
    assert.equal(await page.locator('.gw-amount').inputValue(),amount);
    assert.equal(await page.locator('[data-pct="75"]').getAttribute('aria-pressed'),'true');
    assert.ok(await page.locator('[data-clock]').innerText());
    assert.ok(await trace.evaluate(details=>details.open));
    assert.equal(await trace.locator('li').count(),events.length);
    // The application brings the current actor into view on the next animation frame.
    await page.waitForFunction(()=>{
      const bounds=document.querySelector('[data-play="bet"]')?.getBoundingClientRect();
      return bounds && bounds.top>=0 && bounds.bottom<=innerHeight+1;
    },null,{timeout:2000});
    const width=await page.evaluate(()=>document.documentElement.scrollWidth);
    assert.ok(width<=391,'Horizontal overflow on '+skin+': '+width);
  }
  const after=await (await host.get(base+prefix)).json();
  assert.equal(after.turnKey,original.turnKey);
  assert.equal(after.clock.deadline,original.clock.deadline);
  assert.deepEqual(after.hand.events,original.hand.events);
  await page.locator('[data-play="bet"]').click();
  await page.locator('[data-play="bet"]').waitFor({state:'detached'});
  assert.match(await page.locator('.gw-next').innerText(),/BB Ren/);
  const end=await (await host.get(base+prefix)).json();
  assert.equal(end.hand.events.at(-1).type,'bet');
  assert.equal(end.hand.events.at(-1).amount,Math.round(Number(amount)*10));
  assert.deepEqual(errors,[]);
  console.log('PASS nine occupied seats, expandable full street log, next actor and closing round, mobile turn controls, preserved sizing across skins and languages, original deadline, one confirmed bet.');
} finally {
  await Promise.all(clients.map(c=>c.dispose()));
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
