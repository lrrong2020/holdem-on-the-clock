// Exercise two independent browser identities on the same table with real hand records.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { makeServer } from '../server.mjs';

const server = makeServer({publicOrigin:null, roomOptions:{now:()=>100000}});
server.listen(0,'127.0.0.1');
await once(server,'listening');
const base = 'http://127.0.0.1:' + server.address().port;
let browser;
async function post(client, path, data) {
  const response = await client.request.post(base+path, {data});
  assert.ok(response.ok(), await response.text());
  return response.json();
}
const paper = page => page.locator('.gw-paper');
const docButton = (page, action) => page.locator('[data-doc-action="'+action+'"]');
const skin = (page, name) => page.locator('[data-skin-option="'+name+'"]').click();
const toggleLang = page => page.locator('[data-ui=language]').click();

async function editDocuments(hostPage, guestPage) {
  await Promise.all([hostPage,guestPage].map(page=>skin(page,'document')));
  const title = 'Private draft North';
  const body = '## Review\n\nRisk marker **NORTH_INTERNAL**\n\n- Primary\n- Secondary\n\n<b>Literal markup</b>';
  const leaks = [];
  for (const page of [hostPage,guestPage]) page.on('request',request=>{
    if ((request.postData() || '').includes('NORTH_INTERNAL') || request.url().includes('NORTH_INTERNAL')) leaks.push(request.url());
  });

  await docButton(hostPage,'edit').click();
  await hostPage.locator('[name=docTitle]').fill(title);
  await hostPage.locator('[name=docBody]').fill(body);
  // Observe a room poll after the user started typing. It should preserve the actual input.
  await hostPage.waitForResponse(res => /\/api\/rooms\/[\w-]+$/.test(res.url()) && res.request().method()==='GET');
  assert.ok(await hostPage.locator('[name=docBody]').evaluate(el=>el===document.activeElement));
  await skin(hostPage,'chat');
  await skin(hostPage,'document');
  assert.equal(await hostPage.locator('[name=docBody]').inputValue(),body);
  await docButton(hostPage,'save').click();
  assert.equal(await paper(hostPage).locator('h1').innerText(),title);
  assert.equal(await hostPage.locator('#topbar .crumb b').innerText(),title);
  assert.equal(await hostPage.title(),title+' · Folio');
  const prose = paper(hostPage).locator('.gw-custom-prose');
  assert.equal(await prose.locator('h2').innerText(),'Review');
  assert.equal(await prose.locator('strong').innerText(),'NORTH_INTERNAL');
  assert.deepEqual(await prose.locator('li').allTextContents(),['Primary','Secondary']);
  assert.ok((await prose.innerText()).includes('<b>Literal markup</b>'));
  assert.equal(await prose.locator('b').count(),0);
  assert.ok(!(await paper(guestPage).innerText()).includes('NORTH_INTERNAL'));

  await docButton(guestPage,'edit').click();
  await guestPage.locator('[name=docTitle]').fill('Guest only');
  await guestPage.locator('[name=docBody]').fill('Local timeline');
  await docButton(guestPage,'save').click();
  await toggleLang(hostPage);
  assert.equal(await paper(hostPage).locator('h1').innerText(),title);
  await Promise.all([hostPage.reload(),guestPage.reload()]);
  await hostPage.locator('.gw-custom-prose').waitFor();
  assert.equal(await prose.locator('strong').innerText(),'NORTH_INTERNAL');
  assert.equal(await paper(guestPage).locator('h1').innerText(),'Guest only');
  await docButton(hostPage,'edit').click();
  assert.equal(await hostPage.locator('[name=docBody]').inputValue(),body);
  await docButton(hostPage,'reset').click();
  await docButton(hostPage,'cancel').click();
  assert.equal(await paper(hostPage).locator('h1').innerText(),title);
  await toggleLang(hostPage);
  assert.deepEqual(leaks,[]);
  console.log('PASS document Markdown preview, source round-trip, literal HTML, polling and skin change while typing, cancel, per-player isolation and reload in both languages');
}

const guiHistory = page => page.locator('.gw-tool [data-cmd=history]').click();
const selected = (page, number) => page.locator('.hh-heading h3').filter({hasText:new RegExp('#'+number+'$')}).waitFor();
const option = (page, number) => page.locator('#hand-select option[value="'+number+'"]');
function shownCard(card) {
  const suit = {s:'♠',h:'♥',c:'♣',d:'♦'}[card[1]];
  return (card[0]==='T' ? '10' : card[0]) + suit;
}
async function validateFold(page, playerId, opponent, details) {
  await selected(page,details.number);
  const own = details.players.find(p=>p.id===playerId);
  const cards = own.cards.map(shownCard).join(' ');
  const net = own.stack - own.startStack;
  const sign = net>0 ? '+' : '−';
  const text = await option(page,details.number).textContent();
  assert.equal(text, '#'+details.number+' · '+cards+' · '+sign+'0.5 BB · Pot 1 BB');
  assert.equal(await page.locator('[data-history-pot]').getAttribute('data-history-pot'),'1');
  assert.equal(await page.locator('[data-history-net]').getAttribute('data-history-net'),String(net/10));
  assert.equal(await page.locator('.hh-overview .gw-card').count(),2);
  assert.equal(await page.locator('.hh-seats tr').filter({hasText:opponent}).locator('.gw-card').count(),0);
  assert.equal(await page.locator('.hh-street').count(),1);
  assert.match(await page.locator('.hh-pools').innerText(),/Uncalled bet returned/);
}

try {
  browser = await chromium.launch();
  const host = await browser.newContext({viewport:{width:1440,height:980}});
  const guest = await browser.newContext({viewport:{width:390,height:844}});
  const opened = await post(host,'/api/create',{name:'Ari'});
  const path = '/api/rooms/' + opened.roomId;
  const guestJoined = await post(guest,path+'/join',{name:'Dee'});
  const command = (client,type,values={}) => post(client,path+'/command',{type,...values});
  await command(host,'approve',{id:guestJoined.me.id});
  const players = new Map([[opened.me.id,host],[guestJoined.me.id,guest]]);
  const act = (state,type) => command(players.get(state.hand.actorId),'action',{turnKey:state.turnKey,action:{type}});
  for(let i=0;i<26;i++) await act(await command(host,'next'),'fold');
  const hostPage = await host.newPage(), guestPage = await guest.newPage();
  const errors = [];
  for(const page of [hostPage,guestPage]) page.on('pageerror',err=>errors.push(err.message));
  const roomUrl = base+'/r/'+opened.roomId;
  await Promise.all([hostPage.goto(roomUrl),guestPage.goto(roomUrl)]);
  await editDocuments(hostPage,guestPage);

  await Promise.all([hostPage,guestPage].map(guiHistory));
  for(const [page, client, selfId, other] of [[hostPage,host,opened.me.id,'Dee'],[guestPage,guest,guestJoined.me.id,'Ari']]) {
    await selected(page,26);
    const hand = await (await client.request.get(base+path+'/history/26')).json();
    await validateFold(page,selfId,other,hand);
    assert.ok(await page.locator('#history-next').isDisabled());
    assert.equal(await page.locator('#hand-select option').count(),24);
  }
  await hostPage.locator('#history-prev').click();
  await selected(hostPage,25);
  await hostPage.locator('#history-next').click();
  await selected(hostPage,26);
  await hostPage.locator('#history-item').focus();
  await hostPage.keyboard.press('ArrowLeft');
  await selected(hostPage,25);
  await hostPage.keyboard.press('ArrowRight');
  await selected(hostPage,26);
  // Hold the first detail response, navigate again and release it out of order.
  // A slow fetch for an earlier selection must not replace the latest hand.
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  const delayed = '**' + path + '/history/19';
  await hostPage.route(delayed, async route => {
    await hold;
    await route.continue();
  });
  const started = hostPage.waitForRequest(req => req.url().endsWith('/history/19'));
  await hostPage.locator('#hand-select').selectOption('19');
  await started;
  await hostPage.locator('#history-prev').click();
  await selected(hostPage,18);
  const responded = hostPage.waitForResponse(res => res.url().endsWith('/history/19'));
  release();
  await responded;
  await hostPage.unroute(delayed);
  await selected(hostPage,18);
  assert.equal(await hostPage.locator('#hand-select').inputValue(),'18');
  assert.equal(await hostPage.locator('[data-history-net]').getAttribute('data-history-net'),'0.5');
  await hostPage.locator('#hand-select').selectOption('3');
  await hostPage.locator('#history-prev').click();
  await selected(hostPage,2);
  assert.equal(await hostPage.locator('#hand-select option').count(),26);
  await hostPage.locator('#history-prev').click();
  await selected(hostPage,1);
  assert.ok(await hostPage.locator('#history-prev').isDisabled());
  await guestPage.locator('#history-older').click();
  await guestPage.locator('#hand-select').selectOption('1');
  await selected(guestPage,1);

  // Settle a new hand while both viewers are reading an old one.
  let state = await command(host,'next');
  while(state.hand.street!=='complete') {
    const actorState = await (await players.get(state.hand.actorId).request.get(base+path)).json();
    state = await act(state,actorState.hand.legal.check ? 'check' : 'call');
  }
  for(const page of [hostPage,guestPage]) {
    await option(page,27).waitFor({state:'attached'});
    assert.equal(await page.locator('#hand-select').inputValue(),'1');
    await page.locator('#hand-select').selectOption('27');
    await selected(page,27);
    assert.deepEqual(await page.locator('.hh-street').evaluateAll(nodes=>nodes.map(el=>el.dataset.historyStreet)),
      ['preflop','flop','turn','river']);
    assert.equal(await page.locator('.hh-board .gw-card').count(),5);
    assert.equal(await page.locator('.hh-seats .gw-card').count(),4);
    assert.equal(await page.locator('.hh-seats .hh-rank').count(),2);
    assert.equal(await page.locator('[data-history-pot]').getAttribute('data-history-pot'),'2');
  }
  assert.ok(await guestPage.evaluate(()=>document.documentElement.scrollWidth<=391));
  if (process.env.E2E_SCREENSHOTS) {
    const directory = resolve(process.env.E2E_SCREENSHOTS);
    await mkdir(directory,{recursive:true});
    await hostPage.getByRole('dialog').press('Escape');
    await toggleLang(hostPage);
    await guiHistory(hostPage);
    await selected(hostPage,27);
    await option(hostPage,27).filter({hasText:'底池'}).waitFor({state:'attached'});
    await hostPage.screenshot({path:resolve(directory,'history-review.png')});
  }

  // Switch actual seat identity in the guest's browser without clearing its saved documents.
  await guestPage.getByRole('dialog').press('Escape');
  await command(guest,'leave');
  const late = await post(guest,path+'/join',{name:'Dee'});
  await command(host,'approve',{id:late.me.id});
  await guestPage.reload();
  await paper(guestPage).locator('h1').filter({hasText:'Cache migration review'}).waitFor();
  await guiHistory(guestPage);
  await selected(guestPage,27);
  assert.match(await option(guestPage,27).textContent(),/Not dealt in/);
  assert.equal(await guestPage.locator('[data-history-net]').getAttribute('data-history-net'),'');
  assert.equal(await guestPage.locator('.hh-overview .gw-card').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS personal history summaries, positive and negative net, folded privacy, previous/next/keyboard, pagination, mobile view, stable selection on newly settled hand, showdown streets, and not-dealt-in result for new identity');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
