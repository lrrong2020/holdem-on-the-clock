import test from 'node:test';
import assert from 'node:assert/strict';
import {initialTranscript, terminalFrames} from '../public/terminal.js';

test('the first command types onto one line and preserves the preceding transcript', () => {
  const frames = terminalFrames();
  const lines = [...initialTranscript];
  const fragments = [];
  for (let i = 0; i < 50; i++) {
    const frame = frames.next().value;
    if (frame.kind !== 'command') break;
    if (frame.replace) lines.pop();
    lines.push(frame);
    fragments.push(frame.text);
  }
  assert.equal(lines.length, initialTranscript.length + 1);
  assert.equal(fragments.at(-1), 'git diff --stat');
  assert.ok(fragments.length > 1);
  assert.ok(fragments.every((text, i) => !i || text.startsWith(fragments[i - 1])));
});

test('successive terminal runs complete all checks on one progress line and restart', () => {
  const progress = [];
  const reports = [];
  const frames = terminalFrames();
  for (let i = 0; i < 1000 && reports.length < 5; i++) {
    const frame = frames.next().value;
    assert.ok(Number.isFinite(frame.delay) && frame.delay > 0);
    if (frame.kind === 'progress') {
      const checked = Number(frame.text.match(/(\d+)\/12 checks$/)[1]);
      assert.equal(checked, progress.length);
      assert.equal(frame.replace, checked > 0);
      progress.push(checked);
    }
    if (frame.text.startsWith('healthy')) {
      assert.equal(progress.length, 13);
      reports.push(frame.text);
      progress.length = 0;
    }
  }
  assert.equal(reports.length, 5);
  assert.equal(new Set(reports).size, 4);
  assert.equal(reports[0], reports[4]);
});
