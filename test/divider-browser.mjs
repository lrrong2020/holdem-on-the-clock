// Drive the actual dividers in a two-player room while the first player is on the clock.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {chromium, webkit} from 'playwright';
import {makeServer} from '../server.mjs';

const server = makeServer({publicOrigin:null, roomOptions:{now:() => 100000}});
server.listen(0,'127.0.0.1');
await once(server,'listening');
const base = 'http://127.0.0.1:' + server.address().port;
const desktop = {width:1440,height:900};
const tablet = {width:1024,height:768};
const mobile = {width:390,height:844};
const splits = [
  {name:'sidebar',skin:'chat',left:'#sidebar',right:'#main'},
  {name:'table',skin:'chat',left:'.gw-seat-list',right:'.gw-hand-live'},
  {name:'document',skin:'document',left:'.gw-paper',right:'.gw-review'},
  {name:'terminal',skin:'cli',left:'.gw-term-code',right:'.gw-watch'}
];

async function post(context,path,data) {
  const response = await context.request.post(base+path,{data});
  assert.ok(response.ok(),await response.text());
  return response.json();
}
const skin = (page,key) => page.locator('[data-skin-option="' + key + '"]').click();
const splitter = (page,name) => page.locator('folio-splitter[data-split="' + name + '"]');
const widths = async (page,split) => Promise.all([split.left,split.right].map(async selector =>
  (await page.locator(selector).boundingBox()).width));
const closeTo = (actual,expected,message) =>
  assert.ok(Math.abs(actual-expected) < 2,message+' (actual '+actual+', expected '+expected+')');
const preference = (page,name) => page.evaluate(key=>localStorage.getItem('folio.split.v1.'+key),name);

async function pointerPosition(page,handle) {
  if (!(await handle.isVisible())) await handle.waitFor();
  // Long articles have long dividers. Look for an exposed part of the handle
  // instead of scrolling to its midpoint or clicking under a sticky overlay.
  const find = () => handle.evaluate(el => {
    const rect = el.getBoundingClientRect();
    const x = (rect.left+rect.right)/2;
    const top = Math.max(0,rect.top)+2;
    const bottom = Math.min(innerHeight,rect.bottom)-2;
    if (bottom<=top) return null;
    for (const fraction of [.5,.25,.75,.1,.9]) {
      const y = top+(bottom-top)*fraction;
      if (el.contains(document.elementFromPoint(x,y))) return {x,y};
    }
    return null;
  });
  let point = await find();
  if (!point) {
    await handle.scrollIntoViewIfNeeded();
    point = await find();
  }
  assert.ok(point,'The divider has an unobstructed pointer target.');
  return point;
}

async function beginDrag(page,handle,delta) {
  const {x,y} = await pointerPosition(page,handle);
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x+delta,y,{steps:8});
}

async function checkSplit(page,split,path,context) {
  await skin(page,split.skin);
  const handle = splitter(page,split.name);
  await handle.waitFor();
  assert.equal(await handle.getAttribute('role'),'separator');
  assert.equal(await handle.getAttribute('aria-orientation'),'vertical');
  assert.equal(await handle.getAttribute('tabindex'),'0');
  const original = await widths(page,split);
  await beginDrag(page,handle,52);
  const wider = await widths(page,split);
  assert.ok(wider[0]-original[0]>42 && original[1]-wider[1]>42,split.name+' resizes both panes during pointer movement.');
  assert.equal(await preference(page,split.name),null,'An unfinished drag leaves the preference untouched.');
  await page.mouse.up();
  const firstPreference = await preference(page,split.name);
  assert.notEqual(firstPreference,null);
  const hit = await pointerPosition(page,handle);
  await page.mouse.dblclick(hit.x,hit.y);
  closeTo((await widths(page,split))[0],original[0],'Double-click resets pane widths.');
  assert.equal(await preference(page,split.name),null);
  await beginDrag(page,handle,52);
  await page.mouse.up();
  await beginDrag(page,handle,-79);
  const narrower = await widths(page,split);
  assert.ok(wider[0]-narrower[0]>55 && narrower[1]-wider[1]>55);
  await page.mouse.up();
  const accepted = await preference(page,split.name);
  assert.notEqual(accepted,firstPreference);

  // WebKit has no Playwright protocol gesture for pointer cancellation. Start
  // a native drag and deliver its cancellation event with the actual pointer ID.
  await handle.evaluate(el => el.addEventListener('pointerdown',e => { el.dataset.testPointer = String(e.pointerId); },{once:true}));
  await beginDrag(page,handle,60);
  assert.ok((await widths(page,split))[0]-narrower[0] > 50);
  await handle.evaluate(el => el.dispatchEvent(new PointerEvent('pointercancel',{
    pointerId:Number(el.dataset.testPointer),pointerType:'mouse',bubbles:true,isPrimary:true
  })));
  await page.mouse.up();
  closeTo((await widths(page,split))[0],narrower[0],'Cancellation restores the starting width.');
  assert.equal(await preference(page,split.name),accepted);

  await handle.focus();
  await page.keyboard.press('ArrowRight');
  const right = (await widths(page,split))[0];
  assert.ok(right > narrower[0]+8);
  await page.keyboard.press('ArrowLeft');
  closeTo((await widths(page,split))[0],narrower[0],'Opposite arrow keys return to the prior width.');
  await page.keyboard.press('Shift+ArrowRight');
  assert.ok((await widths(page,split))[0]-narrower[0]>=40,'Shift accelerates keyboard resizing.');
  await page.keyboard.press('Home');
  const min = (await widths(page,split))[0];
  await page.keyboard.press('ArrowLeft');
  closeTo((await widths(page,split))[0],min,'Home clamps the lower bound.');
  await page.keyboard.press('End');
  const max = (await widths(page,split))[0];
  assert.ok(max-min>40);
  await page.keyboard.press('ArrowRight');
  closeTo((await widths(page,split))[0],max,'End clamps the upper bound.');
  await page.keyboard.press('Enter');
  closeTo((await widths(page,split))[0],original[0],'Enter restores the default split.');
  assert.equal(await preference(page,split.name),null);

  if (split.name==='table') await page.locator('.gw-amount').fill('13.5');
  await beginDrag(page,handle,42);
  if (split.name==='table') {
    await post(context,path+'/command',{type:'addBot',mode:'local',name:'Bench seat'});
    await page.locator('.gw-seat-list').getByText('Bench seat',{exact:true}).waitFor();
    assert.equal(await page.locator('.gw-amount').inputValue(),'13.5');
    assert.ok(await page.locator('.gw-amount').evaluate(el => document.activeElement===el));
    assert.ok((await widths(page,split))[0]>original[0]+32,'A roster update during a drag preserves the live split.');
  }
  await page.mouse.up();
  const saved = (await widths(page,split))[0];
  await page.waitForResponse(r => r.url()===base+path && r.request().method()==='GET');
  closeTo((await widths(page,split))[0],saved,'Room polling preserves the layout.');
  await skin(page,split.skin==='chat' ? 'document' : 'chat');
  await skin(page,split.skin);
  await handle.waitFor();
  closeTo((await widths(page,split))[0],saved,'Switching skins preserves the layout.');
  await page.reload();
  await handle.waitFor();
  closeTo((await widths(page,split))[0],saved,'Reloading preserves the layout.');
  return saved;
}

async function checkResponsive(page,savedWidths) {
  await page.setViewportSize(tablet);
  for (const split of splits) {
    await skin(page,split.skin);
    const handle = splitter(page,split.name);
    await handle.waitFor();
    const [left,right] = await Promise.all([split.left,split.right].map(sel => page.locator(sel).boundingBox()));
    assert.ok(left.x+left.width <= right.x+2,split.name+' has usable side-by-side panes at tablet width.');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth+1));
  }
  await page.setViewportSize(mobile);
  for (const split of splits) {
    await skin(page,split.skin);
    await splitter(page,split.name).waitFor({state:'hidden'});
    const [left,right] = await Promise.all([split.left,split.right].map(sel => page.locator(sel).boundingBox()));
    if (split.name === 'sidebar') await page.waitForFunction(() => document.querySelector('#sidebar').getBoundingClientRect().right<=1);
    else assert.ok(left.y+left.height <= right.y+2 || right.y+right.height <= left.y+2,split.name+' panes stack on phones.');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth+1));
  }
  await page.setViewportSize(desktop);
  for (const split of splits) {
    await skin(page,split.skin);
    await splitter(page,split.name).waitFor();
    closeTo((await widths(page,split))[0],savedWidths.get(split.name),'Returning to desktop restores '+split.name+' width.');
  }
}

// Playwright exposes a native multi-step touch gesture in Chromium through
// CDP. WebKit's public touchscreen API only supports taps, so its pointer and
// responsive-layout checks use the same real mouse gestures as above.
async function checkTabletTouch(browser,context,url) {
  const tabletContext = await browser.newContext({viewport:tablet,hasTouch:true,storageState:await context.storageState()});
  try {
    const page = await tabletContext.newPage();
    await page.goto(url);
    await skin(page,'document');
    const handle = splitter(page,'document');
    const paper = page.locator('.gw-paper');
    const {x,y} = await pointerPosition(page,handle);
    const initial = (await paper.boundingBox()).width;
    const protocol = await tabletContext.newCDPSession(page);
    const touch = async (type,dx=0) => protocol.send('Input.dispatchTouchEvent',{
      type,touchPoints:type==='touchEnd' ? [] : [{x:Math.round(x+dx),y:Math.round(y),id:1}]
    });
    await touch('touchStart');
    for (const dx of [-10,-25,-45]) await touch('touchMove',dx);
    await touch('touchEnd');
    const resized = (await paper.boundingBox()).width;
    assert.ok(initial-resized>=40,'A tablet touch drag resizes the document.');
    await page.reload();
    await handle.waitFor();
    closeTo((await paper.boundingBox()).width,resized,'The tablet touch gesture commits its width.');
  } finally { await tabletContext.close(); }
}

async function exercise(engine) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({viewport:desktop});
    const guest = await browser.newContext();
    const room = await post(context,'/api/create',{name:'Host'});
    const path = '/api/rooms/'+room.roomId;
    const joined = await post(guest,path+'/join',{name:'Guest'});
    await post(context,path+'/command',{type:'approve',id:joined.me.id});
    const start = await post(context,path+'/command',{type:'start'});
    const page = await context.newPage();
    const errors = [];
    const pokerCommands = [];
    page.on('pageerror',e => errors.push(e.message));
    page.on('request',r => {
      if (r.method()==='POST' && r.url()===base+path+'/command') pokerCommands.push(r.postData());
    });
    page.setDefaultTimeout(7000);
    await page.goto(base+'/r/'+room.roomId);
    await skin(page,'document');
    await page.locator('[data-doc-action=edit]').click();
    await page.locator('[name=docBody]').fill(Array.from({length:50},(_,n) => '## Check '+n+'\n\nReview the canary.').join('\n\n'));
    await page.locator('[data-doc-action=save]').click();
    const saved = new Map();
    for (const split of splits) saved.set(split.name,await checkSplit(page,split,path,context));
    await checkResponsive(page,saved);

    await skin(page,'document');
    await page.evaluate(() => scrollTo(0,1100));
    await page.waitForFunction(() => scrollY>=1099);
    const handle = splitter(page,'document');
    await beginDrag(page,handle,-40);
    await page.mouse.up();
    assert.ok(await page.evaluate(() => scrollY>=1050),'Resizing while reading keeps the reader in place.');
    const review = await page.locator('.gw-review').boundingBox();
    assert.ok(review.y>=0 && review.y+review.height<=desktop.height+1,'The resized review remains sticky.');
    if (engine===chromium) await checkTabletTouch(browser,context,page.url());
    const end = await (await context.request.get(base+path)).json();
    assert.equal(end.turnKey,start.turnKey);
    assert.deepEqual(end.hand.events,start.hand.events);
    assert.deepEqual(pokerCommands,[]);
    assert.deepEqual(errors,[]);
    console.log('PASS '+engine.name()+' real four-divider drag, cancellation, keyboard bounds and reset, local preferences, polls, sticky review and desktop/tablet/mobile without accidental game actions.');
  } finally { await browser.close(); }
}
try {
  const engines = [chromium,webkit].filter(engine => !process.argv[2] || process.argv[2]===engine.name());
  assert.ok(engines.length,'Expected chromium or webkit');
  for (const engine of engines) await exercise(engine);
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
