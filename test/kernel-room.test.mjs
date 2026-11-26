import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setImmediate as settled} from 'node:timers/promises';
import {Room} from '../room.mjs';

function practice(decide, name='Player') {
  let time = 1000;
  const room = new Room('practice', name, {now:() => time, kernel:{decide}, kernelMode:true});
  const host = room.authenticate(room.hostSession);
  const bot = [...room.members.values()].find(member => member.bot === 'kernel');
  host.presences = 1;
  const command = (type,fields={}) => room.command(host,{type,...fields});
  const move = (type,amount) => command('action',{turnKey:room.turnKey,action:{type,amount}});
  const tick = async (delta=750) => { time += delta; room.tick(); await settled(); };
  const legal = () => room.snapshot(host).hand.legal;
  command('start');
  return {room,host,bot,command,move,tick,legal};
}

test('Kernel seats are private, always heads-up, and cannot be reconfigured as a cash table', () => {
  assert.throws(() => new Room('id','P',{kernelMode:true}), /unavailable/);
  const {room,host,bot,command} = practice(async () => ({action:'call'}), 'Kernel');
  assert.equal(host.name,'Kernel');
  assert.equal(bot.name,'Kernel Bot');
  assert.equal(room.join('Kernel',room.hostSession).user,host);
  assert.throws(() => room.join('Guest'),/heads-up/);
  for (const type of ['stack','remove','rebuy','cloud','addBot','approve','reject']) {
    assert.throws(() => command(type,{id:bot.id,amount:20,mode:'local'}),/heads-up/);
  }
  assert.equal(room.snapshot(host).kernelMode,true);
  assert.equal(room.members.size,2);
});

test('Kernel validates both players against the checkpoint tree and sees only the acting seat and public board', async () => {
  const requests = [];
  const replies = ['pot','half','call'];
  const {room,host,bot,move,tick,legal} = practice(async request => {
    requests.push(request);
    return {action:replies.shift(),trained:true};
  });
  assert.deepEqual(legal().kernelRaises,[{label:'half',amount:20},{label:'pot',amount:30},{label:'allin',amount:1000}]);
  const before = room.turnKey;
  assert.throws(() => move('raise',25),/available Kernel action/);
  assert.throws(() => move('bet',20),/available Kernel action/);
  assert.equal(room.turnKey,before);

  move('raise',30);
  await tick();
  assert.deepEqual(requests[0],{actions:['pot'],board:[],cards:room.hand.players.find(p=>p.id===bot.id).cards,actor:1});
  assert.deepEqual(room.snapshot(host).hand.players.find(p=>p.id===bot.id).cards,[]);
  assert.equal(room.hand.currentTo,90);
  assert.equal(legal().raise,false);
  assert.deepEqual(legal().kernelRaises,[]);
  assert.throws(() => move('raise',1000),/available Kernel action/);
  move('call');
  await tick();
  assert.equal(room.hand.street,'flop');
  assert.deepEqual(requests[1].actions,['pot','pot','call']);
  assert.equal(requests[1].board.length,3);
  assert.equal(room.hand.currentTo,90);
  move('call');
  await tick();
  assert.equal(legal().fold,false);
  assert.throws(() => move('fold'),/available Kernel action/);
  move('check');
  assert.equal(room.hand.street,'river');
});

test('a bust leaves both seats ready for an independent 100 BB hand and rotates the button', async () => {
  const observed = [];
  const {room,host,bot,command,move,tick} = practice(async r => {
    observed.push(r);
    return {action:'call',trained:true};
  });
  move('raise',1000);
  await tick();
  assert.equal(room.hand.street,'complete');
  assert.equal(room.hand.pools[0].amount,2000);
  assert.equal(room.hand.players.reduce((sum,p)=>sum+p.stack,0),2000);
  assert.deepEqual([...room.members.values()].map(p=>p.stack),[1000,1000]);
  assert.equal(room.handHistory(host,1).showdown,true);
  command('next');
  assert.equal(room.hand.number,2);
  assert.deepEqual(room.hand.players.map(p=>p.startStack),[1000,1000]);
  assert.equal(room.hand.actorId,bot.id);
  await tick();
  assert.equal(observed.at(-1).actor,0);
  assert.deepEqual(observed.at(-1).actions,[]);
  assert.equal(room.hand.actorId,host.id);
});

test('a failed Kernel turn waits for explicit retry; an aborted late reply cannot act in its place', async () => {
  let resolveOld;
  const calls = [];
  const {room,host,bot,command,move,tick} = practice((request,{signal}) => {
    calls.push({request,signal});
    if (calls.length === 1) return new Promise(resolve => { resolveOld=resolve; });
    if (calls.length === 2) return Promise.resolve({action:'fold'}); // BB cannot fold a free option
    return Promise.resolve({action:'call',trained:true});
  });
  move('call');
  await tick();
  const originalPath = [...room.kernelPath];
  await tick(20000);
  assert.ok(calls[0].signal.aborted);
  assert.equal(room.snapshot(host).clock,null);
  assert.match(room.snapshot(host).kernelError,/Retry/);
  assert.equal(bot.auto,false);
  assert.equal(bot.cards,2);
  await tick(30000);
  assert.equal(calls.length,1);
  command('retryKernel');
  await tick();
  assert.match(room.snapshot(host).kernelError,/Retry/);
  assert.deepEqual(room.kernelPath,originalPath);
  command('retryKernel');
  resolveOld({action:'allin',trained:true});
  await tick();
  assert.equal(room.kernelError,'');
  assert.equal(room.hand.street,'flop');
  assert.deepEqual(room.kernelPath,['call','call']);
  assert.deepEqual(calls.map(({request})=>request),[calls[0].request,calls[0].request,calls[0].request]);
});

test('closing a Kernel room aborts outstanding work and ignores its response', async () => {
  let finish;
  let aborted;
  const {room,move,tick,command} = practice((request,{signal}) => {
    aborted=signal;
    return new Promise(resolve => { finish=resolve; });
  });
  move('call');
  await tick();
  command('leave');
  assert.equal(aborted.aborted,true);
  finish({action:'pot',trained:true});
  await settled();
  assert.equal(room.hand,null);
  assert.equal(room.closed,true);
});
