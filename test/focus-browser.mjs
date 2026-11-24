// Real pointer drags exercise the browser's synthesized click on the common
// ancestor of the pressed input and the release target (the dialog backdrop).
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium, webkit } from 'playwright';
import { makeServer } from '../server.mjs';

const server = makeServer({publicOrigin:null, roomOptions:{now:()=>100000}});
server.listen(0,'127.0.0.1');
await once(server,'listening');
const base = 'http://127.0.0.1:' + server.address().port;

async function inputPosition(input) {
  await input.scrollIntoViewIfNeeded();
  return input.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const x = rect.x + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
    const y = node.tagName === 'TEXTAREA'
      ? rect.y + parseFloat(style.paddingTop) + parseFloat(style.lineHeight) / 2
      : rect.y + rect.height / 2;
    return {x,y,right:rect.right};
  });
}

async function selectWithMouse(page, input, rightEdge) {
  const position = await inputPosition(input);
  await page.mouse.move(position.x,position.y);
  await page.mouse.down();
  await page.mouse.move(rightEdge ?? position.right - 5,position.y,{steps:12});
  await page.mouse.up();
  return position;
}

const selection = input => input.evaluate(node => ({
  focused:document.activeElement === node,
  start:node.selectionStart,
  end:node.selectionEnd,
  value:node.value,
}));

// Mouseup takes place within the field, followed by a pure hover (no click)
// over another control and optionally a state-changing poll from a peer.
async function keepSelection(page, input, value, onHover = async()=>{}) {
  await input.fill(value);
  const position = await selectWithMouse(page,input);
  const before = await selection(input);
  assert.ok(before.focused);
  assert.deepEqual([before.start,before.end],[0,value.length]);
  await page.mouse.move(position.right + 12,position.y,{steps:6});
  await onHover();
  assert.deepEqual(await selection(input),before);
  await page.keyboard.type('7');
  assert.equal(await input.inputValue(),'7');
}

async function backdropDrag(page, dialog, input, text, onRelease = async()=>{}) {
  await input.fill(text);
  const bounds = await dialog.boundingBox();
  const backdropX = bounds.x + bounds.width + 22;
  const position = await selectWithMouse(page,input,backdropX);
  assert.ok(await dialog.isVisible(),'Releasing a selection on the backdrop must keep its dialog open.');
  // Playwright's locator.fill/press would refocus the field and mask the bug.
  assert.ok(await input.evaluate(node=>document.activeElement === node));
  const after = await selection(input);
  await onRelease();
  assert.deepEqual(await selection(input), after);
  await page.keyboard.type('9');
  assert.equal(await input.inputValue(),'9','Typing replaces the native selection after releasing outside.');
  return {x:backdropX,y:position.y};
}

async function keepPartialSelection(page, dialog, input) {
  const text = 'Alpha Beta Gamma';
  await input.fill(text);
  const position = await inputPosition(input);
  await page.mouse.move(position.x + 28,position.y);
  await page.mouse.down();
  await page.mouse.move(position.right - 6,position.y,{steps:10});
  const before = await selection(input);
  assert.ok(before.start > 0 && before.start < before.end && before.end === text.length);
  const bounds = await dialog.boundingBox();
  await page.mouse.move(bounds.x + bounds.width + 25,position.y,{steps:8});
  await page.mouse.up();
  assert.deepEqual(await selection(input),before,'Crossing the backdrop retains the exact partial selection.');
  await page.keyboard.type('Z');
  assert.equal(await input.inputValue(),text.slice(0,before.start) + 'Z');
}

async function exercise(engine) {
  const browser = await engine.launch();
  try {
    const host = await browser.newContext({viewport:{width:1280,height:1000}});
    const guest = await browser.newContext();
    const page = await host.newPage();
    page.setDefaultTimeout(6000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    const create = page.locator('.entry-box [data-ui=create]');
    const dialog = page.getByRole('dialog');
    const nickname = page.locator('dialog [name=name]');
    await create.click();
    await keepSelection(page,nickname,'Alpha Beta');
    await keepPartialSelection(page,dialog,nickname);
    const outside = await backdropDrag(page,dialog,nickname,'Alpha Beta');
    await page.mouse.click(outside.x,outside.y);
    assert.ok(!(await dialog.isVisible()),'An intentional backdrop click still dismisses the dialog.');

    await create.click();
    await nickname.fill('New identity');
    await page.keyboard.press('Tab');
    assert.ok(!(await nickname.evaluate(node=>document.activeElement === node)),'Tab still transfers focus.');
    await page.keyboard.press('Escape');
    assert.ok(!(await dialog.isVisible()));

    async function post(context,path,data) {
      const response = await context.request.post(base + path,{data});
      assert.ok(response.ok(), await response.text());
      return response.json();
    }
    const room = await post(host,'/api/create',{name:'Host'});
    const path = '/api/rooms/' + room.roomId;
    const command = (type,data={}) => post(host,path+'/command',{type,...data});
    const peer = await post(guest,path+'/join',{name:'Guest'});
    await command('approve',{id:peer.me.id});
    const start = await command('start');
    assert.equal(start.hand.actorId,start.me.id);
    await page.goto(base + '/r/' + room.roomId);
    const poll = () => page.waitForResponse(r=>r.url()===base+path && r.request().method()==='GET');
    const amount = page.locator('.gw-amount');
    for (const skin of ['chat','document','cli']) {
      await page.locator('[data-skin-option="'+skin+'"]').click();
      await keepSelection(page,amount,'12.5',poll);
    }
    assert.equal((await (await host.request.get(base+path)).json()).turnKey,start.turnKey);

    // Use the real host-management dialog as well: numeric fields have no
    // selectionStart API, so the subsequent replacement keystroke is decisive.
    const manage = page.locator('.gw-tool [data-cmd=manage]');
    await manage.click();
    const clock = dialog.locator('[name=baseSeconds]');
    await dialog.locator('details').filter({has:page.locator('[name=baseSeconds]')}).locator('summary').click();
    await backdropDrag(page,dialog,clock,'50');
    const timeCards = dialog.locator('[name=initialCards]');
    await timeCards.click();
    assert.ok(await timeCards.evaluate(node => document.activeElement === node),'Clicking another field transfers focus.');
    const model = dialog.locator('[data-form=cloud] [name=primary]');
    await dialog.locator('#cloud-config summary').click();
    await backdropDrag(page,dialog,model,'model-test',async()=>{
      const lateContext = await browser.newContext();
      await post(lateContext,path+'/join',{name:'New applicant'});
      await dialog.locator('#people').getByText('New applicant',{exact:false}).first().waitFor();
    });
    await dialog.locator('[data-member="'+room.me.id+'"][data-operation="stack"]').click();
    await backdropDrag(page,dialog,dialog.locator('[data-form=stack] [name=amount]'),'158.5');
    await page.keyboard.press('Escape');

    await page.locator('[data-skin-option=document]').click();
    await page.locator('[data-doc-action=edit]').click();
    const body = page.locator('[name=docBody]');
    await keepSelection(page,body,'Project review',async()=>{
      await command('pause');
      await command('action',{turnKey:start.turnKey,action:{type:'fold'}});
      await page.locator('.gw-winners').waitFor();
    });
    await page.locator('[data-doc-action=cancel]').click();

    // A standing player's numeric buy-in remains editable while the table updates.
    await command('stack',{id:room.me.id,amount:0});
    const rebuy = page.locator('.gw-rebuy');
    await rebuy.fill('125');
    await page.keyboard.press('ControlOrMeta+a');
    const position = await inputPosition(rebuy);
    await page.mouse.move(position.right+15,position.y);
    await command('addBot',{mode:'local',name:'Late seat'});
    await page.locator('.gw-seat-list').getByText('Late seat',{exact:true}).waitFor();
    assert.ok(await rebuy.evaluate(node=>document.activeElement===node));
    await page.keyboard.type('55');
    assert.equal(await rebuy.inputValue(),'55');
    await manage.click();
    await backdropDrag(page,dialog,dialog.locator('[data-form=rebuy] [name=amount]'),'103.5');
    await page.keyboard.press('Escape');
    assert.equal((await (await host.request.get(base+path)).json()).myRequest,null);
    assert.deepEqual(errors,[]);
    console.log('PASS '+engine.name()+': mouse-only hover, cross-backdrop text selection in nickname, clock, cloud model, stack and rebuy dialogs; raise, document and rebuy across polls; intentional outside click, Tab and Escape.');
  } finally { await browser.close(); }
}

try {
  const engines = [chromium,webkit].filter(engine=>!process.argv[2] || process.argv[2]===engine.name());
  assert.ok(engines.length, 'Expected chromium or webkit');
  for (const engine of engines) await exercise(engine);
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
