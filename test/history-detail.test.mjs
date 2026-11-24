import test from 'node:test';
import assert from 'node:assert/strict';
import {startHand, act, viewHand} from '../engine.mjs';
import {renderHistory} from '../public/game.js';

function seats(stacks) {
  return stacks.map((stack, i) => ({id:'p' + i, seat:i + 1, name:'Player ' + (i + 1), stack}));
}

function htmlFor(hand, id, lang = 'en') {
  const holder = {};
  renderHistory(holder, viewHand(hand, id), {viewerId:id, lang});
  return holder.innerHTML;
}

function foldedPot() {
  const entries = seats([1000,1000]);
  entries[1].name = '<img src=x>';
  const hand = startHand(entries, {number:17});
  act(hand, hand.actorId, {type:'raise', amount:35});
  act(hand, hand.actorId, {type:'fold'});
  return hand;
}

test('first-street fold shows personalized win/loss and keeps uncalled chips separate from awarded pot', () => {
  const hand = foldedPot();
  const winner = htmlFor(hand, 'p0');
  const loser = htmlFor(hand, 'p1', 'zh');
  assert.match(winner, /Hand #17/);
  assert.match(winner, /data-history-net="1"/);
  assert.match(winner, /Won without showdown/);
  assert.match(winner, /data-history-pot="2"/);
  assert.match(winner, /Uncalled bet returned 2.5 BB/);
  assert.match(winner, />Uncalled bet returned</);
  assert.match(winner, /Raise to 3.5 BB<small>added 3 BB/);
  assert.match(loser, /data-history-net="-1"/);
  assert.match(loser, /翻牌前 · 弃牌/);
  assert.match(loser, /翻牌前结束/);
  assert.match(loser, /加注至 3.5 BB<small>本次投入 3 BB/);
  assert.match(loser, /本轮开始时的底池 0 BB/);
  assert.match(loser, /退回未跟注部分 2.5 BB/);
  assert.match(loser, /&lt;img src=x&gt;/);
  assert.doesNotMatch(loser, /<img/);
  assert.deepEqual(loser.match(/data-history-street="[a-z]+"/g), ['data-history-street="preflop"']);
  const seatsTable = loser.slice(loser.indexOf('class="hh-seats"'));
  assert.equal(seatsTable.match(/class="gw-card /g).length, 2);
});

test('a late joiner sees a public recap distinct from an actual break-even hand', () => {
  const html = htmlFor(foldedPot(), 'unseated');
  assert.match(html, /Did not play/);
  assert.match(html, /data-history-net=""/);
  assert.doesNotMatch(html, /class="gw-card |Won without showdown|Break even/);
});

test('split all-in side pot correctly shows zero net, auto-runout streets and every public hand', () => {
  const cards = [...'shdc'].flatMap(suit => [...'23456789TJQKA'].map(rank => rank + suit));
  const prefix = ['2c','3c','4c','5c','6c','7c','8c','Ts','Js','Qs','9c','Ks','Tc','As'];
  const hand = startHand(seats([800,500,200]), {deck: [...prefix,...cards.filter(c=>!prefix.includes(c))]});
  act(hand, hand.actorId, {type:'raise', amount:800});
  act(hand, hand.actorId, {type:'call'});
  act(hand, hand.actorId, {type:'call'});
  assert.equal(hand.street, 'complete');
  const html = htmlFor(hand, 'p0');
  assert.match(html, /data-history-pot="120"/);
  assert.match(html, /data-history-net="0"/);
  assert.match(html, /Break even · straight flush/);
  assert.match(html, /Uncalled bet returned 30 BB/);
  assert.match(html, />Side pot 1</);
  assert.equal(html.match(/>Split</g).length, 2);
  assert.equal(html.match(/data-history-street=/g).length, 4);
  assert.equal(html.match(/No betting on this street\./g).length, 3);
  const seatsTable = html.slice(html.indexOf('class="hh-seats"'));
  assert.equal(seatsTable.match(/class="gw-card /g).length, 6);
});
