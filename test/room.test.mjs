import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, fetchCloudMove } from '../room.mjs';

function setup(options = {}) {
  let time = 100000;
  const room = new Room('example', 'Ada', {now:() => time,...options});
  const host = room.authenticate(room.hostSession);
  const step = ms => {time += ms; room.tick()};
  const join = name => {
    const {user, secret} = room.join(name);
    room.command(host,{type:'approve',id:user.id});
    return {user,secret};
  };
  const move = type => room.command(room.members.get(room.hand.actorId),{type:'action', turnKey:room.turnKey,action:{type}});
  return {room,host,join,move,step};
}

test('pending guests are isolated, approvals preserve identity, and admission is capped at nine', () => {
  const {room,host} = setup();
  const guest = room.join('Lin');
  const waiting = room.snapshot(guest.user);
  assert.equal(waiting.hand, null);
  assert.deepEqual(waiting.players, []);
  assert.throws(() => room.command(guest.user,{type:'approve',id:guest.user.id}), /Host/);
  for (let i = 0; i < 8; i++) room.command(host,{type:'addBot',mode:'local'});
  assert.throws(() => room.command(host,{type:'approve',id:guest.user.id}), /nine/);
  assert.equal(room.requests.size,1);
  room.command(host,{type:'start'});
  assert.equal(room.hand.players.length,9);
  assert.equal(room.snapshot(guest.user).hand, null);
  assert.throws(() => room.handHistory(guest.user,1), /seat/);
  assert.equal(room.join('Ignored',guest.secret).user,guest.user);
});

test('offline declined sessions expire and can request their name again; live and pending requests are preserved', () => {
  const {room,host,step} = setup();
  host.presences = 1;
  const gone = room.join('River'), watching = room.join('Lou'), waiting = room.join('Zev');
  step(60000); // The host can still act on a request submitted while they were away.
  for (const candidate of [gone,watching]) room.command(host,{type:'reject',id:candidate.user.id});
  watching.user.presences = 1;
  step(29999);
  assert.equal(room.members.get(gone.user.id).status,'declined');
  step(1);
  assert.equal(room.members.has(gone.user.id),false);
  assert.equal(room.sessions.has(gone.secret),false);
  assert.equal(room.authenticate(watching.secret).status,'declined');
  assert.equal(room.authenticate(waiting.secret).status,'pending');
  assert.equal(room.requests.has(waiting.user.id),true);
  const retry = room.join('River',gone.secret);
  assert.equal(retry.user.status,'pending');
  assert.notEqual(retry.user.id,gone.user.id);
  room.command(host,{type:'approve',id:retry.user.id});
  assert.equal(room.authenticate(retry.secret).status,'seated');
});

test('turn revisions, invalid input, host permissions and private history', () => {
  const {room,host,join} = setup();
  const guest = join('Lin').user;
  room.command(host,{type:'start'});
  const turnKey = room.turnKey;
  const cmd = {type:'action',turnKey,action:{type:'fold'}};
  const first = room.snapshot(host).hand;
  assert.equal(first.players.find(p => p.id === host.id).cards.length,2);
  assert.equal(first.players.find(p => p.id === guest.id).cards.length,0);
  assert.throws(() => room.command(host,{...cmd,action:{type:'raise',amount:2}}));
  assert.equal(room.turnKey,turnKey);
  assert.throws(() => room.command(guest,cmd));
  room.command(host,cmd);
  assert.throws(() => room.command(host,cmd));
  assert.equal(room.hand.street,'complete');
  assert.deepEqual(room.snapshot(guest).history,[1]);
  assert.deepEqual(room.handHistory(guest,1).players.find(p => p.id === host.id).cards, []);
  for (const type of ['stack','settings','next','pause','remove','addBot','cloud','reject']) assert.throws(() => room.command(guest,{type}),/Host/);
});

test('precise 15 + 10 + 10 expiry, persistent autofold, and voluntary return', () => {
  const {room,host,join,step} = setup();
  const friend = join('Lin');
  room.command(host,{type:'settings',baseSeconds:15,initialCards:2,cardSeconds:10});
  room.command(host,{type:'start'});
  const key = room.turnKey;
  step(14999);
  assert.equal(room.clock.phase,'base');
  step(1);
  assert.equal(room.clock.phase,'bank');
  assert.equal(host.cards,1);
  step(10000);
  assert.equal(host.cards,0);
  assert.equal(room.turnKey,key);
  room.authenticate(friend.secret);
  step(9999);
  assert.equal(host.auto,false);
  step(1);
  assert.equal(room.hand.street,'complete');
  assert.equal(room.hand.events.at(-1).type,'fold');
  assert.equal(room.snapshot(room.authenticate(room.hostSession)).me.auto,true);
  room.command(host,{type:'back'});
  assert.equal(host.auto,false);
  assert.equal(room.hand.players.find(p => p.id === host.id).folded,true);
});

test('unused bank time is discarded and auto-check can be reclaimed in the same hand', () => {
  const {room,host,join,step,move} = setup();
  const guest = join('Lin').user;
  room.command(host,{type:'settings',baseSeconds:1,initialCards:1,cardSeconds:2});
  room.command(host,{type:'start'});
  step(1000);
  assert.equal(host.cards,0);
  move('call');
  assert.equal(room.clock.phase,'base');
  step(3000);
  assert.equal(guest.auto,true);
  assert.equal(room.hand.street,'flop');
  assert.equal(room.hand.actorId,guest.id);
  room.command(guest,{type:'back'});
  move('check');
  assert.equal(room.hand.actorId,host.id);
});

test('bust and rebuy preserve request through full-table rejection; replenish time cards', () => {
  const {room,host,join,move} = setup();
  const guest = join('Lin').user;
  room.command(host,{type:'stack',id:host.id,amount:10});
  room.command(host,{type:'start'});
  // Replace the undealt runout with a valid deterministic board for this hand.
  room.hand.players[0].cards = ['2c','3d'];
  room.hand.players[1].cards = ['As','Ah'];
  room.hand.deck = ['4d','7s','9h','Tc','5s','Jd','6h','Kc'];
  move('call');
  assert.equal(host.status,'standing');
  assert.equal(host.seat,null);
  assert.equal(guest.stack,1010);
  for (let i=0;i<8;i++) room.command(host,{type:'addBot',mode:'local'});
  host.cards=0;
  room.command(host,{type:'rebuy',amount:12345678});
  assert.throws(() => room.command(host,{type:'approve',id:host.id}),/nine/);
  const bot = [...room.members.values()].find(p => p.bot);
  room.command(host,{type:'remove',id:bot.id});
  room.command(host,{type:'approve',id:host.id});
  assert.equal(host.stack,12345678);
  assert.equal(host.cards,2);
  assert.equal(host.status,'seated');
});

test('disconnect permits 30s grace, another human sustains room, last explicit leave clears state and key', () => {
  const {room,host,join,step} = setup();
  const guest = join('Lin');
  room.command(host,{type:'cloud',key:'private-room-key',primary:'primary'});
  room.command(host,{type:'addBot',mode:'cloud'});
  const hostSession = room.hostSession;
  step(29999);
  assert.equal(room.closed,false);
  room.authenticate(guest.secret);
  step(29999);
  assert.equal(room.closed,false);
  room.authenticate(hostSession);
  room.command(host,{type:'leave'});
  assert.throws(() => room.authenticate(hostSession),/Join/);
  const state = room.snapshot(room.authenticate(guest.secret));
  assert.equal(state.me.host,false);
  assert.ok(!JSON.stringify(state).includes('private-room-key'));
  room.command(guest.user,{type:'leave'});
  assert.equal(room.closed,true);
  assert.equal(room.cloud.key,'');
  assert.equal(room.members.size,0);
  const solo = setup();
  solo.step(30000);
  assert.equal(solo.room.closed,true);
});

test('cloud transport sends the key only as authorization to the fixed endpoint and parses a model move', async t => {
  const key = 'offline-test-placeholder';
  const hand = {board:[], players:[{id:'test-seat',cards:['As','Kh']}], legal:{check:true}};
  const signal = new AbortController().signal;
  const request = {key, model:'test-model', hand, signal};
  const action = {type:'check'};
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({
    message:{content:['```json', JSON.stringify(action), '```'].join('\n')}
  }));
  assert.deepEqual(await fetchCloudMove(request), action);
  fetchMock.mock.mockImplementationOnce(async () => Response.redirect('https://example.invalid', 302));
  await assert.rejects(fetchCloudMove(request), /Model unavailable/);
  assert.equal(fetchMock.mock.callCount(), 2);
  for (const call of fetchMock.mock.calls) {
    const [url, options] = call.arguments;
    assert.equal(url, 'https://ollama.com/api/chat');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.signal, signal);
    const headers = new Headers(options.headers);
    assert.equal(headers.get('authorization'), 'Bearer ' + key);
    headers.delete('authorization');
    assert.ok(!JSON.stringify([...headers]).includes(key));
    assert.ok(!options.body.includes(key));
    const body = JSON.parse(options.body);
    assert.equal(body.model, request.model);
    assert.deepEqual(JSON.parse(body.messages.find(m => m.role === 'user').content), hand);
  }
});

test('cloud model receives only own and public cards, falls back on illegal action, stale results ignored', async () => {
  const seen = [];
  let resolveDelayed;
  const cloudMove = async options => {
    seen.push(options);
    if (options.model === 'primary') return {type:'raise',amount:1};
    return new Promise(resolve => {resolveDelayed = resolve;});
  };
  const {room,host,move,step} = setup({cloudMove});
  room.command(host,{type:'cloud',key:'session-key',primary:'primary',fallback:'backup'});
  room.command(host,{type:'addBot',mode:'cloud'});
  room.command(host,{type:'start'});
  move('call');
  step(751);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(seen.map(o => o.model), ['primary','backup']);
  const request = seen[0];
  assert.equal(request.hand.players[0].cards.length,0);
  assert.equal(request.hand.players[1].cards.length,2);
  assert.equal(room.hand.events.filter(e => e.type === 'raise').length,0);
  const stale = room.hand;
  const eventCount = stale.events.length;
  room.command(host,{type:'leave'});
  assert.ok(request.signal.aborted);
  resolveDelayed({type:'check'});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stale.events.length,eventCount);
});

test('local bots act and committed games advance when host is offline but friends remain', () => {
  const {room,host,join,step,move} = setup();
  const guest = join('Lin');
  room.command(host,{type:'addBot',mode:'local'});
  room.command(host,{type:'start'});
  for (let i=0; room.inHand() && i<100; i++) {
    const actor = room.members.get(room.hand.actorId);
    if (actor.bot) step(800);
    else move(room.snapshot(actor).hand.legal.check ? 'check' : 'call');
  }
  assert.equal(room.hand.street,'complete');
  room.authenticate(guest.secret);
  step(5900);
  room.authenticate(guest.secret);
  step(110);
  assert.equal(room.hand.number,2);
  assert.equal(room.online(host),false);
});

test('fallback model completes a valid action with host offline and end-of-turn resets model work', async () => {
  const calls = [];
  const {room,host,join,step,move} = setup({cloudMove:async ({model, hand}) => {
    calls.push(model);
    if (model === 'main') throw new Error('Model unavailable');
    return {type:hand.legal.check ? 'check' : 'call'};
  }});
  const friend = join('Lin');
  room.command(host,{type:'cloud',key:'temporary',primary:'main',fallback:'backup'});
  room.command(host,{type:'addBot',mode:'cloud'});
  room.command(host,{type:'start'});
  while (room.hand.actorId !== [...room.members.values()].find(p => p.bot).id) move('call');
  step(5300);
  room.authenticate(friend.secret);
  assert.equal(room.online(host),false);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls,['main','backup']);
  assert.equal(room.hand.street,'flop');
  assert.equal(room.hand.events.filter(e => e.type === 'check').length,1);
  assert.equal(room.work,null);
});

test('removal during action retains committed chips and invalidates the session', () => {
  const {room,host,join,step,move} = setup();
  const friend = join('Lin');
  room.command(host,{type:'start'});
  room.command(host,{type:'action',turnKey:room.turnKey,action:{type:'raise',amount:25}});
  room.command(host,{type:'remove',id:friend.user.id});
  assert.throws(() => room.authenticate(friend.secret),/Join/);
  step(10);
  assert.equal(room.hand.street,'complete');
  assert.equal(room.hand.players.reduce((sum,p) => sum + p.stack,0),2000);
  assert.equal(room.members.size,1);
  assert.equal(room.handHistory(host,1).players.length,2);
});
