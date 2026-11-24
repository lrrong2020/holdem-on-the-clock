// Bind our own HTTP service before giving the tunnel a destination.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { makeServer } from '../server.mjs';

const port = Number(process.env.PORT || 4173);
const server = makeServer({ publicOrigin: null });
let tunnel;
let stopping = false;
const stop = (code) => {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  tunnel?.kill('SIGTERM');
  server.closeAllConnections();
  server.close();
};
server.once('error', (err) => {
  console.error('Could not open the local service:', err.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  const local = 'http://127.0.0.1:' + server.address().port;
  console.log('Local workspace:', local);
  tunnel = spawn(
    'cloudflared',
    ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', local],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let published;
  for (const stream of [tunnel.stdout, tunnel.stderr]) {
    const lines = createInterface({ input: stream });
    lines.on('line', (line) => {
      const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i);
      if (match && match[0] !== published) {
        published = match[0];
        server.setPublicOrigin(published);
        console.log('Temporary HTTPS workspace:', published);
        console.log(
          'Create your session, then share its Invite members link. Press Ctrl+C to stop.'
        );
      }
      if (/\bERR\b/i.test(line)) console.error(line);
    });
  }
  tunnel.once('error', (err) => {
    console.error('Unable to start cloudflared:', err.message);
    stop(1);
  });
  tunnel.once('exit', (code, signal) => {
    if (!stopping) {
      console.error('The tunnel closed.', signal || code);
      stop(code || 1);
    }
  });
});
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
