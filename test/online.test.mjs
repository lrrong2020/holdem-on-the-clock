import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createInterface } from 'node:readline';

test('online launcher binds the service, advertises the issued origin and shuts down both processes', {timeout:10000}, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'folio-tunnel-fixture-'));
  const publicOrigin = 'https://test-fixture.trycloudflare.com';
  const mock = '#!/usr/bin/env node\nconsole.error("Visit ' + publicOrigin + '");\nsetInterval(()=>{},1000);\n';
  await writeFile(join(dir, 'cloudflared'), mock, {mode:0o755});
  const child = spawn(process.execPath, ['scripts/online.mjs'], {
    env:{...process.env,PORT:'0',PATH:dir + delimiter + process.env.PATH},
    stdio:['ignore','pipe','pipe']
  });
  const ended = once(child, 'exit');
  try {
    const output = createInterface({input:child.stdout});
    let local;
    for await (const line of output) {
      if (line.startsWith('Local workspace: ')) local = line.slice('Local workspace: '.length);
      if (line.includes(publicOrigin)) break;
    }
    assert.ok(local);
    const response = await fetch(local + '/api/address');
    assert.equal((await response.json()).publicOrigin, publicOrigin);
    assert.equal((await fetch(local)).status, 200);
  } finally {
    child.kill('SIGTERM');
    const [code] = await ended;
    await rm(dir,{recursive:true,force:true});
    assert.equal(code,0);
  }
});
