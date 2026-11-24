import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDocumentStore, documentKey} from '../public/document.js';

const alice = {roomId:'room-one', me:{id:'one',name:'Joy'}};
const bob = {roomId:'room-one', me:{id:'two',name:'Joy'}};
const nextRoom = {roomId:'room-two', me:{id:'one',name:'Joy'}};
function fixture() {
  const rows = new Map();
  const storage = {getItem:key=>rows.get(key) ?? null, setItem:(key,value)=>rows.set(key,value)};
  const open = ()=>createDocumentStore(()=>storage);
  return {rows, open};
}

test('documents survive a browser reload and stay scoped to the room and player rather than nickname',()=>{
  const {open} = fixture();
  const saved = {title:'My release plan',body:'<b>原样保留</b>\n\nMilestones'};
  open().save(alice,saved,'zh');
  assert.deepEqual(open().read(alice),saved);
  assert.equal(open().read(bob),null);
  assert.equal(open().read(nextRoom),null);
  assert.equal(open().read(null),null);
});

test('the pre-seat template seeds new players and a seat save never changes the template',()=>{
  const {open} = fixture();
  const store = open();
  const template = {title:'工程笔记',body:'观察项'};
  const updated = {title:'工程笔记',body:'首日观测\n项目二'};
  store.save(null,template,'zh');
  assert.deepEqual(store.read(alice),template);
  store.save(alice,updated,'en');
  assert.deepEqual(store.read(alice),updated);
  assert.deepEqual(store.read(bob),template);
  assert.deepEqual(store.read(null),template);
});

test('an explicit sample reset remains independent of the local template',()=>{
  const {rows,open} = fixture();
  const store = open();
  store.save(null,{title:'Lobby',body:'Notes'},'en');
  rows.set(documentKey(alice),JSON.stringify({sample:true}));
  assert.equal(store.read(alice),null);
});

test('invalid or inaccessible storage leaves the example available; failed writes do not replace a saved document',()=>{
  const {rows,open} = fixture();
  rows.set(documentKey(alice),'{invalid');
  assert.equal(open().read(alice),null);
  rows.set(documentKey(alice),JSON.stringify({title:'missing body'}));
  assert.equal(open().read(alice),null);
  const blocked = createDocumentStore(()=>{throw Error('Storage unavailable');});
  assert.equal(blocked.read(alice),null);
  assert.throws(()=>blocked.save(alice,{title:'T',body:'B'},'zh'),/Storage unavailable/);
  assert.equal(blocked.read(alice),null);
});

test('opt-in template update seeds future seats while both saved and untouched existing seats retain their copies',()=>{
  const {open} = fixture();
  const store = open();
  const initial = {title:'Initial',body:'On this device'};
  const edited = {title:'Updated',body:'For future sessions'};
  store.save(null,initial,'en');
  assert.deepEqual(store.read(alice),initial);
  assert.deepEqual(store.read(bob),initial);
  assert.deepEqual(store.save(alice,edited,'zh',true),{templateSaved:true});
  assert.deepEqual(open().read(null),edited);
  assert.deepEqual(open().read(alice),edited);
  assert.deepEqual(open().read(bob),initial);
  assert.deepEqual(open().read(nextRoom),edited);
});

test('failed optional template write leaves a valid seat copy and the previous workspace template',()=>{
  const rows = new Map();
  const workspace = documentKey(null);
  let failTemplate = false;
  const store = createDocumentStore(()=>({
    getItem:key=>rows.get(key) ?? null,
    setItem(key,value) {
      if (key === workspace && failTemplate) throw Error('Quota exceeded');
      rows.set(key,value);
    }
  }));
  const previous = {title:'Original',body:'old'};
  const next = {title:'Revised',body:'new'};
  store.save(null,previous,'en');
  failTemplate = true;
  assert.deepEqual(store.save(alice,next,'en',true),{templateSaved:false});
  assert.deepEqual(store.read(alice),next);
  assert.deepEqual(store.read(null),previous);
});

test('legacy main copy and four sidebar documents retain separate sources and titles after reload',()=>{
  const {rows,open} = fixture();
  const original = {title:'Old title',body:'## Private main document'};
  rows.set('folio.personal-document.v1.room-one/one',JSON.stringify(original));
  const store = open();
  const notes = [1,2,3,4].map(index=>({title:'Review '+index,body:'**Private**\n\nRow '+index}));
  notes.forEach((note,index)=>store.save(alice,note,'en',false,index+1));
  const reloaded = open();
  assert.deepEqual(reloaded.read(alice),original);
  notes.forEach((note,index)=>{
    assert.deepEqual(reloaded.read(alice,index+1),note);
    assert.equal(reloaded.read(bob,index+1),null);
    assert.equal(reloaded.read(nextRoom,index+1),null);
    assert.equal(reloaded.read(null,index+1),null);
  });
});

test('a sidebar template changes only that document for newly entering seats',()=>{
  const {open} = fixture();
  const store = open();
  const template = {title:'模板',body:'| 区域 | 指标 |'};
  store.save(null,template,'zh',false,2);
  assert.deepEqual(store.read(bob,2),template);
  const edited = {title:'Edited',body:'## Later revision'};
  store.save(alice,edited,'en',true,2);
  assert.deepEqual(open().read(alice,2),edited);
  assert.deepEqual(open().read(nextRoom,2),edited);
  assert.deepEqual(open().read(bob,2),template);
  for (const index of [0,1,3,4]) assert.equal(open().read(nextRoom,index),null);
});
