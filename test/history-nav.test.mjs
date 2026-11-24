import test from 'node:test';
import assert from 'node:assert/strict';
import {makeHistorySource, handOptionLabel} from '../public/history-nav.js';

const summary = {number:23, cards:['Th','As'], played:true, pot:240, net:-120, showdown:true};

test('picker labels identify the viewer, signed net and awarded pot in both languages', () => {
  assert.equal(handOptionLabel(summary,'en'), '#23 · 10♥ A♠ · −12 BB · Pot 24 BB');
  assert.equal(handOptionLabel({...summary, net:15},'zh'), '#23 · 10♥ A♠ · +1.5 BB · 底池 24 BB');
  assert.match(handOptionLabel({...summary, net:0},'zh'), /持平/);
  assert.equal(handOptionLabel({...summary, cards:[], played:false, net:null},'zh'), '#23 · 未参局 · 底池 24 BB');
});

test('modern servers need only one private summary request for a page', async () => {
  const calls = [];
  const source = makeHistorySource(async url => { calls.push(url); return {items:[summary]}; },'testroom','viewer');
  assert.deepEqual(await source.summaries([23],()=>true),[summary]);
  assert.deepEqual(calls, ['/api/rooms/testroom/history?before=24&limit=1']);
});

test('older live rooms keep working with bounded, deduplicated, viewer-scoped detail requests', async () => {
  const calls = [];
  let current = 0, peak = 0;
  const read = async url => {
    calls.push(url);
    if (url.includes('?')) throw Object.assign(new Error('Old route'),{status:404});
    peak = Math.max(peak, ++current);
    await new Promise(resolve => setImmediate(resolve));
    current--;
    return {number:Number(url.split('/').pop()),showdown:false,
      players:[{id:'viewer',cards:['Th','As'],startStack:1000,stack:880},{id:'guest',cards:[],startStack:1000,stack:1120}],
      pools:[{amount:240,refund:false},{amount:100,refund:true}]};
  };
  const source = makeHistorySource(read,'testroom','viewer');
  const ids = [23,22,21,20,19,18];
  const [detail, rows] = await Promise.all([source.detail(23),source.summaries(ids,()=>true)]);
  assert.equal(detail.number,23);
  assert.deepEqual(rows[0], {...summary,showdown:false});
  assert.deepEqual(rows.map(row=>row.number),ids);
  assert.ok(peak<=4);
  assert.equal(calls.filter(url=>url.endsWith('/23')).length,1);
  await source.summaries([21],()=>true);
  await source.detail(21);
  assert.equal(calls.length,ids.length+1);
});

test('access and availability errors never trigger compatibility fetches', async () => {
  for (const status of [401,403,503]) {
    let calls=0;
    const source=makeHistorySource(async()=>{ calls++; throw Object.assign(Error('Unavailable'),{status}); },'testroom','viewer');
    await assert.rejects(source.summaries([5,4],()=>true),{status});
    assert.equal(calls,1);
  }
});
