import assert from 'node:assert/strict';
import test from 'node:test';
import {chatKey, createChatStore} from '../public/chat-content.js';

const alice = {roomId:'a',me:{id:'one',name:'Sam'}};
const bob = {roomId:'a',me:{id:'two',name:'Sam'}};
const elsewhere = {roomId:'b',me:{id:'one'}};

function workspace() {
  const rows = new Map();
  const storage = {
    get length() { return rows.size; },
    key: i => [...rows.keys()][i] ?? null,
    getItem: k => rows.get(k) ?? null,
    setItem: (k, v) => rows.set(k, String(v))
  };
  return {storage, tab: () => createChatStore(() => storage)};
}

test('all five bilingual conversations have alternating, individually addressable turns', () => {
  const api = workspace().tab();
  for (let thread = 0; thread < 5; thread++) {
    const en = api.getMessages(null, thread, 'en'), zh = api.getMessages(null, thread, 'zh');
    assert.deepEqual(en.map(m=>m.id), zh.map(m=>m.id));
    assert.equal(en.length, thread === 0 ? 6 : 4);
    assert.equal(new Set(en.map(m=>m.id)).size, en.length);
    for (let i = 0; i < en.length; i++) {
      assert.equal(en[i].role, i % 2 ? 'assistant' : 'user');
      assert.notEqual(en[i].text, zh[i].text);
    }
  }
  assert.match(api.getMessages(null, 0, 'zh')[1].text, /\| 缓存命中率 \| 91% \| 96% \|/);
});

test('a seat gets an independent snapshot of pre-seat edits, titles and appended exchanges', () => {
  const fixture = workspace(), api = fixture.tab();
  api.saveMessage(null, 1, 'en', 'sample-2', 'Ship samples on Monday.');
  api.saveChatTitle(null, 1, 'en', 'Shipping');
  const notes = api.appendExchange(null, 1, 'en', 'When do we ship samples?');
  api.prepareChatContent(alice);
  api.saveMessage(null, 1, 'en', 'sample-2', 'Ship samples on Tuesday.');
  api.saveChatTitle(null, 1, 'en', 'Dispatch');
  const reopened = fixture.tab();
  assert.equal(reopened.getChatTitle(alice,1,'zh'), 'Shipping');
  assert.equal(reopened.getMessages(alice,1,'zh')[1].text,'Ship samples on Monday.');
  assert.deepEqual(reopened.getMessages(alice,1,'zh').slice(-2),[notes.user,notes.assistant]);
  assert.equal(reopened.getMessages(bob,1,'zh')[1].text,'Ship samples on Tuesday.');
  assert.equal(reopened.getChatTitle(elsewhere,1,'en'),'Dispatch');
  reopened.saveMessage(alice,1,'en',notes.user.id,'My private note.');
  assert.equal(reopened.getMessages(null,1,'en').at(-2).text, notes.user.text);
  assert.equal(reopened.getMessages(bob,1,'en').at(-2).text, notes.user.text);
  assert.notEqual(chatKey(alice),chatKey(elsewhere));
});

test('saving one message preserves all other locale defaults; restoring a sample re-enables translation', () => {
  const api = workspace().tab();
  const sample = api.getMessages(null,2,'en')[0].text;
  api.saveMessage(null,2,'en','sample-1','Périmètre de livraison');
  assert.equal(api.getMessages(null,2,'zh')[0].text, 'Périmètre de livraison');
  assert.match(api.getMessages(null,2,'zh')[1].text, /余量|高峰/);
  api.saveMessage(null,2,'en','sample-1',sample);
  assert.notEqual(api.getMessages(null,2,'zh')[0].text, sample);
  api.saveChatTitle(null,2,'en','Latency budget');
  assert.equal(api.getChatTitle(null,2,'zh'),'延迟预算');
});

test('two open tabs keep distinct message edits and append complete pairs in order', () => {
  const fixture = workspace(), front = fixture.tab(), back = fixture.tab();
  const original = back.getMessages(alice, 0, 'en');
  front.saveMessage(alice,0,'en',original[1].id,'The dial setting is 47.');
  back.saveMessage(alice,0,'zh',original[2].id,'Check the dial after lunch.');
  const first = front.appendExchange(alice,0,'en','What is the dial setting?');
  const next = back.appendExchange(alice,0,'en','What about lunch?');
  assert.notEqual(first.user.id, next.user.id);
  assert.match(first.assistant.text, /dial setting is 47/);
  assert.match(next.assistant.text, /lunch/);
  const shown = front.getMessages(alice,0,'zh');
  assert.equal(shown[1].text,'The dial setting is 47.');
  assert.equal(shown[2].text,'Check the dial after lunch.');
  assert.deepEqual(shown.slice(-4),[first.user,first.assistant,next.user,next.assistant]);
  assert.ok(Array.from({length:fixture.storage.length},(_,i)=>fixture.storage.key(i)).every(k=>k.startsWith(chatKey(alice))));
});

test('replies quote relevant current content and do not infer old metrics for a replaced topic', () => {
  const api = workspace().tab();
  assert.match(api.appendExchange(null,0,'zh','缓存命中率是多少？').assistant.text,/96%/);
  api.saveMessage(null,0,'zh','sample-2','展品周四送到。\n\n布展负责人是梁欣，展架一共有八组。');
  const current = api.appendExchange(null,0,'zh','布展负责人是谁？').assistant.text;
  assert.match(current,/梁欣/);
  const unrelated = api.appendExchange(null,0,'en','Do we need an umbrella?').assistant.text;
  assert.doesNotMatch(unrelated,/canary|184|96%|0.27%|展架/i);
  assert.match(unrelated,/keyword/);
});

test('storage errors surface on each write and do not leave half an exchange or a false edit', () => {
  const fixture = workspace(), api = fixture.tab();
  const before = api.getMessages(alice,0,'en');
  fixture.storage.setItem = () => { throw Error('Quota exceeded'); };
  assert.throws(()=>api.appendExchange(alice,0,'en','Rollout?'),/Quota exceeded/);
  assert.throws(()=>api.saveMessage(alice,0,'en',before[0].id,'draft'),/Quota exceeded/);
  assert.throws(()=>api.saveChatTitle(alice,0,'en','New title'),/Quota exceeded/);
  assert.deepEqual(api.getMessages(alice,0,'en'),before);
  const denied = createChatStore(()=>{throw Error('Denied');});
  assert.equal(denied.getMessages(alice,0,'zh').length,6);
  assert.throws(()=>denied.saveMessage(alice,0,'zh',before[0].id,'草稿'),/Denied/);
});
