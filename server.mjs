import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Room, RoomError, roomId } from './room.mjs';

const publicDirectory = resolve(dirname(fileURLToPath(import.meta.url)), 'public');
const validId = /^[A-Za-z0-9_-]{20}$/;
const types = {'.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.mjs':'text/javascript',
  '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.ico':'image/x-icon', '.webp':'image/webp'};
const loopback = host => ['127.0.0.1','::1','::ffff:127.0.0.1','localhost','[::1]'].includes(host);
function asOrigin(value) {
  if (!value) return null;
  const url = new URL(value);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_ORIGIN must be an HTTP(S) origin.');
  }
  return url.origin;
}
function json(res,status,data) {
  res.writeHead(status, {'content-type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(data));
}
async function body(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new RoomError('Send application/json.', 415);
  const blocks = [];
  let bytes = 0;
  for await (const block of req) {
    bytes += block.length;
    if (bytes > 16384) throw new RoomError('Request too large.', 413);
    blocks.push(block);
  }
  try {
    const value = JSON.parse(Buffer.concat(blocks).toString('utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch { /* Report malformed input uniformly. */ }
  throw new RoomError('Invalid JSON object.');
}
function session(req) {
  return (req.headers.cookie || '').split(/;\s*/).find(p => p.startsWith('ws_session='))?.slice(11);
}
function setSession(res, id, secret, secure) {
  res.setHeader('set-cookie', 'ws_session=' + secret + '; Path=/api/rooms/' + id + '; HttpOnly; SameSite=Strict' + (secure ? '; Secure' : '') + (secret ? '' : '; Max-Age=0'));
}
export function makeServer({publicOrigin = process.env.PUBLIC_ORIGIN, roomOptions = {}, staticDirectory = publicDirectory} = {}) {
  let origin = asOrigin(publicOrigin);
  const rooms = new Map();
  const quotas = new Map();
  const now = roomOptions.now || Date.now;
  function quota(address) {
    const time = now();
    let q = quotas.get(address);
    if (!q || q.until <= time) { q = {until:time+60000, count:0}; quotas.set(address,q); }
    if (++q.count > 80) throw new RoomError('Please wait before opening another session.',429);
  }
  function refresh(room) {
    room.tick();
    if (room.closed) { rooms.delete(room.id); throw new RoomError('Room expired.',404); }
  }
  const interval = setInterval(() => {
    for (const room of rooms.values()) {
      room.tick();
      if (room.closed) rooms.delete(room.id);
    }
    for (const [key,q] of quotas) if (q.until <= now()) quotas.delete(key);
  }, 200).unref();

  const server = createServer({requestTimeout:15000,headersTimeout:10000}, async (req, res) => {
    res.setHeader('referrer-policy','no-referrer');
    res.setHeader('x-content-type-options','nosniff');
    res.setHeader('cache-control','no-store');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const { pathname: path, searchParams } = new URL(req.url,'http://localhost');
      if (!path.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new RoomError('Method unavailable.',405);
        const filename = path === '/' || /^\/r\/[A-Za-z0-9_-]{20}\/?$/.test(path) ? '/index.html' : decodeURIComponent(path);
        if (filename.split('/').some(part => part.startsWith('.'))) throw new RoomError('Not found.',404);
        const file = resolve(staticDirectory, '.' + filename);
        if (!file.startsWith(staticDirectory + sep)) throw new RoomError('Not found.',404);
        let data;
        try { data = await readFile(file); } catch { throw new RoomError('Not found.',404); }
        res.writeHead(200, {'content-type':(types[extname(file)] || 'application/octet-stream') + (['.html','.js','.css','.mjs'].includes(extname(file)) ? '; charset=utf-8' : '')});
        res.end(req.method === 'HEAD' ? undefined : data);
        return;
      }
      if (req.method === 'GET' && path === '/api/address') {
        const hostname = new URL('http://' + req.headers.host).hostname;
        const local = loopback(req.socket.remoteAddress) && loopback(hostname) && !req.headers['x-forwarded-for'] && !req.headers['cf-connecting-ip'];
        const origins = local ? Object.values(networkInterfaces()).flat().filter(x => x.family === 'IPv4' && !x.internal)
          .map(x => 'http://' + x.address + ':' + server.address().port) : [];
        return json(res,200,{origins,publicOrigin:origin});
      }
      if (req.method === 'POST' && req.headers.origin) {
        const source = new URL(req.headers.origin);
        if (source.host !== req.headers.host && source.origin !== origin) throw new RoomError('Cross-origin command refused.',403);
      }
      const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' || req.headers.origin?.startsWith('https://');
      const data = req.method === 'POST' ? await body(req) : {};
      if (path === '/api/create' && req.method === 'POST') {
        quota(req.socket.remoteAddress);
        if (rooms.size >= 128) throw new RoomError('Server is full.',503);
        const id = data.roomId ?? roomId();
        if (typeof id !== 'string' || !validId.test(id)) throw new RoomError('Invalid invitation.');
        if (rooms.has(id)) throw new RoomError('Room already exists.',409);
        const room = new Room(id,data.name,roomOptions);
        rooms.set(id,room);
        setSession(res,id,room.hostSession,secure);
        return json(res,201,room.snapshot(room.authenticate(room.hostSession)));
      }
      const match = /^\/api\/rooms\/([A-Za-z0-9_-]{20})(?:\/(join|command|presence|history(?:\/(\d+))?))?$/.exec(path);
      const room = match && rooms.get(match[1]);
      if (!room) throw new RoomError('Room unavailable.',404);
      refresh(room);
      const secret = session(req);
      if (req.method === 'POST' && match[2] === 'join') {
        if (!room.sessions.has(secret)) quota(req.socket.remoteAddress);
        const {user,secret:newSecret} = room.join(data.name,secret);
        setSession(res,room.id,newSecret,secure);
        return json(res,200,room.snapshot(user));
      }
      const user = room.authenticate(secret);
      if (req.method === 'GET' && match[2] === 'presence') {
        if (user.presences >= 6) throw new RoomError('Too many open tabs.',429);
        user.presences++;
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          clearTimeout(timer);
          user.presences--;
          user.lastSeen = now();
        };
        const timer = setTimeout(() => {
          release();
          res.writeHead(204);
          res.end();
        },15000);
        res.once('close',release);
        return;
      }
      if (req.method === 'GET' && !match[2]) return json(res,200,room.snapshot(user));
      if (req.method === 'GET' && match[2] === 'history') {
        const before = searchParams.has('before') ? Number(searchParams.get('before')) : null;
        const limit = searchParams.has('limit') ? Number(searchParams.get('limit')) : undefined;
        return json(res, 200, room.historyPage(user, before, limit));
      }
      if (req.method === 'GET' && match[3]) return json(res,200,room.handHistory(user,Number(match[3])));
      if (req.method === 'POST' && match[2] === 'command') {
        room.command(user,data);
        if (data.type === 'leave') {
          setSession(res,room.id,'',secure);
          if (room.closed) rooms.delete(room.id);
          return json(res,200,{left:true});
        }
        return json(res,200,room.snapshot(user));
      }
      throw new RoomError('Route unavailable.',404);
    } catch (err) {
      const expected = err instanceof RoomError || err instanceof URIError;
      if (!expected) console.error('Request failed:',err.name);
      json(res,expected ? (err.status || 400) : 500,{error:expected ? err.message : 'Server error.'});
    }
  });
  server.on('close', () => { clearInterval(interval); for (const r of rooms.values()) r.close(); rooms.clear(); });
  server.setPublicOrigin = value => { origin = asOrigin(value); };
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const host = process.env.HOST || '0.0.0.0';
  const port = Number(process.env.PORT || 4173);
  const server = makeServer();
  server.listen(port,host,() => console.log('Workspace available at http://localhost:' + server.address().port));
  server.on('error', err => { console.error('Unable to start workspace service:',err.message); process.exitCode = 1; });
}
