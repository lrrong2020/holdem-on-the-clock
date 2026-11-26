// The native launcher keeps stdin open for the life of the application.
import {fileURLToPath} from 'node:url';
import {startKernel} from './kernel-client.mjs';
import {makeServer} from './server.mjs';

const workerName = process.platform === 'win32' ? 'kernel-worker.exe' : 'kernel-worker';
const worker = fileURLToPath(new URL('../kernel-worker/' + workerName, import.meta.url));
const directory = fileURLToPath(new URL('./kernel/', import.meta.url));
let kernel, server;
let closing = false;

function stop() {
  closing = true;
  server?.closeAllConnections();
  server?.close();
  kernel?.close();
  process.stdin.pause();
}

process.stdin.once('end',stop);
process.stdin.resume();
process.once('SIGTERM',stop);
process.once('SIGINT',stop);

try {
  kernel = await startKernel(directory,{executable:worker});
  if (closing) {
    await kernel.close();
  } else {
    server = makeServer({kernel,publicOrigin:null});
    // Reuse one origin across launches so a user's local documents stay accessible.
    // If another program owns the preferred port, ask the OS for a free port.
    const bind = port => {
      server.once('error', err => {
        if (err.code === 'EADDRINUSE' && port !== 0) return bind(0);
        console.error('Could not open the table:',err.message);
        process.exitCode = 1;
        stop();
      });
      server.listen(port,'0.0.0.0');
    };
    server.once('listening',() => {
      console.log('DESKTOP_READY http://127.0.0.1:' + server.address().port);
    });
    bind(4181);
  }
} catch (err) {
  console.error('Could not open the table:',err.message);
  process.exitCode = 1;
  stop();
}
