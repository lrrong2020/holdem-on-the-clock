import test from 'node:test';
import assert from 'node:assert/strict';
import { startHand, act, legalActions, viewHand, forceFold, bestScore } from '../engine.mjs';

function hand(stacks = [1000, 1000], options) {
  return startHand(stacks.map((stack, i) => ({ seat: i + 1, id: 'p' + (i + 1), name: 'Player ' + (i + 1), stack })), options);
}
function move(h, type, amount) {
  act(h, h.actorId, {type, amount});
}
function passive(h) {
  move(h, legalActions(h, h.actorId).check ? 'check' : 'call');
}
function rigged(prefix) {
  const first = prefix.split(' ');
  const rest = [...'shdc'].flatMap(s => [...'23456789TJQKA'].map(r => r + s)).filter(c => !first.includes(c));
  return [...first, ...rest];
}
function score(list) {return bestScore(list.split(' '));}

test('best five cards rank every category and handle wheel, kickers, two trips and board plays', () => {
  const examples = ['As Jd 9h 7c 2s', 'As Ad Jh 7c 2s', 'As Ad Jh Jc 2s', 'As Ad Ah 7c 2s',
    'As 2d 3h 4c 5s', 'As Js 9s 7s 2s', 'As Ad Ah 7c 7s', 'As Ad Ah Ac 2s', 'As 2s 3s 4s 5s'];
  const scores = examples.map(score);
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i] > scores[i - 1]);
  assert.ok(score('2d 3d 4h 5c 6s') > scores[4]);
  assert.ok(score('As Ad Jh 7c 3s') > scores[1]);
  assert.equal(score('Ah Ac As Kd Ks Kh 2s'), score('Ah Ac As Kd Ks'));
  assert.equal(score('Ah Kh Qh Jh Th 2s 2d'), score('Ah Kh Qh Jh Th 9d 8c'));
  assert.equal(score('Ah Ad Kh Kd Qh Qd 2s'), score('Ah Ad Kh Kd Qh'));
  assert.equal(score('Ah Jh 8h 6h 4h 3h 2h'), score('Ah Jh 8h 6h 4h'));
  assert.throws(() => score('Ah Ah 3s 4h 5s'));
});

test('heads-up button posts small blind, acts first preflop and last postflop; rotates', () => {
  const h = hand();
  assert.equal(h.button, 1);
  assert.equal(h.actorId, 'p1');
  assert.equal(h.players[0].stack, 995);
  assert.equal(h.players[1].position, 'BB');
  assert.deepEqual(viewHand(h, 'p1').legal,
    {check:false, fold:true, call:true, callAmount:5, raise:true, minTo:20, maxTo:1000, currentTo:10});
  assert.equal(legalActions(h, 'p2'), null);
  move(h, 'call');
  assert.equal(h.actorId, 'p2');
  move(h, 'check');
  for (const [street, count] of [['flop',3],['turn',4],['river',5]]) {
    assert.equal(h.street, street);
    assert.equal(h.board.length, count);
    assert.equal(h.actorId, 'p2');
    move(h, 'check');
    move(h, 'check');
  }
  assert.equal(h.street, 'complete');
  const visible = viewHand(h, 'spectator');
  assert.equal(visible.pot, 20);
  assert.ok(visible.players.every(p => p.cards.length === 2));
  assert.equal(visible.players.reduce((sum,p) => sum + p.stack, 0), 2000);
  assert.equal(hand(undefined, {previousButton:h.button}).button, 2);
});

test('multiway positions and permitted actions rotate across gapped seats', () => {
  const h = startHand([2,5,8].map(seat => ({id:'s'+seat,seat,name:'N'+seat,stack:400})), {previousButton:4});
  assert.equal(h.button, 5);
  assert.equal(h.actorId, 's5');
  assert.deepEqual(h.events.map(e => [e.type,e.id,e.amount]), [['sb','s8',5],['bb','s2',10]]);
  move(h, 'raise', 42);
  assert.equal(legalActions(h, h.actorId).minTo, 74);
  move(h, 'call');
  move(h, 'call');
  assert.equal(h.street,'flop');
  assert.equal(h.actorId,'s8');
  assert.equal(legalActions(h,h.actorId).minTo,10);
});

test('ineligible or malformed moves leave state intact', () => {
  const h = hand();
  const state = structuredClone(h);
  const invalid = [
    ['p2',{type:'call'}],['p1',{type:'check'}],['p1',{type:'raise',amount:19}],
    ['p1',{type:'raise',amount:21.5}],['p1',{type:'raise',amount:1001}],['p1',{type:'bet',amount:25}],
    ['p1',{type:'allin'}],['p1',{type:'raise',amount:'100'}],['p1',{type:'raise',amount:Infinity}],
  ];
  for (const [id, action] of invalid) {
    assert.throws(() => act(h,id,action));
    assert.deepEqual(h,state);
  }
});

test('private view removes deck, other hands and internal state; cannot mutate authoritative hand', () => {
  const h = hand([100,100,100]);
  h.players[0].internalNote = 'server-only';
  const me = viewHand(h,'p1');
  assert.equal(me.players[0].cards.length,2);
  assert.deepEqual(me.players[1].cards,[]);
  assert.equal(me.deck,undefined);
  assert.equal(me.players[0].actedTo,undefined);
  assert.equal(me.players[0].internalNote,undefined);
  assert.deepEqual(viewHand(h).players.map(p => p.cards),[[],[],[]]);
  me.players[0].cards.pop(); me.events[0].amount = 0;
  assert.equal(h.players[0].cards.length,2);
  assert.equal(h.events[0].amount,5);
  move(h,'fold');
  while (h.actorId) passive(h);
  assert.deepEqual(viewHand(h,'p2').players[0].cards,[]);
  assert.equal(viewHand(h,'p1').players[0].cards.length,2);
});

test('winner by fold keeps hole cards private and receives uncalled chips', () => {
  const h = hand();
  const dealt = h.players.map(p=>[...p.cards]);
  move(h,'raise',100);
  move(h,'fold');
  assert.equal(h.street,'complete');
  assert.equal(h.showdown,false);
  assert.deepEqual(h.board,[]);
  assert.deepEqual(h.deck,[]);
  for (const [i,player] of h.players.entries()) {
    assert.deepEqual(viewHand(h,player.id).players[i].cards,dealt[i]);
  }
  assert.deepEqual(viewHand(h).players.map(p => p.cards),[[],[]]);
  assert.deepEqual(h.pools.map(p => [p.amount,p.refund]),[[20,false],[90,true]]);
  assert.deepEqual(h.players.map(p => p.stack),[1010,990]);
});

test('20/50/80 BB all-in creates main pot 60, side pot 60 and refund 30; each award goes to the right seat', () => {
  // Order is SB, BB, BTN; give BTN queens, SB kings, BB aces.
  const deck = rigged('Ks As Qs Kh Ah Qh 2c 3d 4s 9c 6d Jd 7d Th');
  const h = hand([800,500,200],{deck});
  move(h,'raise',800);
  assert.equal(legalActions(h,'p2').callAmount,495);
  move(h,'call');
  move(h,'call');
  assert.equal(h.showdown,true);
  assert.deepEqual(h.deck,[]);
  const recap = viewHand(h);
  assert.deepEqual(recap.board,['3d','4s','9c','Jd','Th']);
  assert.deepEqual(recap.players.map(p=>p.cards),[['Qs','Qh'],['Ks','Kh'],['As','Ah']]);
  assert.deepEqual(h.pools.map(p => [p.amount,p.winners,p.refund]),
    [[600,['p3'],false],[600,['p2'],false],[300,['p1'],true]]);
  assert.deepEqual(h.players.map(p => p.stack),[300,600,600]);
});

test('odd unit in tied pot goes to first winner clockwise from button', () => {
  const deck = rigged('Ks Qs Js Kd Qd Jd 2c Ah Kh Qh 2s Jh 3s Th');
  const h = hand([100,100,100],{deck});
  move(h,'raise',21);
  move(h,'call');move(h,'call');
  move(h,'check');move(h,'bet',10);move(h,'call');move(h,'fold');
  while(h.actorId) passive(h);
  assert.deepEqual(h.pools, [{amount:83,eligible:['p1','p3'],refund:false,winners:['p3','p1'],
    shares:[{id:'p3',amount:42},{id:'p1',amount:41}]}]);
});

test('short all-in does not reopen action to prior bettor; subsequent cumulative full raise does', () => {
  const h = hand([100,25,31,100,100]);
  // p4 raises to 20. p2 and p3 each add a short all-in after others call.
  move(h,'raise',20);move(h,'call');move(h,'call');move(h,'raise',25);move(h,'raise',31);
  assert.equal(h.actorId,'p4');
  assert.equal(legalActions(h,'p4').raise,true);
  assert.equal(legalActions(h,'p4').minTo,41);
  const k = hand([100,25,100]);
  move(k,'raise',20);move(k,'raise',25);move(k,'call');
  assert.equal(k.actorId,'p1');
  assert.equal(legalActions(k,'p1').raise,false);
  assert.throws(() => move(k,'raise',35));
  move(k,'call');
  assert.equal(k.street,'flop');
});

test('short blinds run out heads up and preserve the full blind bring-in multiway', () => {
  const heads = hand([1000,3]);
  assert.equal(heads.street,'complete');
  assert.equal(heads.board.length,5);
  assert.equal(heads.pools.at(-1).amount,2);
  const multi = hand([1000,1000,3]);
  assert.equal(legalActions(multi,'p1').callAmount,10);
  move(multi,'fold');
  assert.equal(multi.street,'complete');
  const lone = hand([2,3,1]);
  assert.equal(lone.street,'preflop');
  assert.equal(legalActions(lone,'p1').callAmount,2);
  assert.equal(legalActions(lone,'p1').raise,false);
});

test('last deep stack may call or fold versus all-ins, without increasing a dry side pot', () => {
  const h = hand([1000,200,100]);
  move(h,'raise',120);
  move(h,'raise',200);
  move(h,'call');
  assert.equal(legalActions(h,'p1').raise,false);
  assert.equal(legalActions(h,'p1').callAmount,80);
  move(h,'call');
  assert.equal(h.street,'complete');
});

test('out-of-turn departure preserves current actor, all-in equity and opponent privacy', () => {
  const h = hand([100,100,100,100]);
  assert.equal(h.actorId,'p4');
  forceFold(h,'p1');
  assert.equal(h.actorId,'p4');
  move(h,'raise',100);
  forceFold(h,'p4');
  assert.equal(h.players[3].folded,false);
  move(h,'fold');move(h,'call');
  assert.equal(h.street,'complete');
  assert.deepEqual(viewHand(h,'p1').players[1].cards,[]);
});

test('reject invalid seat tables and non-unique decks', () => {
  for(const stacks of [[20],[10,0],[20,-1],[1.5,2],Array(10).fill(12),[Number.MAX_SAFE_INTEGER,10]]) {
    assert.throws(() => hand(stacks));
  }
  assert.throws(() => hand(undefined,{deck:Array(52).fill('As')}));
  assert.throws(() => startHand([{seat:1,id:'a',stack:50},{seat:1,id:'b',stack:50}]));
});

test('seeded play at every supported table size conserves chips, ends in finite time and never reuses a card', () => {
  let seed = 50712;
  const next = n => {seed = (Math.imul(seed,1664525) + 1013904223) >>> 0;return seed % n;};
  for (let run = 0; run < 480; run++) {
    const stacks = Array.from({length:2 + run % 8},() => 1 + next(3000));
    const total = stacks.reduce((a,b) => a+b,0);
    const h = hand(stacks,{previousButton:next(9)});
    let actions = 0;
    while (h.actorId) {
      const legal = legalActions(h,h.actorId);
      const choice = next(19);
      if (choice < 3) move(h,'fold');
      else if (legal.raise && choice < 9) {
        const range = legal.maxTo - legal.minTo + 1;
        const amount = [legal.minTo,legal.maxTo,legal.minTo+next(range)][next(3)];
        move(h,h.currentTo === 0 ? 'bet':'raise',amount);
      } else passive(h);
      assert.ok(++actions < 400);
      const allCards = [...h.deck,...h.board,...h.players.flatMap(p => p.cards)];
      assert.equal(new Set(allCards).size,allCards.length);
      assert.equal(h.players.reduce((sum,p) => sum+p.stack+(h.actorId?p.committed:0),0), total);
    }
    assert.equal(h.street,'complete');
    assert.equal(h.pools.reduce((sum,p) => sum+p.amount,0),h.players.reduce((sum,p) => sum+p.committed,0));
    assert.ok(h.players.every(p => p.stack >= 0 && Number.isSafeInteger(p.stack)));
  }
});

test('when a three-player table loses the dealer, the previous big blind avoids a consecutive big blind', () => {
  const prior = hand([100,100,100]);
  const seats = prior.players.slice(1).map(p => ({...p,stack:100}));
  const heads = startHand(seats,{previousButton:prior.button,previousBigBlindId:'p3'});
  assert.equal(heads.button,3);
  assert.equal(heads.players.find(p => p.position === 'BB').id,'p2');
});

test('next-if-matched names the next actor only when action remains on this street', () => {
  const h = hand();
  assert.equal(viewHand(h,'p2').nextIfMatched,'p2');
  move(h,'call');
  assert.equal(viewHand(h,'p2').nextIfMatched,null);
  move(h,'check');
  assert.equal(viewHand(h,'p1').nextIfMatched,'p1');
  move(h,'bet',25);
  assert.equal(viewHand(h,'p2').nextIfMatched,null);

  const short = hand([10,1000]);
  // Calling all-in for the rest of the small blind closes the action for both seats.
  assert.equal(viewHand(short,'p2').nextIfMatched,null);
  move(short,'call');
  assert.equal(short.street,'complete');
  assert.equal(viewHand(short,'p1').nextIfMatched,null);
});
