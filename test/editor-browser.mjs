// Exercise a single live decision while unrelated room events and time-bank polls arrive.
// Only the fixture clock advances artificially. Input, dragging, approvals and the
// confirmed wager travel through the real browser, HTTP service and poker engine.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium, request } from 'playwright';
import { makeServer } from '../server.mjs';

let now = Date.now();
const server = makeServer({publicOrigin:null, roomOptions:{now:()=>now}});
server.listen(0,'127.0.0.1');
await once(server,'listening');
const base = 'http://127.0.0.1:' + server.address().port;
const guestClients = [];
let browser;

async function post(client, path, data) {
  const result = await client.post(path,{data});
  assert.ok(result.ok(),await result.text());
  return result.json();
}

async function checkDrag(page, amount, slider) {
  await slider.press('Home');
  assert.equal(await amount.inputValue(),'2');
  await slider.press('ArrowRight');
  assert.equal(await amount.inputValue(),'2.5');

  // Collect actual changes delivered by a pointer drag, including the odd all-in endpoint.
  await page.evaluate(() => {
    window.dragValues = [];
    document.addEventListener('input',event => {
      if (event.target.matches('.gw-range')) {
        window.dragValues.push(Number(document.querySelector('.gw-amount').value));
      }
    });
  });
  await slider.scrollIntoViewIfNeeded();
  const bounds = await slider.boundingBox();
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + 1,y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width - 1,y,{steps:55});
  await page.mouse.up();
  assert.deepEqual(
    [...new Set(await page.evaluate(()=>window.dragValues))],
    [...Array.from({length:17},(_,i)=>2+i/2),10.3],
    'drag advances by 0.5 BB and can still select the exact all-in'
  );
  assert.equal(await amount.inputValue(),'10.3');
}

try {
  browser = await chromium.launch();
  const context = await browser.newContext({viewport:{width:1360,height:900}});
  const host = context.request;
  const room = await post(host,base+'/api/create',{name:'Host'});
  const endpoint = base + '/api/rooms/' + room.roomId;
  const command = (type,extra={}) => post(host,endpoint+'/command',{type,...extra});
  async function admit(name) {
    const guest = await request.newContext();
    guestClients.push(guest);
    const joined = await post(guest,endpoint+'/join',{name});
    await command('approve',{id:joined.me.id});
  }
  await admit('Opponent');
  await command('stack',{id:room.me.id,amount:103});
  await command('settings',{baseSeconds:15,initialCards:2,cardSeconds:10});
  const start = await command('start');

  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/r/'+room.roomId);
  const amount = page.locator('.gw-amount');
  const slider = page.locator('.gw-range');
  const confirm = page.locator('[data-play="raise"]');
  await amount.waitFor({state:'visible'});
  await checkDrag(page,amount,slider);
  for (const skin of ['chat','document','cli']) {
    await page.locator('[data-skin-option="'+skin+'"]').click();
    await amount.waitFor({state:'visible'});
    assert.ok(await slider.isVisible());
    await amount.fill('');
    assert.ok(await confirm.isDisabled());
    await amount.pressSequentially('3.');
    const before = await amount.inputValue();
    assert.equal(before,'3.');

    // Another seat appears on the same turn. No user action or explicit refocus on this tab.
    const newlySeated = 'Seat '+skin;
    await admit(newlySeated);
    await page.locator('.gw-seat-list').getByText(newlySeated,{exact:true}).waitFor();
    assert.equal(await amount.inputValue(),before);
    assert.ok(await amount.evaluate(el=>el===document.activeElement));
    assert.equal(await amount.evaluate(el=>el.selectionStart),before.length);
    await page.keyboard.type('1');
    assert.equal(await amount.inputValue(),'3.1');
    await page.keyboard.press('ArrowLeft');
    assert.deepEqual(
      await amount.evaluate(el=>[el.value,el.selectionStart,el.selectionEnd]),['3.1',2,2]
    );
    assert.equal(await page.locator('[data-pot-total]').getAttribute('data-pot-total'),'1.5');
    assert.equal((await (await host.get(endpoint)).json()).turnKey,start.turnKey);
  }

  // A time card starts mid-edit. Keep an actual text selection, not just a whole-value snapshot.
  await amount.press('Shift+ArrowLeft');
  assert.deepEqual(await amount.evaluate(el=>[el.selectionStart,el.selectionEnd]),[1,2]);
  now = start.clock.deadline;
  await page.locator('[data-clock]').filter({hasText:'Time bank'}).waitFor();
  assert.deepEqual(await amount.evaluate(el=>[el===document.activeElement,el.value,el.selectionStart,el.selectionEnd]),[true,'3.1',1,2]);
  await amount.fill('30');
  assert.ok(await confirm.isDisabled());
  await amount.press('Tab');
  assert.equal(await amount.inputValue(),'30','Leaving an invalid draft must not silently place or replace the wager.');
  assert.equal((await (await host.get(endpoint)).json()).turnKey,start.turnKey);
  await amount.fill('3.1');
  await confirm.click();
  await confirm.waitFor({state:'detached'});
  const after = await (await host.get(endpoint)).json();
  assert.equal(after.hand.events.length,start.hand.events.length+1);
  assert.equal(after.hand.events.at(-1).type,'raise');
  assert.equal(after.hand.events.at(-1).to,31);
  assert.equal(after.hand.events.at(-1).amount,26);
  assert.equal(await page.locator('[data-pot-before]').getAttribute('data-pot-before'),'1.5');
  assert.equal(await page.locator('[data-pot-paid]').getAttribute('data-pot-paid'),'2.6');
  assert.equal(await page.locator('[data-raise-by]').getAttribute('data-raise-by'),'2.1');
  assert.equal(await page.locator('[data-pot-total]').getAttribute('data-pot-total'),'4.1');
  assert.deepEqual(errors,[]);
  console.log('PASS exact half-BB pointer drag plus off-grid all-in, visible sizing in all skins, same-turn roster/clock/caret preservation, one confirmed 0.1-BB-precision raise and separate pot figures.');
} finally {
  await Promise.all(guestClients.map(client=>client.dispose()));
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
