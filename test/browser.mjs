// Two independent browser identities exercise only the visible application. The server,
// rooms and cookies are isolated from any running user session and torn down on exit.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { makeServer } from '../server.mjs';

let server;
let base = process.env.E2E_BASE_URL ? new URL(process.env.E2E_BASE_URL).origin : '';
if (!base) {
  // Use an explicit origin so the share link points at the fixture on hosts with VPNs.
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  base = 'http://127.0.0.1:' + port;
  server = makeServer({publicOrigin:base});
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
}
const sessions = [];
const startedAt = Date.now();
let browser;
const errors = [];

async function player(width) {
  const context = await browser.newContext({viewport:{width, height:900},locale:'en-US'});
  const page = await context.newPage();
  page.setDefaultTimeout(process.env.E2E_BASE_URL ? 17000 : 7000);
  sessions.push(page);
  page.on('pageerror', error => errors.push(error.message));
  return page;
}

const by = (page, name) => page.getByRole('button',{name,exact:true});
const action = (page, name) => page.locator('[data-play="' + name + '"]');
const command = (page, name) => page.locator('.gw-tool [data-cmd="' + name + '"]');
const street = page => page.locator('.gw-street > b');
const summary = (page, nth) => page.locator('.gw-hand-data > div').nth(nth).locator('dd');
const readCards = async (page,nth) => (await summary(page,nth).innerText()).trim();
const seats = page => page.locator('.gw-seat-list tbody tr');
const dialog = page => page.getByRole('dialog');

async function expectText(locator, expected) {
  // Use a text-filtered locator so state replication on the peer has time to arrive.
  await locator.filter({hasText:expected}).first().waitFor();
}
async function sameBoard(host, guest, count) {
  await summary(host,1).locator('.gw-card').nth(count-1).waitFor();
  await summary(guest,1).locator('.gw-card').nth(count-1).waitFor();
  assert.equal(await readCards(host,1), await readCards(guest,1));
}
async function withinViewport(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, 'Workspace overflows viewport by ' + overflow + 'px');
}
async function closeDialog(page) {
  await page.keyboard.press('Escape');
  await dialog(page).waitFor({state:'hidden'});
}

async function playFlopRaises(host,guest) {
  // One street with a bet, raise, and re-raise makes the old pot, paid amount,
  // raise increment and raise target all different numbers.
  for (const [page,type,target] of [[guest,'bet','2'],[host,'raise','6'],[guest,'raise','12']]) {
    await action(page,type).waitFor();
    await page.locator('.gw-amount').fill(target);
    await action(page,type).click();
  }
  await expectText(action(host,'call'),/Call 6$/);
  for (const page of [host,guest]) {
    for (const [attribute,expected] of Object.entries({
      'pot-base':'7','pot-street':'18','pot-total':'25','pot-before':'15',
      'pot-paid':'10','raise-by':'6','raise-to':'12'
    })) {
      const selector='data-'+attribute;
      assert.equal(await page.locator('['+selector+']').getAttribute(selector),expected);
    }
  }
  await host.locator('[data-ui="language"]').click();
  await expectText(action(host,'raise'),'加注至');
  await expectText(host.locator('.gw-pot-equation'),/本轮开始时的底池\s*7\s*\+\s*本轮下注\s*18\s*=\s*25 BB/);
  await expectText(host.locator('.gw-pot-wager'),/加注至\s*12 BB · 加注额\s*6 BB\s*加注前底池\s*15 BB · 本次投入\s*10 BB/);
  if (process.env.E2E_SCREENSHOTS) {
    const directory = resolve(process.env.E2E_SCREENSHOTS);
    await mkdir(directory,{recursive:true});
    // Keep sticky app chrome at its natural top position in the full-height desktop proof.
    const viewport=host.viewportSize();
    const documentHeight=await host.evaluate(()=>document.documentElement.scrollHeight);
    await host.setViewportSize({width:viewport.width,height:Math.max(viewport.height,documentHeight)});
    await host.evaluate(()=>window.scrollTo(0,0));
    await host.screenshot({path:resolve(directory,'chat-desktop.png')});
    await host.setViewportSize(viewport);
  }
  await host.locator('[data-ui="language"]').click();
  await action(host,'call').click();
}

async function verifyHands(host,guest) {
  await command(host,'start').click();
  await action(host,'raise').waitFor();
  await expectText(street(guest),'Preflop');
  const hostHand = await readCards(host,0);
  const guestHand = await readCards(guest,0);
  assert.notEqual(hostHand,guestHand);
  assert.equal(await host.locator('.gw-tool .gw-card').count(),2);
  assert.equal(await guest.locator('.gw-tool .gw-card').count(),2);

  // Preview several bet sizes. The guest's chips, pot and turn remain unchanged.
  const before = await host.locator('[data-pot-total]').getAttribute('data-pot-total');
  assert.equal(before,'1.5');
  await host.locator('.gw-sizing').waitFor({state:'visible'});
  const presets = host.locator('.gw-presets button');
  assert.equal(await presets.count(),8);
  await presets.filter({hasText:/^75%$/}).click();
  const amount = host.locator('.gw-amount');
  await amount.fill('3');
  await amount.press('ArrowUp');
  assert.equal(await amount.inputValue(),'3.5');
  for (const page of [host,guest]) {
    assert.equal(await page.locator('[data-pot-total]').getAttribute('data-pot-total'),before);
  }
  await action(host,'raise').click();
  await expectText(action(guest,'call'),/Call 2.5$/);
  assert.equal(await guest.locator('[data-pot-before]').getAttribute('data-pot-before'),'1.5');
  assert.equal(await guest.locator('[data-pot-paid]').getAttribute('data-pot-paid'),'3');
  assert.equal(await guest.locator('[data-raise-by]').getAttribute('data-raise-by'),'2.5');
  assert.equal(await guest.locator('[data-raise-to]').getAttribute('data-raise-to'),'3.5');
  assert.equal(await guest.locator('[data-pot-total]').getAttribute('data-pot-total'),'4.5');
  await action(guest,'call').click();
  await sameBoard(host,guest,3);
  for (const page of [host,guest]) {
    assert.equal(await page.locator('[data-pot-base]').getAttribute('data-pot-base'),'7');
    assert.equal(await page.locator('[data-pot-street]').getAttribute('data-pot-street'),'0');
    assert.equal(await page.locator('[data-pot-total]').getAttribute('data-pot-total'),'7');
  }


  // Heads-up ordering changes on the flop. Refresh must keep the same guest and cards.
  await action(guest,'check').waitFor();
  await guest.context().setOffline(true);
  await guest.locator('#connection').waitFor();
  await guest.context().setOffline(false);
  await guest.locator('#connection').waitFor({state:'hidden'});
  await guest.reload();
  await action(guest,'check').waitFor();
  assert.equal(await readCards(guest,0),guestHand);
  await checkSkinsAndLanguage(host,guest);
  for (const [phase, count] of [['Flop',3],['Turn',4],['River',5]]) {
    await expectText(street(guest),phase);
    await sameBoard(host,guest,count);
    if (phase === 'Flop') {
      await playFlopRaises(host,guest);
    } else {
      await action(guest,'check').click();
      await action(host,'check').click();
    }
  }
  await expectText(street(host),'Complete');
  await expectText(street(guest),'Complete');
  assert.equal(await host.locator('.gw-winners').innerText(),await guest.locator('.gw-winners').innerText());
  assert.match(await host.locator('.gw-winners').innerText(),/Main pot/);
  for (const p of [host,guest]) {
    const balances = await seats(p).locator('td:nth-child(3)').allTextContents();
    assert.equal(balances.reduce((sum,value) => sum + Number(value), 0),200);
  }

  // Let the next hand start automatically, then fold. No opponent may see the folded hand.
  await action(guest,'fold').waitFor({timeout:17000});
  await pauseAfterHand(host);
  await action(guest,'fold').click();
  await expectText(street(host),'Complete');
  await expectText(seats(host).filter({hasText:'Rin'}), /Net \+0\.5 BB/);
  await expectText(seats(host).filter({hasText:'Mika'}), /Net -0\.5 BB/);
  for (const p of [host,guest]) {
    await command(p,'history').click();
    await expectText(dialog(p).locator('.gw-history h3'),/#2/);
    const historyRows = dialog(p).locator('.gw-history tr');
    const ownName = p === host ? 'Rin' : 'Mika';
    const otherName = p === host ? 'Mika' : 'Rin';
    assert.equal(await historyRows.filter({hasText:ownName}).locator('.gw-card').count(),2);
    assert.equal(await historyRows.filter({hasText:otherName}).locator('.gw-card').count(),0);
    // Assert the nonselected hand also receives its personalized picker label.
    const firstOption = dialog(p).locator('#hand-select option[value="1"]');
    await firstOption.filter({hasText:/Pot 31 BB/}).waitFor({state:'attached'});
    assert.match(await firstOption.textContent(), /[♠♥♦♣]/);
    await dialog(p).locator('#history-prev').click();
    await expectText(dialog(p).locator('.gw-history h3'),/#1$/);
    assert.ok(await dialog(p).locator('#history-prev').isDisabled());
    await dialog(p).locator('#history-next').click();
    await expectText(dialog(p).locator('.gw-history h3'),/#2$/);
    await closeDialog(p);
  }
  console.log('PASS heads-up raise/call, legal sizing, all five board cards, refresh, two-client showdown, next hand and private histories');
}

async function pauseAfterHand(host) {
  await command(host,'manage').click();
  await by(dialog(host),'Pause after hand').click();
  await by(dialog(host),'Start dealing').waitFor();
  await closeDialog(host);
}

async function verifyMixedTable(host,guest) {
  await command(host,'addBot').click();
  await expectText(seats(guest),'Orbit');
  await command(host,'start').click();
  const label = page => page.locator('.gw-tool header > span');
  await expectText(label(host),'#3');
  await expectText(label(guest),'#3');
  await pauseAfterHand(host);
  const ready = page => page.locator('[data-play="call"], [data-play="check"], .gw-winners').first();
  for (let i = 0; i < 48; i++) {
    // The bot takes its turn server-side. Either human can become the next actor.
    await Promise.any([host,guest].map(p => ready(p).waitFor()));
    if (await host.locator('.gw-winners').isVisible()) break;
    for (const p of [host,guest]) {
      const button = p.locator('[data-play="call"], [data-play="check"]').first();
      if (!await button.isVisible()) continue;
      const previous = await p.locator('.gw-street').innerText();
      await button.click();
      await p.waitForFunction(previous => {
        const street = document.querySelector('.gw-street');
        return street && street.innerText !== previous;
      }, previous);
      break;
    }
  }
  await expectText(street(host),'Complete');
  await expectText(street(guest),'Complete');
  assert.equal(await seats(host).count(),3);
  assert.equal(await seats(guest).count(),3);
  assert.equal(await host.locator('.gw-winners').innerText(), await guest.locator('.gw-winners').innerText());
  const stacks = await seats(host).locator('td:nth-child(3)').allTextContents();
  assert.equal(Math.round(stacks.reduce((sum,stack) => sum + Number(stack),0) * 10),3000);
  console.log('PASS mixed 3-player hand, two humans and one local AI, matching settlements and chip totals');
}

async function createRoom(page, name, solo) {
  await page.goto(base);
  await by(page,'Create session').click();
  const form = dialog(page);
  await form.getByLabel('Your nickname').fill(name);
  await form.getByRole('radio',{name:solo ? /Solo practice/ : /With friends/}).check();
  await by(form,'Create session').click();
  await page.waitForURL(/\/r\/[\w-]+$/);
  await form.waitFor({state:'hidden'});
}
async function leaveSession(page) {
  if (page.isClosed() || !page.url().includes('/r/')) return;
  if (await dialog(page).isVisible()) await closeDialog(page);
  await page.locator('#topbar [data-ui="manage"]').click();
  await dialog(page).locator('[data-ui="leaveConfirm"]').click();
  await dialog(page).locator('[data-ui="leave"]').click();
  await page.waitForURL(base + '/');
}
async function trySolo() {
  const solo = await player(1360);
  await createRoom(solo,'Nova QA',true);
  await expectText(seats(solo),/Orbit/);
  await action(solo,'fold').click();
  await expectText(street(solo),'Complete');
  await command(solo,'history').click();
  await expectText(dialog(solo).locator('.gw-history'),'Main pot');
  await leaveSession(solo);
  await solo.context().close();
  console.log('PASS solo creation, local opponent and first settlement');
}
async function checkSkinsAndLanguage(host, guest) {
  const board = await readCards(guest,1);
  const privateCards = await readCards(guest,0);
  const before = await guest.locator('[data-clock]').innerText();
  const initialSeconds = Number(before.match(/(\d+)s/)?.[1]);
  assert.ok(initialSeconds > 0);
  for (const skin of ['document','cli','chat']) {
    await guest.locator('[data-skin-option="' + skin + '"]').click();
    await action(guest,'check').waitFor();
    assert.equal(await readCards(guest,1), board);
    assert.equal(await readCards(guest,0),privateCards);
    await withinViewport(guest);
  }
  await guest.locator('[data-ui="language"]').click();
  await expectText(action(guest,'check'),'过牌');
  assert.equal(await readCards(guest,1),board);
  await guest.locator('[data-ui="language"]').click();
  await expectText(action(guest,'check'),'Check');
  const left = Number((await guest.locator('[data-clock]').innerText()).match(/(\d+)s/)?.[1]);
  assert.ok(left > 0 && left <= initialSeconds);
  await expectText(street(host),'Flop');
  console.log('PASS mobile viewport, all three skins and two languages during live decision');
}
async function friends() {
  const host = await player(1440);
  const guest = await player(390);
  await createRoom(host,'Rin',false);
  await by(host,'Invite members').click();
  const invitation = await dialog(host).getByLabel('Invitation link').inputValue();
  assert.equal(invitation,host.url());
  await closeDialog(host);
  await guest.goto(invitation);
  await by(guest,'Request a seat').click();
  await dialog(guest).getByLabel('Your nickname').fill('Mika');
  await by(dialog(guest),'Send request').click();
  await guest.getByRole('heading',{name:'Seat requested'}).waitFor();
  assert.equal(await guest.locator('.gw-card').count(),0);
  await command(host,'manage').click();
  await by(dialog(host),'Approve').click();
  await expectText(seats(guest),'Mika');
  await closeDialog(host);
  await expectText(seats(host),'Mika');
  console.log('PASS shared invitation, pending request and approval in isolated sessions');
  await verifyHands(host,guest);
  await verifyMixedTable(host,guest);
}
try {
  browser = await chromium.launch();
  await trySolo();
  await friends();
  assert.deepEqual(errors,[],'Browser runtime errors');
  console.log('Browser acceptance passed in ' + ((Date.now() - startedAt) / 1000).toFixed(1) + 's');
} finally {
  try {
    // Even on a failed assertion release only the seats this run created.
    for (const p of sessions) await leaveSession(p);
  } finally {
    await browser?.close();
    if (server) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }
}
