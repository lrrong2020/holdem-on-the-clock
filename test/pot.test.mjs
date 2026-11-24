import test from 'node:test';
import assert from 'node:assert/strict';
import { startHand, act, viewHand } from '../engine.mjs';
import { potBreakdown } from '../public/game.js';

function open(stacks) {
  return startHand(stacks.map((stack, index) => ({
    id: String(index + 1), name: 'P' + (index + 1), seat: index + 1, stack
  })));
}
const move = (hand, type, amount) => act(hand, hand.actorId, { type, amount });
const ledger = hand => potBreakdown(viewHand(hand, hand.actorId));

test('blinds and new wagers separate the prior pot, added chips and raise increment', () => {
  const hand = open([1000, 1000, 1000]);
  assert.deepEqual(ledger(hand), {base:0, street:15, total:15, lastWager:null});
  move(hand, 'raise', 35);
  const first = {type:'raise', id:'1', to:35, by:25, paid:35, before:15};
  assert.deepEqual(ledger(hand), {base:0, street:50, total:50, lastWager:first});
  move(hand, 'call');
  assert.deepEqual(ledger(hand), {base:0, street:80, total:80, lastWager:first});
  move(hand, 'raise', 80);
  const second = {type:'raise', id:'3', to:80, by:45, paid:70, before:80};
  assert.deepEqual(ledger(hand), {base:0, street:150, total:150, lastWager:second});
  move(hand, 'fold');
  assert.deepEqual(ledger(hand), {base:0, street:150, total:150, lastWager:second});
  move(hand, 'call');
  assert.equal(hand.street, 'flop');
  assert.deepEqual(ledger(hand), {base:195, street:0, total:195, lastWager:null});
  move(hand, 'bet', 70);
  assert.deepEqual(ledger(hand), {base:195, street:70, total:265,
    lastWager:{type:'bet', id:'2', to:70, by:70, paid:70, before:195}});
  move(hand, 'raise', 160);
  assert.deepEqual(ledger(hand), {base:195, street:230, total:425,
    lastWager:{type:'raise', id:'3', to:160, by:90, paid:160, before:265}});
});

test('a short blind is paid at face value while a raise uses the full preflop price', () => {
  const hand = open([1000, 1000, 3]);
  move(hand, 'raise', 20);
  assert.deepEqual(ledger(hand), {base:0, street:28, total:28,
    lastWager:{type:'raise', id:'1', to:20, by:10, paid:20, before:8}});
});

test('settlement excludes chips returned to the uncalled bettor', () => {
  const hand = open([1000, 1000]);
  move(hand, 'raise', 35);
  move(hand, 'fold');
  assert.deepEqual(ledger(hand), {awarded:20, returned:25});
});

test('settlement includes every side pot and separates the unmatched part of an all-in', () => {
  const hand = open([800, 500, 200]);
  move(hand, 'raise', 800);
  move(hand, 'call');
  move(hand, 'call');
  assert.deepEqual(ledger(hand), {awarded:1200, returned:300});
});
