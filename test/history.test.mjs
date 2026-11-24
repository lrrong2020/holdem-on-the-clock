import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { Room } from '../room.mjs';
import { makeServer } from '../server.mjs';
import { summarizeHistoryHand } from '../public/hand-summary.js';

test('history summary includes side pots, excludes uncalled chips, and separates sitting out from breaking even', () => {
  const hand = {
    number: 7, showdown: true, players: [
      {id:'short', cards:['As','8s'], startStack:200, stack:600},
      {id:'middle', cards:['Js','9c'], startStack:500, stack:0},
      {id:'deep', cards:['Ks','6c'], startStack:800, stack:900},
      {id:'folded', cards:['2s','2c'], startStack:100, stack:100}
    ],
    pools: [{amount:600}, {amount:600}, {amount:300, refund:true}]
  };
  const result = summarizeHistoryHand(hand, 'deep');
  assert.deepEqual(result, {number:7, showdown:true, pot:1200, cards:['Ks','6c'], played:true, net:100});
  result.cards.pop();
  assert.equal(hand.players[2].cards.length, 2);
  assert.equal(summarizeHistoryHand(hand, 'folded').net, 0);
  assert.equal(summarizeHistoryHand(hand, 'middle').net, -500);
  assert.deepEqual(summarizeHistoryHand(hand, 'late'), {
    number:7, showdown:true, pot:1200, cards:[], played:false, net:null
  });
});

test('exclusive history cursor stays stable when new hands settle; only completed hands are listed', () => {
  const room = new Room('example', 'Host');
  const host = room.authenticate(room.hostSession);
  const {user: guest} = room.join('Guest');
  room.command(host, {type:'approve',id:guest.id});
  const finish = () => {
    room.command(host, {type:'next'});
    const player = room.members.get(room.hand.actorId);
    room.command(player, {type:'action',turnKey:room.turnKey,action:{type:'fold'}});
  };
  assert.deepEqual(room.historyPage(host), {total:0, items:[], nextBefore:null});
  for (let i=0; i<3; i++) finish();
  const first = room.historyPage(host, null, 2);
  assert.deepEqual(first.items.map(i=>i.number), [3,2]);
  assert.equal(first.total, 3);
  assert.equal(first.nextBefore, 2);
  finish();
  const older = room.historyPage(host, first.nextBefore, 2);
  assert.deepEqual(older.items.map(i=>i.number), [1]);
  assert.equal(older.nextBefore, null);
  assert.equal(older.total, 4);
  room.command(host, {type:'next'});
  assert.deepEqual(room.historyPage(host).items.map(i=>i.number), [4,3,2,1]);
  assert.deepEqual(room.historyPage(host, 1), {total:4,items:[],nextBefore:null});
});

test('HTTP history picker requires a seat, filters hole cards by session and validates the page range', async t => {
  const server = makeServer({roomOptions:{now:()=>100000}});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(() => {
    server.closeAllConnections();
    return new Promise(resolve => server.close(resolve));
  });
  const origin = 'http://127.0.0.1:' + server.address().port;
  async function post(path, data, cookie='') {
    const response = await fetch(origin+path, {
      method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify(data)
    });
    assert.ok(response.ok);
    return {body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const host = await post('/api/create',{name:'Host'});
  const path = '/api/rooms/'+host.body.roomId;
  const guest = await post(path+'/join',{name:'Guest'});
  const get = (cookie='',query='') => fetch(origin+path+'/history'+query,{headers:{cookie}});
  assert.equal((await get()).status, 401);
  assert.equal((await get(guest.cookie)).status, 403);
  await post(path+'/command',{type:'approve',id:guest.body.me.id},host.cookie);
  const start = await post(path+'/command',{type:'start'},host.cookie);
  assert.deepEqual(await (await get(host.cookie)).json(), {total:0,items:[],nextBefore:null});
  await post(path+'/command',{type:'action',turnKey:start.body.turnKey,action:{type:'fold'}},host.cookie);
  const hostResult = await (await get(host.cookie)).json();
  const guestResult = await (await get(guest.cookie,'?viewerId='+host.body.me.id)).json();
  assert.equal(hostResult.items[0].net, -5);
  assert.equal(guestResult.items[0].net, 5);
  assert.equal(guestResult.items[0].pot, 10);
  assert.equal(guestResult.items[0].showdown, false);
  assert.deepEqual(hostResult.items[0].cards, start.body.hand.players.find(p=>p.id===host.body.me.id).cards);
  assert.deepEqual(guestResult.items[0].cards.length, 2);
  assert.ok(hostResult.items[0].cards.every(card=>!guestResult.items[0].cards.includes(card)));
  for (const badQuery of ['?before=0','?before=-1','?before=bad','?limit=0','?limit=101','?limit=1.5']) {
    assert.equal((await get(host.cookie,badQuery)).status, 400);
  }
  const late = await post(path+'/join',{name:'Late'});
  await post(path+'/command',{type:'approve',id:late.body.me.id},host.cookie);
  const lateResult = await (await get(late.cookie)).json();
  assert.deepEqual(lateResult.items, [{number:1,showdown:false,played:false,pot:10,cards:[],net:null}]);
  await post(path+'/command',{type:'leave'},guest.cookie);
  assert.equal((await get(guest.cookie)).status, 401);
});
