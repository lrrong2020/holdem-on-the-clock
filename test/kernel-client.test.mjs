import assert from 'node:assert/strict';
import {appendFile, copyFile, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {startKernel} from '../kernel-client.mjs';

const bundledKernel = fileURLToPath(new URL('../kernel/', import.meta.url));
const kernelPlatform = ['darwin','linux'].includes(process.platform);

test('the worker checks startup, correlates concurrent replies, and releases pending turns', {
  skip: process.platform === 'win32' && 'Kernel requires macOS or Linux'
}, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'kernel test '));
  t.after(() => rm(directory, {recursive:true, force:true}));
  const python = join(directory, 'worker.cjs');
  await writeFile(python, `#!${process.execPath}
const lines = require('node:readline').createInterface({input:process.stdin});
const send = data => console.log(JSON.stringify(data));
send({ready:true, iterations:1});
lines.on('line', line => {
  const {id,request} = JSON.parse(line);
  if (request.exit) process.exit(2);
  if (request.hang) return;
  setTimeout(() => send({id, action:request.action, trained:true}), request.delay || 0);
});
`, {mode:0o700});
  await assert.rejects(startKernel(directory, {python:join(directory, 'missing')}), /start Kernel/);
  const worker = await startKernel(directory, {python});
  t.after(() => worker.close());
  assert.equal(worker.available, true);
  const [first, second] = await Promise.all([
    worker.decide({action:'fold', delay:30}), worker.decide({action:'call'})
  ]);
  assert.deepEqual(first, {action:'fold', trained:true});
  assert.deepEqual(second, {action:'call', trained:true});
  await assert.rejects(worker.decide({action:'invalid'}), /could not decide/);

  const controller = new AbortController();
  const cancelled = worker.decide({action:'half', delay:25}, {signal:controller.signal});
  controller.abort();
  await assert.rejects(cancelled, {name:'AbortError'});
  assert.equal((await worker.decide({action:'pot', delay:40})).action, 'pot');

  await Promise.all([
    assert.rejects(worker.decide({hang:true}), /worker stopped/),
    assert.rejects(worker.decide({exit:true}), /worker stopped/)
  ]);
  assert.equal(worker.available, false);
  await assert.rejects(worker.decide({action:'call'}), /worker stopped/);
});

test('the bundled checkpoint rejects missing data and changes to a valid pickle', {
  skip: !kernelPlatform && 'Kernel requires macOS or Linux'
}, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'kernel integrity '));
  t.after(() => rm(directory, {recursive:true, force:true}));
  for (const name of ['main.py','game.py','cards.py','solver.py','cards_native.c']) {
    await copyFile(join(bundledKernel, name), join(directory, name));
  }
  await mkdir(join(directory, 'model'));
  const checkpoint = join(directory, 'model', 'checkpoint.pkl');
  await assert.rejects(startKernel(directory), /start Kernel/);

  await copyFile(join(bundledKernel, 'model', 'checkpoint.pkl'), checkpoint);
  const valid = await startKernel(directory);
  await valid.close();
  // pickle.load accepts trailing data. The bundled digest covers the entire file.
  await appendFile(checkpoint, '\n');
  await assert.rejects(startKernel(directory), /start Kernel/);
});

test('the bundled opponent finds trained preflop and postflop decisions', {
  skip: !kernelPlatform && 'Kernel requires macOS or Linux'
}, async t => {
  const worker = await startKernel(bundledKernel);
  t.after(() => worker.close());
  const preflop = {actions:[], cards:['As','5c'], board:[], actor:0};
  const flop = {actions:['call','call'], cards:['Ks','5h'], board:['Qs','9s','3s'], actor:1};
  const opening = await worker.decide(preflop);
  const flopDecision = await worker.decide(flop);
  assert.equal(opening.trained, true);
  assert.equal(flopDecision.trained, true);
  assert.ok(['fold','call','half','pot','allin'].includes(opening.action));
  assert.ok(['call','half','pot','allin'].includes(flopDecision.action));
  await assert.rejects(worker.decide({...flop, actor:0}), /could not decide/);
  await assert.rejects(worker.decide({...flop, board:[]}), /could not decide/);
  await assert.rejects(worker.decide({...flop, cards:['3s','Ad']}), /could not decide/);
  assert.equal(worker.available, true);
  await worker.close();
  assert.equal(worker.available, false);
});
