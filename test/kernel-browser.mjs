// Run against a local server started with the real Kernel checkpoint.
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

const base = new URL(process.env.KERNEL_TEST_URL || 'http://127.0.0.1:4180').origin;
const engine = {chromium,webkit}[process.argv[2] || 'chromium'];
assert.ok(engine, 'Choose chromium or webkit.');
const {kernelAvailable} = await (await fetch(base + '/api/address')).json();
assert.equal(kernelAvailable, true, 'Start the Kernel-enabled local server first.');
const browser = await engine.launch();
const context = await browser.newContext();
let apiRoom;
try {
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const dialog = page.getByRole('dialog');
  await page.goto(base);
  await page.getByRole('button', {name:'Create session',exact:true}).click();
  assert.ok(await dialog.getByRole('radio', {name:/Play Kernel/}).isChecked());
  await dialog.getByLabel('Your nickname').fill('Practice player');
  const created = page.waitForResponse(r => r.url() === base + '/api/create' && r.request().method() === 'POST');
  await dialog.getByRole('button', {name:'Create session',exact:true}).click();
  const response = await created;
  assert.equal(response.status(),201);
  const start = await response.json();
  apiRoom = base + '/api/rooms/' + start.roomId;
  const kernel = start.players.find(p => p.bot === 'kernel');
  assert.ok(start.kernelMode && kernel);
  assert.equal(start.hand.players.find(p=>p.id === kernel.id).cards.length,0);

  await page.locator('[data-play="raise"]').waitFor();
  assert.equal(await page.locator('button[data-ui="invite"]').count(),0);
  for (const skin of ['document','cli','chat']) {
    await page.locator('[data-skin-option="'+skin+'"]').click();
    await page.locator('[data-play="raise"]').waitFor();
    assert.deepEqual(await page.locator('[data-kernel-size]').allTextContents(),
      ['Half pot · 2 BB','Pot · 3 BB','All-in · 100 BB']);
    assert.equal(await page.locator('.gw-amount, .gw-range').count(),0);
  }
  await page.locator('[data-cmd="manage"]').click();
  assert.equal(await dialog.locator('[data-ui="invite"], [data-ui="addBot"], [data-ui="addCloud"], [data-operation="stack"]').count(),0);
  await dialog.getByRole('button',{name:'Pause after hand'}).click();
  await dialog.getByRole('button',{name:'Start dealing'}).waitFor();
  await page.keyboard.press('Escape');

  const initialPot = await page.locator('[data-pot-total]').innerText();
  await page.locator('[data-kernel-size="1000"]').click();
  assert.match(await page.locator('[data-play="raise"]').innerText(),/^Raise to\s+100$/);
  assert.equal(await page.locator('[data-pot-total]').innerText(),initialPot);
  await page.locator('[data-play="raise"]').click();
  await page.locator('.gw-winners').waitFor();
  await page.locator('[data-cmd="history"]').click();
  await dialog.locator('.gw-history').waitFor();
  assert.match(await dialog.locator('.gw-history').innerText(),/Hand #1/);
  const hand = await (await context.request.get(apiRoom+'/history/1')).json();
  assert.ok(hand.events.some(e => e.id === kernel.id && ['call','fold'].includes(e.type)),
    'Kernel responded to the all-in.');
  assert.equal(hand.players.reduce((sum,p) => sum + p.stack, 0),2000);
  await page.keyboard.press('Escape');

  await page.locator('[data-cmd="start"]').click();
  await page.getByText('Hand #2',{exact:true}).waitFor();
  const next = await (await context.request.get(apiRoom)).json();
  assert.equal(next.hand.number,2);
  assert.notEqual(next.hand.button,hand.button);
  assert.deepEqual(next.hand.players.map(p=>p.startStack),[1000,1000]);
  assert.ok(!next.kernelError);
  assert.deepEqual(errors,[]);
  console.log('PASS '+engine.name()+' real Kernel opponent, discrete sizes across skins, all-in response, history, alternating seats and 100 BB reset.');
} finally {
  try {
    if (apiRoom) await context.request.post(apiRoom+'/command',{data:{type:'leave'}});
  } finally { await browser.close(); }
}
