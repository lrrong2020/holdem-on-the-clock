// Exercise Safari's browser engine with a touch viewport on a fresh local table.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { webkit } from 'playwright';
import { makeServer } from '../server.mjs';

const server=makeServer({publicOrigin:null});
server.listen(0,'127.0.0.1');
await once(server,'listening');
const base='http://127.0.0.1:'+server.address().port;
let browser;
try {
  browser=await webkit.launch();
  const page=await browser.newPage({isMobile:true,hasTouch:true,viewport:{width:390,height:844}});
  page.setDefaultTimeout(10000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);
  await page.getByRole('button',{name:'Create session',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Your nickname').fill('WebKit guest');
  await dialog.getByRole('radio',{name:/Solo practice/}).check();
  await dialog.getByRole('button',{name:'Create session',exact:true}).click();
  await page.locator('[data-play="call"]').waitFor();
  assert.match(await page.locator('.gw-next').innerText(),/After a call · next · BB/);
  const privateCards=await page.locator('.gw-hand-data dd').first().innerText();
  for (const skin of ['document','cli','chat']) {
    await page.locator('[data-skin-option="'+skin+'"]').tap();
    assert.equal(await page.locator('.gw-hand-data dd').first().innerText(),privateCards);
    const amount=page.locator('.gw-amount');
    await amount.tap();
    await amount.fill('3.1');
    assert.equal(await amount.inputValue(),'3.1');
    assert.equal(await page.locator('[data-pot-total]').getAttribute('data-pot-total'),'1.5');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=391));
  }
  await page.locator('[data-play="fold"]').tap();
  await page.locator('.gw-winners').waitFor();
  await page.locator('[data-cmd="history"]').tap();
  await dialog.locator('.gw-history').waitFor();
  assert.match(await dialog.locator('.gw-history').innerText(),/Main pot/);
  assert.deepEqual(errors,[]);
  console.log('PASS WebKit mobile touch viewport, create solo session, three skins, next-position preview, fold, settlement and history.');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
