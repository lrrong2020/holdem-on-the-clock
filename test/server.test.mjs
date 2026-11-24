import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { makeServer } from '../server.mjs';

test('independent HTTP sessions can join by invitation, play, reconnect, end and reopen the same link', async t => {
  let time = 100000;
  const server = makeServer({publicOrigin:'https://example.invalid',roomOptions:{now:() => time}});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async () => {
    const closing = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closing;
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  async function request(path, data, cookie = '', extra = {}) {
    const response = await fetch(base + path,{method:data ? 'POST' : 'GET',headers:{
      'content-type':'application/json',cookie,...extra},body:data ? JSON.stringify(data) : undefined});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
  }
  const addresses = await request('/api/address');
  assert.equal(addresses.data.publicOrigin,'https://example.invalid');
  const remote = await request('/api/address',null,'',{'cf-connecting-ip':'192.0.2.1'});
  assert.deepEqual(remote.data.origins,[]);
  const created = await request('/api/create',{name:'Ada'});
  assert.equal(created.status,201);
  const roomId = created.data.roomId;
  assert.match(roomId,/^[a-zA-Z0-9_-]{20}$/);
  const path = '/api/rooms/' + roomId;
  const host = created.cookie.split(';')[0];
  assert.ok(created.cookie.includes('Path=' + path));
  assert.ok(created.cookie.includes('HttpOnly'));
  assert.equal((await request(path)).status,401);
  const joined = await request(path + '/join',{name:'Lin'});
  const guest = joined.cookie.split(';')[0];
  const command = (who, cmd) => request(path + '/command', cmd, who);
  assert.equal(joined.data.me.status,'pending');
  assert.equal((await command(guest,{type:'start'})).status,403);
  const id = joined.data.me.id;
  await command(host,{type:'approve',id});
  const starting = await command(host,{type:'start'});
  const first = starting.data.hand;
  const second = (await request(path,null,guest)).data.hand;
  assert.deepEqual(first.board,second.board);
  // Each connection sees both public seats and exclusively its own cards.
  assert.equal(first.players.filter(p => p.cards.length).length,1);
  assert.equal(second.players.filter(p => p.cards.length).length,1);
  assert.notEqual(first.players.find(p => p.cards.length).id, second.players.find(p => p.cards.length).id);
  const fold = {type:'action',turnKey:starting.data.turnKey,action:{type:'fold'}};
  assert.equal((await request(path + '/command',fold,host,{origin:'https://other.invalid'})).status,403);
  const after = await command(host,fold);
  assert.equal(after.status,200);
  assert.equal(after.data.hand.street,'complete');
  assert.equal((await command(host,fold)).status,409);
  const result = await request(path + '/history/1',null,guest);
  assert.deepEqual(result.data.pools,after.data.hand.pools);
  time += 29999;
  const resumed = await request(path,null,guest);
  assert.equal(resumed.data.me.id,id);
  await command(host,{type:'leave'});
  assert.equal((await request(path,null,host)).status,401);
  await command(guest,{type:'leave'});
  assert.equal((await request(path,null,guest)).status,404);
  const reopened = await request('/api/create',{name:'Lin',roomId});
  assert.equal(reopened.status,201);
  assert.deepEqual(reopened.data.history,[]);
  time += 30000;
  assert.equal((await request(path,null,reopened.cookie.split(';')[0])).status,404);
});

test('background presence holds a seat without UI polling and tab close starts a fresh grace period', async t => {
  let time = 100000;
  const server = makeServer({roomOptions:{now:() => time}});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(() => {server.closeAllConnections(); server.close();});
  const base = 'http://127.0.0.1:' + server.address().port;
  const created = await fetch(base + '/api/create',{method:'POST',headers:{'content-type':'application/json'},body:'{"name":"Ada"}'});
  const cookie = created.headers.get('set-cookie').split(';')[0];
  const url = base + '/api/rooms/' + (await created.json()).roomId;
  const controller = new AbortController();
  const opened = once(server,'request');
  const lease = fetch(url + '/presence',{headers:{cookie},signal:controller.signal}).catch(e => e.name);
  const [,response] = await opened;
  const closed = once(response,'close');
  time += 45000;
  // An anonymous probe does not renew lastSeen, but the held connection keeps the room alive.
  assert.equal((await fetch(url)).status,401);
  controller.abort();
  await Promise.all([lease,closed]);
  time += 29999;
  assert.equal((await fetch(url)).status,401);
  time++;
  assert.equal((await fetch(url)).status,404);
});
