import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';

const script = fileURLToPath(new URL('./kernel-worker.py', import.meta.url));
const actions = new Set(['fold', 'call', 'half', 'pot', 'allin']);

// One worker holds one checkpoint for all tables. Requests carry their full
// history so an aborted or superseded turn cannot advance another table.
export async function startKernel(directory, {
  python = process.env.KERNEL_PYTHON || 'python3',
  executable = process.env.KERNEL_WORKER_EXECUTABLE
} = {}) {
  if (!executable && (typeof directory !== 'string' || !directory)) throw new Error('Set the local Kernel directory.');
  const child = spawn(executable || python, executable ? [] : ['-I', '-B', '-u', script, directory], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore']
  });
  const lines = createInterface({input: child.stdout, crlfDelay: Infinity});
  const pending = new Map();
  let serial = 0;
  let stopped = false;
  let ready = false;
  let startResolve, startReject;
  const startup = new Promise((resolve, reject) => { startResolve = resolve; startReject = reject; });
  const closed = new Promise(resolve => child.once('close', resolve));
  function stop(reason) {
    if (stopped) return;
    stopped = true;
    startReject(reason);
    for (const item of pending.values()) item.finish(reason);
    lines.close();
    child.stdin.destroy();
    if (child.pid && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  const failed = () => stop(new Error(ready ? 'Kernel worker stopped.' :
    'Could not start Kernel. Check Python, the local bot directory, its checkpoint and C compiler.'));
  child.once('error', failed);
  child.once('exit', failed);
  child.stdin.on('error', failed);
  lines.on('line', line => {
    let data;
    try { data = JSON.parse(line); } catch { return failed(); }
    if (!data || typeof data !== 'object') return failed();
    if (!ready) {
      if (data.ready !== true || !Number.isSafeInteger(data.iterations) || data.iterations < 1) return failed();
      ready = true;
      startResolve();
      return;
    }
    const item = pending.get(data.id);
    if (!item) return; // A reply can arrive after a request was cancelled.
    if (data.error || !actions.has(data.action) || typeof data.trained !== 'boolean') {
      item.finish(new Error('Kernel could not decide this turn.'));
    } else {
      item.finish(null, {action: data.action, trained: data.trained});
    }
  });
  const timer = setTimeout(() => stop(new Error('Kernel startup timed out.')), 30000);
  try { await startup; } finally { clearTimeout(timer); }

  async function decide(request, {signal} = {}) {
    signal?.throwIfAborted();
    if (stopped) return Promise.reject(new Error('Kernel worker stopped.'));
    if (pending.size >= 128) return Promise.reject(new Error('Kernel is busy.'));
    const id = ++serial;
    return new Promise((resolve, reject) => {
      const message = JSON.stringify({id, request}) + '\n';
      const abort = () => finish(signal.reason || new Error('Kernel decision cancelled.'));
      const deadline = setTimeout(() => finish(new Error('Kernel decision timed out.')), 5000);
      function finish(error, value) {
        if (!pending.delete(id)) return;
        clearTimeout(deadline);
        signal?.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve(value);
      }
      pending.set(id, {finish});
      signal?.addEventListener('abort', abort, {once:true});
      child.stdin.write(message, err => { if (err) failed(); });
    });
  }

  return {
    decide,
    get available() { return !stopped; },
    close() {
      stop(new Error('Kernel worker closed.'));
      return closed;
    }
  };
}
