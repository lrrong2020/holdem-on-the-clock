// Check the skins in an isolated two-player room. Real time drives the UI
// animations while a fixed server clock keeps the same hand available.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium, webkit } from 'playwright';
import { makeServer } from '../server.mjs';

const server = makeServer({publicOrigin:null, roomOptions:{now:()=>100000}});
server.listen(0,'127.0.0.1');
await once(server,'listening');
const base = 'http://127.0.0.1:' + server.address().port;
const desktop = {width:1440,height:900};
const mobile = {width:390,height:844};

async function post(context, path, data) {
  const response = await context.request.post(base + path,{data});
  assert.ok(response.ok(), await response.text());
  return response.json();
}
const skin = (page, key) => page.locator('[data-skin-option="' + key + '"]').click();
const poll = (page, path) => page.waitForResponse(r => r.url() === base + path && r.request().method() === 'GET');
const fitsViewport = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function checkTerminal(page, path) {
  await skin(page,'cli');
  const terminal = page.locator('folio-terminal');
  const log = terminal.locator('[data-terminal-log]');
  const toggle = terminal.locator('[data-terminal-toggle]');
  await terminal.locator('[data-terminal-log] > :first-child').waitFor();
  const initialText = await log.textContent();
  await page.waitForFunction(previous => document.querySelector('[data-terminal-log]').textContent !== previous,initialText);
  await toggle.click();
  assert.equal(await terminal.getAttribute('data-playing'),null);
  const pausedText = await log.textContent();
  await poll(page,path);
  assert.equal(await log.textContent(),pausedText);
  await skin(page,'document');
  await skin(page,'cli');
  assert.equal(await terminal.getAttribute('data-playing'),null,'A manual pause survives switching skins.');
  const returnedText = await log.textContent();
  await toggle.click();
  await page.waitForFunction(previous => document.querySelector('[data-terminal-log]').textContent !== previous,returnedText);
  assert.ok(await page.locator('.gw-range').isVisible());

  await page.setViewportSize(mobile);
  assert.ok(await fitsViewport(page));
  const controls = await page.locator('.gw-watch').boundingBox();
  const transcript = await terminal.boundingBox();
  assert.ok(controls.y + controls.height <= transcript.y + 1,'The mobile table remains ahead of the terminal output.');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(() => !document.querySelector('folio-terminal').hasAttribute('data-playing'));
  const reducedText = await log.textContent();
  await poll(page,path);
  assert.equal(await log.textContent(),reducedText);
  await toggle.click();
  await page.waitForFunction(previous => document.querySelector('[data-terminal-log]').textContent !== previous,reducedText);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.setViewportSize(desktop);
}

const markdown = [
  '## Rollout steps', '- Collect a **baseline**.\n- Verify the canary.',
  '| Stage | Traffic |\n| --- | --- |\n| Canary | 5% |',
  '~~~text\nheader: rev-2026\n~~~',
  ...Array.from({length:45}, (_,i) =>
    '### Checkpoint ' + (i+1) + '\n\nRecord the canary result and compare it against the baseline before raising traffic.')
].join('\n\n');

async function checkDocument(page, path, guest) {
  await skin(page,'document');
  const paper = page.locator('.gw-paper');
  const review = page.locator('.gw-review');
  const toggle = review.locator('[data-review-toggle]');
  const content = review.locator('.gw-tool-slot');
  await page.locator('[data-doc-action=edit]').click();
  await paper.locator('[name=docTitle]').fill('Release report');
  await paper.locator('[name=docBody]').fill(markdown);
  await paper.locator('[data-doc-action=save]').click();
  await paper.getByRole('heading',{name:'Rollout steps',exact:true}).waitFor();
  assert.equal(await paper.locator('li strong').innerText(),'baseline');
  assert.equal(await paper.getByRole('cell',{name:'5%',exact:true}).count(),1);
  assert.equal(await paper.locator('pre code').innerText(),'header: rev-2026');
  assert.equal(await paper.locator('h3').count(),45);

  for (const viewport of [desktop,mobile]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => scrollTo(0,0));
    const panel = await review.boundingBox();
    const doc = await paper.boundingBox();
    if (viewport === desktop) assert.ok(doc.x + doc.width <= panel.x + 1,'Desktop places the review beside the document.');
    else assert.ok(panel.y + panel.height <= doc.y + 1,'Mobile places the review above the document.');
    assert.ok(await fitsViewport(page));

    await page.evaluate(() => window.scrollTo(0,1200));
    await page.waitForFunction(() => window.scrollY >= 1199);
    const pinned = await review.boundingBox();
    assert.ok(pinned.y >= 0 && pinned.y + pinned.height <= viewport.height + 1,'Review remains fully within the scrolled viewport.');
    const paperBefore = await paper.boundingBox();
    await page.evaluate(() => window.scrollBy(0,350));
    await page.waitForFunction(() => window.scrollY >= 1549);
    assert.ok(Math.abs((await review.boundingBox()).y - pinned.y) <= 1,'Review remains pinned while the document scrolls.');
    assert.ok((await paper.boundingBox()).y < paperBefore.y - 300);
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'),'false');
    assert.ok(!(await content.isVisible()));
    assert.ok((await review.boundingBox()).height < pinned.height / 2);
    await poll(page,path);
    assert.equal(await toggle.getAttribute('aria-expanded'),'false');
    await toggle.click();
    assert.ok(await content.isVisible());
  }

  await review.locator('[data-play=call]').click();
  await review.locator('[data-play=call]').waitFor({state:'detached'});
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  const other = await (await guest.request.get(base+path)).json();
  assert.equal(other.hand.actorId,other.me.id);
  await post(guest,path+'/command',{type:'action',turnKey:other.turnKey,action:{type:'raise',amount:30}});
  await review.locator('[data-play=call]').waitFor();
  assert.equal(await toggle.getAttribute('aria-expanded'),'true','A new decision reopens the margin.');
  assert.ok(await review.locator('.gw-review-turn').isVisible());
  assert.ok(await page.evaluate(() => scrollY > 750),'Turn notification keeps the reader in the document.');
  await page.setViewportSize(desktop);
}

async function selectRecord(page, number) {
  const nav = page.locator('[data-ui=nav]');
  if (await nav.isVisible()) await nav.click();
  await page.locator('#sidebar [data-record="' + number + '"]').click();
}

async function checkSecondaryDocuments(page, path, otherPage) {
  const paper = page.locator('.gw-paper');
  const title = 'Receiving schedule', heading = 'Thursday deliveries';
  await selectRecord(page,1);
  await paper.getByRole('heading',{name:'Cache key review',exact:true}).waitFor();
  await page.locator('[data-doc-action=edit]').click();
  await paper.locator('[name=docTitle]').fill(title);
  await paper.locator('[name=docBody]').fill('## ' + heading + '\n\n- **Dock B** opens at noon.');
  await poll(page,path);
  assert.ok(await paper.locator('[name=docBody]').evaluate(e=>e===document.activeElement));
  await page.locator('[data-doc-action=save]').click();
  await paper.getByRole('heading',{name:heading,level:2}).waitFor();
  assert.equal(await paper.locator('li strong').innerText(),'Dock B');
  assert.equal(await page.locator('#sidebar [data-record="1"] .thread-title').innerText(),title);
  assert.ok(await page.locator('.gw-review [data-play=call]').isVisible());

  for (const [i,original] of [[2,'Tail latency budget'],[3,'Canary observation window'],[4,'API rollout checklist']]) {
    await selectRecord(page,i);
    await paper.getByRole('heading',{name:original,level:1}).waitFor();
    assert.ok(await page.locator('[data-doc-action=edit]').isVisible());
  }
  await selectRecord(page,1);
  await page.reload();
  await paper.getByRole('heading',{name:title,level:1}).waitFor();
  assert.equal(await paper.locator('li strong').innerText(),'Dock B','Reload reopens the selected document.');
  await selectRecord(page,0);
  await paper.getByRole('heading',{name:'Release report',level:1}).waitFor();
  assert.equal(await paper.locator('h3').count(),45,'The primary document keeps its own Markdown.');
  await selectRecord(page,1);
  await paper.getByRole('heading',{name:title,level:1}).waitFor();
  assert.equal(await paper.locator('li strong').innerText(),'Dock B');

  // Open the other seat with the same browser-local documents but its own session
  // cookie. Separate empty storage alone would not verify player scoping.
  const profile = await page.context().storageState();
  const items = profile.origins.find(origin=>origin.origin===base).localStorage;
  await otherPage.addInitScript(entries=>{
    for (const {name,value} of entries) if (localStorage.getItem(name)===null) localStorage.setItem(name,value);
  }, items);
  await otherPage.goto(page.url());
  await skin(otherPage,'document');
  await selectRecord(otherPage,1);
  await otherPage.locator('.gw-seat-list tr').filter({hasText:/Guest\s*you/}).waitFor();
  const otherPaper = otherPage.locator('.gw-paper');
  await otherPaper.getByRole('heading',{name:'Cache key review',level:1}).waitFor();
  assert.ok(!(await otherPaper.innerText()).includes(heading));
  await selectRecord(otherPage,0);
  await selectRecord(page,0);
}

async function checkChat(page, path, otherPage) {
  await skin(page,'chat');
  const stream = page.locator('.gw-chat-stream');
  const user = stream.locator('[data-chat-message][data-role=user]');
  const assistant = stream.locator('[data-chat-message][data-role=assistant]');
  const activity = stream.locator('[data-chat-activity]');
  const textarea = stream.locator('[name=chatMessage]');
  const draft = 'Local rollout checkpoint 84';
  const answer = 'Review the second canary batch tomorrow.';
  const title = 'Release checkpoint review';
  const outbound = [];
  page.on('request', request => {
    const payload = (request.postData() || '') + request.url();
    if (payload.includes(draft) || payload.includes(answer)) outbound.push(request.url());
  });
  const status = stream.locator('[data-chat-status]');
  await status.waitFor();
  const idleStatus = await status.innerText();
  await page.waitForFunction(previous => document.querySelector('[data-chat-status]').innerText !== previous,idleStatus);

  for (const [message,text] of [[user.first(),draft],[assistant.first(),answer]]) {
    await message.locator('[data-chat-edit]').click();
    await textarea.fill(text);
    await poll(page,path);
    assert.ok(await textarea.evaluate(el => document.activeElement === el));
    await stream.locator('[data-chat-save]').click();
    assert.ok((await message.innerText()).includes(text));
  }
  await stream.locator('[data-chat-title-edit]').click();
  await textarea.fill(title);
  await stream.locator('[data-chat-save]').click();
  assert.equal(await stream.locator('h1').innerText(),title);
  await page.locator('[data-record="1"]').click();
  await stream.locator('[data-chat-title-edit]').click();
  const secondary = 'Service <em>handover</em>';
  await textarea.fill(secondary);
  await stream.locator('[data-chat-save]').click();
  assert.ok((await page.locator('[data-record="1"]').innerText()).includes(secondary));
  await user.first().locator('[data-chat-edit]').click();
  await textarea.fill('Other conversation');
  await stream.locator('[data-chat-save]').click();
  await page.locator('[data-record="0"]').click();
  assert.equal(await stream.locator('h1').innerText(),title);
  await user.first().locator('[data-chat-edit]').click();
  await textarea.fill('Discarded change');
  await stream.locator('[data-chat-cancel]').click();
  assert.ok((await user.first().innerText()).includes(draft));
  await skin(page,'document');
  await skin(page,'chat');
  assert.ok((await assistant.first().innerText()).includes(answer));
  await page.reload();
  await user.first().waitFor();
  assert.equal(await stream.locator('h1').innerText(),title);
  assert.ok((await user.first().innerText()).includes(draft));
  assert.ok((await assistant.first().innerText()).includes(answer));

  await skin(otherPage,'chat');
  const otherMessages = otherPage.locator('[data-chat-message]');
  await otherMessages.first().waitFor();
  assert.ok(!(await otherMessages.allTextContents()).join(' ').includes(draft));
  assert.ok(!(await otherMessages.allTextContents()).join(' ').includes(answer));
  await otherPage.close();

  await page.setViewportSize(mobile);
  assert.ok(await fitsViewport(page));
  const initialCount = await assistant.count();
  const question = 'Compare release latency by region';
  await stream.locator('.gw-composer [name=question]').fill(question);
  await stream.locator('.gw-composer button[type=submit]').click();
  await user.last().getByText(question,{exact:true}).waitFor();
  assert.equal(await activity.getAttribute('data-phase'),'thinking');
  await page.waitForFunction(() => document.querySelector('[data-chat-activity]').dataset.phase === 'writing');
  await assistant.nth(initialCount).waitFor();
  const writing = await assistant.nth(initialCount).innerText();
  await page.waitForFunction(({count,previous}) => {
    const message = document.querySelectorAll('[data-chat-message][data-role=assistant]')[count];
    return message?.innerText.length > previous.length;
  },{count:initialCount,previous:writing});
  await stream.locator('[data-chat-pause]').click();
  assert.equal(await activity.getAttribute('data-phase'),'paused');
  const paused = await assistant.nth(initialCount).innerText();
  await poll(page,path);
  assert.equal(await assistant.nth(initialCount).innerText(),paused);
  await stream.locator('[data-chat-pause]').click();
  await page.waitForFunction(() => document.querySelector('[data-chat-activity]').dataset.phase !== 'writing');
  const reply = await assistant.nth(initialCount).innerText();
  assert.ok(reply.trim().length > 10);
  await page.reload();
  await assistant.nth(initialCount).waitFor();
  assert.equal(await assistant.nth(initialCount).innerText(),reply);
  assert.ok((await user.last().innerText()).includes(question));
  assert.ok(await fitsViewport(page));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(() => document.querySelector('[data-chat-activity]').dataset.phase === 'idle');
  assert.ok(!(await stream.locator('[data-chat-pause]').isVisible()));
  const followup = 'When should we review the next canary?';
  await stream.locator('.gw-composer [name=question]').fill(followup);
  await stream.locator('.gw-composer [name=question]').press('Enter');
  await user.last().getByText(followup,{exact:true}).waitFor();
  assert.equal(await activity.getAttribute('data-phase'),'idle');
  assert.ok((await assistant.nth(initialCount+1).locator('.chat-body').innerText()).length > 10);
  assert.equal(await stream.locator('.chat-streaming').count(),0);
  assert.deepEqual(outbound,[],'Personal conversation edits remain in the browser.');
}

async function exercise(engine) {
  const browser = await engine.launch();
  try {
    const host = await browser.newContext({viewport:desktop});
    const guest = await browser.newContext({viewport:mobile});
    const room = await post(host,'/api/create',{name:'Host'});
    const path = '/api/rooms/' + room.roomId;
    const peer = await post(guest,path+'/join',{name:'Guest'});
    await post(host,path+'/command',{type:'approve',id:peer.me.id});
    const start = await post(host,path+'/command',{type:'start'});
    assert.equal(start.hand.actorId,start.me.id);
    const page = await host.newPage();
    const errors = [];
    page.on('pageerror',error => errors.push(error.message));
    page.on('console',message => { if (message.type() === 'error') errors.push(message.text()); });
    page.setDefaultTimeout(7000);
    await page.goto(base + '/r/' + room.roomId);
    await checkTerminal(page,path);
    await checkDocument(page,path,guest);
    const otherPage = await guest.newPage();
    otherPage.setDefaultTimeout(7000);
    await checkSecondaryDocuments(page,path,otherPage);
    await checkChat(page,path,otherPage);
    assert.deepEqual(errors,[]);
    console.log('PASS ' + engine.name() + ' terminal animation, pause and reduced motion; primary and secondary Markdown, per-player documents and sticky review with real decisions; editable private chat, streaming, pause, skin changes and reload.');
  } finally { await browser.close(); }
}

try {
  const engines = [chromium,webkit].filter(engine => !process.argv[2] || process.argv[2] === engine.name());
  assert.ok(engines.length,'Expected chromium or webkit');
  for (const engine of engines) await exercise(engine);
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
