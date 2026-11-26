import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startKernel } from '../kernel-client.mjs';
import { makeServer } from '../server.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function botDirectory() {
  const override = process.argv[2] || process.env.KERNEL_BOT_DIR;
  if (override) return resolve(override);
  try {
    const saved = await readFile(resolve(root,'.runtime/kernel-dir'),'utf8');
    if (saved.trim()) return resolve(root,saved.trim());
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return resolve(root,'../low-fi-poker-bot');
}

async function start() {
  const port = Number(process.env.PORT ?? 4180);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT.');
  const kernel = await startKernel(await botDirectory(), {python:process.env.KERNEL_PYTHON || 'python3'});
  const server = makeServer({kernel,publicOrigin:null});
  function stop() {
    server.closeAllConnections();
    server.close();
    kernel.close();
  }
  server.once('error', err => {
    console.error('Could not start the Kernel table:',err.message);
    process.exitCode = 1;
    stop();
  });
  process.once('SIGTERM',stop);
  process.once('SIGINT',stop);
  server.listen(port,'127.0.0.1',() => {
    console.log('Kernel table ready at http://127.0.0.1:' + server.address().port);
  });
}

start().catch(err => {
  console.error('Could not start the Kernel opponent:',err.message);
  process.exitCode = 1;
});
