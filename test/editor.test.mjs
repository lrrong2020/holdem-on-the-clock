import test from 'node:test';
import assert from 'node:assert/strict';
import {amountAtStop, parseBetAmount, sliderBounds, stopForAmount} from '../public/game.js';

test('manual amounts retain tenths precision and reject partial or out-of-range drafts', () => {
  const limits = {minTo:20, maxTo:1000};
  for (const [draft, units] of [['2',20], ['03.1',31], ['3,2',32], ['４．３',43], ['100.0',1000]]) {
    assert.equal(parseBetAmount(draft, limits), units);
  }
  for (const draft of ['', '.', '3.', '3,', '0', '-2', '1.9', '100.1', '2.01', '1e1', 'x9']) {
    assert.equal(parseBetAmount(draft, limits), null, draft);
  }
  assert.equal(parseBetAmount('.5', {minTo:5, maxTo:5}), 5);
});

test('manual parsing uses exact integer tenths up to the supported chip bound', () => {
  const limits = {minTo:10, maxTo:Number.MAX_SAFE_INTEGER};
  assert.equal(parseBetAmount('900719925474099.1', limits), Number.MAX_SAFE_INTEGER);
  assert.equal(parseBetAmount('900719925474099.2', limits), null);
});

test('slider uses half-BB stops and includes an off-grid minimum and exact all-in', () => {
  const limits = {minTo:22, maxTo:43};
  assert.deepEqual(sliderBounds(limits), {min:2, max:4.5});
  for (const [stop, units] of [[2,22], [2.5,25], [3,30], [3.5,35], [4,40], [4.5,43]]) {
    assert.equal(amountAtStop(stop, limits), units);
    assert.equal(stopForAmount(units, limits), stop);
  }
  assert.equal(stopForAmount(31, limits), 3);
});

test('all legal slider stops round-trip for tiny stacks, off-grid boundaries and regular stacks', () => {
  for (let minTo=1; minTo<=20; minTo++) {
    for (let maxTo=minTo; maxTo<=40; maxTo++) {
      const limits = {minTo, maxTo};
      const {min,max} = sliderBounds(limits);
      assert.equal(amountAtStop(min, limits), minTo);
      assert.equal(amountAtStop(max, limits), maxTo);
      let previous = minTo;
      for (let tick=min; tick<=max; tick+=0.5) {
        const units = amountAtStop(tick, limits);
        assert.ok(units >= previous && units <= maxTo);
        assert.equal(amountAtStop(stopForAmount(units, limits), limits), units);
        previous = units;
      }
    }
  }
});
