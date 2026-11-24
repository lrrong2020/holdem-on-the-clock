import test from 'node:test';
import assert from 'node:assert/strict';
import { presetAmount, renderHistory } from '../public/game.js';

function hand(pot, streetBet, callAmount, minTo, maxTo) {
  return { pot, players:[{id:'me',streetBet}], legal:{callAmount,minTo,maxTo} };
}

test('percentage sizes include the call before scaling the pot', () => {
  const state = hand(1200, 0, 400, 800, 10000);
  assert.equal(presetAmount(state, 'me', 50), 1200);
  assert.equal(state.pot, 1200);
  assert.equal(presetAmount(hand(1000, 100, 300, 700, 10000), 'me', 50), 1050);
});

test('presets honor minimum, short all-in and nearest tenth BB', () => {
  assert.equal(presetAmount(hand(80, 0, 0, 10, 500), 'me', 33), 26);
  assert.equal(presetAmount(hand(12, 0, 0, 10, 500), 'me', 25), 10);
  assert.equal(presetAmount(hand(1600, 100, 20, 160, 185), 'me', 125), 185);
});

test('history escapes guest names and only renders cards in the authorized view', () => {
  const holder = {};
  renderHistory(holder,{number:1, street:'complete',players:[
    {id:'a',name:'<b>Rin</b>',position:'BB',startStack:1000,stack:995,cards:[]},
    {id:'b',name:'Mika',position:'BTN/SB',startStack:1000,stack:1005,cards:['As','Qc']}
  ],events:[{id:'a',street:'preflop',type:'fold'}],pools:[]});
  assert.match(holder.innerHTML,/&lt;b&gt;Rin&lt;\/b&gt;/);
  assert.equal(holder.innerHTML.match(/class="gw-card /g).length,2);
});
