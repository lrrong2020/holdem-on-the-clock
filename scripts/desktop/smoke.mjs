// Test an installed payload with only its embedded runtimes on the search path.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {join,resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';

const payload = resolve(process.argv[2]);
const bin = join(payload, process.platform === 'win32' ? 'node.exe' : 'node');
const env = {...process.env};
for (const key of Object.keys(env)) {
  if (/^(path|kernel_.*|python.*|node_options)$/i.test(key)) delete env[key];
}
env.PATH = process.platform === 'win32' ? join(env.SystemRoot || 'C:\\Windows','System32') : '/nonexistent';
const child = spawn(bin,[join(payload,'app','desktop.mjs')],{
  cwd:payload,env,stdio:['pipe','pipe','inherit']
});
const ended = once(child,'exit');
const timeout = setTimeout(()=>child.kill(),60000);
try {
  const lines = createInterface({input:child.stdout});
  let base;
  for await (const line of lines) {
    const ready = /^DESKTOP_READY (http:\/\/127\.0\.0\.1:\d+)$/.exec(line);
    if (ready) { base = ready[1]; break; }
  }
  assert.ok(base,'Installed application must print its ready address');
  const address = await (await fetch(base+'/api/address')).json();
  assert.equal(address.kernelAvailable,true);
  assert.match(await (await fetch(base)).text(),/Folio/);
  let roomPath, cookie;
  const post = async (path,data) => {
    const response = await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(cookie && {cookie})},body:JSON.stringify(data)});
    assert.ok(response.ok,await response.clone().text());
    if (!cookie) cookie = response.headers.get('set-cookie').split(';')[0];
    return response.json();
  };
  let state = await post('/api/create',{name:'Player',mode:'kernel'});
  roomPath = '/api/rooms/'+state.roomId;
  const bot = state.players.find(p=>p.bot==='kernel');
  assert.ok(bot);
  await post(roomPath+'/command',{type:'pause'});
  await post(roomPath+'/command',{type:'action',turnKey:state.turnKey,action:{type:'raise',amount:1000}});
  for (let attempt=0; attempt<100; attempt++) {
    state = await (await fetch(base+roomPath,{headers:{cookie}})).json();
    assert.ok(!state.kernelError,state.kernelError);
    if (state.hand?.street==='complete') break;
    await delay(100);
  }
  assert.equal(state.hand.street,'complete');
  assert.ok(state.hand.events.some(e=>e.id===bot.id && ['fold','call'].includes(e.type)));
  console.log('Installed application opened Folio, dealt and settled a hand with its bundled Kernel.');
} finally {
  child.stdin.end();
  const [code] = await ended;
  clearTimeout(timeout);
  assert.equal(code,0,'Application must exit cleanly when the launcher closes');
}
