import { randomBytes, randomInt } from 'node:crypto';
import { startHand, act, viewHand, legalActions } from './engine.mjs';
import { fetchCloudMove, localAction } from './opponents.mjs';
import { kernelMoves } from './kernel-game.mjs';
import { summarizeHistoryHand } from './public/hand-summary.js';

export { fetchCloudMove };

export class RoomError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function requireThat(test, message, status) { if (!test) throw new RoomError(message, status); }
function cleanName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  requireThat(name && name.length <= 32 && !/[\u0000-\u001f\u007f]/.test(name), 'Use a name of 1–32 characters.');
  return name;
}
function inRange(value, min, max) { return Number.isSafeInteger(value) && value >= min && value <= max; }
const BUY_IN = 1000;
const KERNEL_TURN_MS = 12000;
const RECONNECT_GRACE_MS = 30000;
const token = () => randomBytes(32).toString('base64url');
export const roomId = () => randomBytes(15).toString('base64url');
const present = p => !p.bot && ['standing', 'seated'].includes(p.status);
const safeAction = legal => ({type: legal.check ? 'check' : 'fold'});

export class Room {
  constructor(id, name, {now = Date.now, cloudMove = fetchCloudMove, kernel = null, kernelMode = false} = {}) {
    requireThat(!kernelMode || typeof kernel?.decide === 'function', 'Kernel is unavailable.', 503);
    this.kernelMode = kernelMode;
    this.kernel = kernelMode ? kernel : null;
    this.kernelPath = [];
    this.kernelError = '';
    this.id = id;
    this.now = now;
    this.cloudMove = cloudMove;
    this.members = new Map();
    this.sessions = new Map();
    this.requests = new Map();
    this.settings = {baseSeconds:30, initialCards:2, cardSeconds:10};
    this.cloud = {key:'', primary:'', fallback:''};
    this.hand = null;
    this.history = new Map();
    this.clock = null;
    this.nextAt = null;
    this.running = false;
    this.serial = 0;
    this.closed = false;
    this.work = null;
    const host = this.member(name, false, 'seated');
    this.hostId = host.id;
    this.hostSession = this.issueSession(host);
    this.seat(host, BUY_IN);
    if (kernelMode) {
      const opponent = this.member(host.name === 'Kernel' ? 'Kernel Bot' : 'Kernel', 'kernel', 'standing');
      this.seat(opponent, BUY_IN);
    }
  }
  member(value, bot, status) {
    const name = cleanName(value);
    requireThat(!Array.from(this.members.values()).some(p => p.name === name && p.status !== 'departed'), 'That name is already in use.', 409);
    const user = {id:randomBytes(9).toString('hex'), name, bot, status, seat:null, stack:0, auto:false, cards:this.settings.initialCards, lastSeen:this.now(), presences:0};
    this.members.set(user.id, user);
    return user;
  }
  issueSession(user) {
    const secret = token();
    this.sessions.set(secret, user.id);
    return secret;
  }
  authenticate(secret) {
    requireThat(!this.closed, 'Room expired.', 404);
    const user = this.members.get(this.sessions.get(secret));
    requireThat(user && user.status !== 'departed', 'Join the room to continue.', 401);
    user.lastSeen = this.now();
    return user;
  }
  join(name, existing) {
    if (existing && this.sessions.has(existing)) return {user:this.authenticate(existing), secret:existing};
    requireThat(!this.kernelMode, 'Kernel practice is heads-up.', 403);
    requireThat(this.members.size < 128 && this.requests.size < 32, 'Room has too many pending participants.', 429);
    const user = this.member(name, false, 'pending');
    this.requests.set(user.id, {id:user.id, name:user.name, kind:'join', amount:BUY_IN});
    return {user, secret:this.issueSession(user)};
  }
  vacantSeat() {
    const occupied = new Set([...this.members.values()].map(p => p.seat));
    if (this.inHand()) this.hand.players.forEach(p => occupied.add(p.seat));
    for (let seat = 1; seat <= 9; seat++) if (!occupied.has(seat)) return seat;
    throw new RoomError('All nine seats are occupied.', 409);
  }
  seat(user, stack) {
    const seat = this.vacantSeat();
    this.checkChips(user, stack);
    Object.assign(user, {status:'seated', stack, seat, auto:false, cards:this.settings.initialCards});
  }
  checkChips(user, amount) {
    requireThat(Number.isSafeInteger(amount) && amount > 0, 'Enter a positive amount in tenths of a BB.');
    const table = [...this.members.values()].filter(p => p !== user && p.seat).reduce((sum,p) => sum + p.stack, 0);
    requireThat(Number.isSafeInteger(table + amount), 'Amount exceeds supported chip precision.');
  }
  inHand() { return this.hand && this.hand.street !== 'complete'; }
  eligible() { return [...this.members.values()].filter(p => p.status === 'seated' && p.stack > 0); }
  online(user) { return Boolean(user.bot || user.presences) || this.now() - user.lastSeen < 5000; }
  deal() {
    const players = this.eligible();
    if (this.inHand() || players.length < 2 || ![...this.members.values()].some(p => present(p) && this.online(p))) return false;
    this.hand = startHand(players.map(({id,name,stack,seat}) => ({id,name,stack,seat})), {
      number:(this.hand?.number || 0) + 1, previousButton:this.hand?.button ?? null,
      previousBigBlindId:this.hand?.players.find(p => p.position === 'BB')?.id
    });
    this.kernelPath = [];
    this.nextAt = null;
    this.afterMove();
    return true;
  }
  afterMove() {
    this.cancelWork();
    this.serial++;
    if (this.hand.street !== 'complete') {
      const startedAt = this.now();
      const kernelTurn = this.members.get(this.hand.actorId)?.bot === 'kernel';
      const duration = kernelTurn ? KERNEL_TURN_MS : this.settings.baseSeconds * 1000;
      this.clock = {phase:'base', startedAt, deadline:startedAt + duration};
      return;
    }
    for (const row of this.hand.players) {
      const user = this.members.get(row.id);
      if (!user) continue;
      if (user.status === 'departed') { this.members.delete(user.id); continue; }
      user.stack = this.kernelMode ? BUY_IN : row.stack;
      if (!user.stack) Object.assign(user, {status:'standing', seat:null});
    }
    this.history.set(this.hand.number, this.hand);
    this.clock = null;
    this.nextAt = this.now() + 6000;
  }
  get turnKey() { return this.id + '.' + this.serial; }
  apply(id, action) {
    requireThat(action && ['fold','check','call','bet','raise'].includes(action.type), 'Choose a legal action.');
    let kernelMove;
    if (this.kernelMode) {
      kernelMove = kernelMoves(this.hand, id).find(move => move.type === action.type && move.amount === action.amount);
      requireThat(kernelMove, 'Choose an available Kernel action.', 409);
    }
    try { act(this.hand, id, action); } catch (e) { throw new RoomError(e.message, 409); }
    if (kernelMove) this.kernelPath.push(kernelMove.label);
    this.afterMove();
  }
  cancelWork() {
    this.work?.controller.abort();
    this.work = null;
  }
  stopKernelTurn() {
    this.cancelWork();
    this.kernelError = 'Kernel could not act. Retry the decision.';
    this.clock = null;
    this.serial++;
  }
  async askKernel(player) {
    const key = this.turnKey;
    const controller = new AbortController();
    this.work = {key,controller};
    const seat = this.hand.players.find(row => row.id === player.id);
    const request = {
      actions:[...this.kernelPath], cards:[...seat.cards],
      board:[...this.hand.board], actor:seat.seat === this.hand.button ? 0 : 1
    };
    try {
      const result = await this.kernel.decide(request,{signal:controller.signal});
      if (this.closed || this.turnKey !== key || controller.signal.aborted) return;
      this.tick();
      if (this.closed || this.turnKey !== key) return;
      const move = kernelMoves(this.hand, player.id).find(move => move.label === result.action);
      requireThat(move, 'Invalid Kernel decision.');
      this.apply(player.id, move);
    } catch {
      if (!this.closed && this.turnKey === key && !controller.signal.aborted) this.stopKernelTurn();
    }
  }
  async askCloud(player) {
    const key = this.turnKey;
    const controller = new AbortController();
    this.work = {key,controller};
    const hand = viewHand(this.hand, player.id);
    // Launch at most one primary and one fallback attempt per turn. The table clock owns timeout decisions.
    for (const model of new Set([this.cloud.primary, this.cloud.fallback].filter(Boolean))) {
      if (this.closed || this.turnKey !== key || controller.signal.aborted) break;
      try {
        const left = Math.max(1, this.clock.deadline - this.now());
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(Math.min(12000, Math.max(100, Math.floor(left / 2))))]);
        const action = await this.cloudMove({key:this.cloud.key, model, hand, signal});
        if (this.closed || this.turnKey !== key || signal.aborted) continue;
        // Enforce overdue timers before applying a response, even when the event loop was delayed.
        this.tick();
        if (!this.closed && this.turnKey === key) this.apply(player.id, action);
        break;
      } catch { /* Invalid or unavailable primary falls through to the next configured model. */ }
    }
  }
  tick() {
    if (this.closed) return;
    const now = this.now();
    let keepRoom = false;
    for (const member of this.members.values()) {
      const connectedOrReturning = member.presences > 0 || now - member.lastSeen < RECONNECT_GRACE_MS;
      if (connectedOrReturning && present(member)) keepRoom = true;
      if (!connectedOrReturning && member.status === 'declined') this.leave(member);
    }
    if (!keepRoom) { this.close(); return; }
    if (!this.inHand()) {
      if (this.running && now >= (this.nextAt ?? 0)) this.deal();
      return;
    }
    const actor = this.members.get(this.hand.actorId);
    if (!actor) throw new Error('Missing active seat');
    if (actor.bot === 'kernel') {
      if (this.kernelError) return;
      if (now >= this.clock.deadline) this.stopKernelTurn();
      else if (!this.work && now - this.clock.startedAt >= 750) void this.askKernel(actor);
      return;
    }
    while (now >= this.clock.deadline && !actor.auto) {
      if (actor.cards <= 0) { actor.auto = true; break; }
      actor.cards--;
      const start = this.clock.deadline;
      this.clock = {startedAt:start, phase:'bank', deadline:start + this.settings.cardSeconds * 1000};
    }
    if (actor.auto) {
      this.apply(actor.id, safeAction(legalActions(this.hand, actor.id)));
    } else if (actor.bot && now - this.clock.startedAt >= 750) {
      if (actor.bot === 'local') this.apply(actor.id, localAction(viewHand(this.hand, actor.id), actor.id));
      else if (!this.work) void this.askCloud(actor);
    }
  }
  close() {
    this.cancelWork();
    this.closed = true;
    this.cloud = {key:'', primary:'', fallback:''};
    this.sessions.clear();
    this.members.clear();
    this.requests.clear();
    this.history.clear();
    this.hand = this.clock = this.nextAt = this.hostSession = null;
  }
  leave(user) {
    this.requests.delete(user.id);
    for (const [secret, id] of this.sessions) if (id === user.id) this.sessions.delete(secret);
    // In-hand seats play out committed chips with normal check/fold timeout policy.
    if (this.inHand() && this.hand.players.some(p => p.id === user.id)) {
      Object.assign(user, {status:'departed', auto:true});
    } else this.members.delete(user.id);
    if (![...this.members.values()].some(present)) this.close();
  }
  command(user, cmd) {
    requireThat(cmd && typeof cmd.type === 'string', 'Invalid command.');
    const host = user.id === this.hostId;
    const admin = ['settings','cloud','approve','reject','remove','addBot','stack','start','pause','next','retryKernel'];
    if (admin.includes(cmd.type)) requireThat(host, 'Host approval required.', 403);
    if (this.kernelMode) {
      requireThat(['settings','start','pause','next','action','back','leave','retryKernel'].includes(cmd.type),
        'Kernel practice is heads-up.', 403);
    }
    const target = this.members.get(cmd.id);
    switch (cmd.type) {
      case 'retryKernel':
        requireThat(this.kernelMode && this.kernelError && this.inHand(), 'No Kernel decision to retry.', 409);
        this.kernelError = '';
        this.afterMove();
        break;
      case 'settings': {
        const {baseSeconds, initialCards, cardSeconds} = cmd;
        requireThat(inRange(baseSeconds,1,600) && inRange(initialCards,0,100) && inRange(cardSeconds,1,600), 'Timer settings out of range.');
        this.settings = {baseSeconds,initialCards,cardSeconds};
        if (!this.hand) for (const p of this.members.values()) p.cards = initialCards;
        break;
      }
      case 'cloud': {
        requireThat(typeof cmd.key === 'string' && cmd.key.trim() && cmd.key.length <= 4096, 'Enter an Ollama Cloud key.');
        requireThat(typeof cmd.primary === 'string' && cmd.primary.trim() && cmd.primary.length <= 160, 'Enter a primary model.');
        requireThat(cmd.fallback == null || (typeof cmd.fallback === 'string' && cmd.fallback.length <= 160), 'Invalid fallback model.');
        this.cloud = {key:cmd.key.trim(),primary:cmd.primary.trim(),fallback:cmd.fallback?.trim() || ''};
        this.cancelWork();
        break;
      }
      case 'addBot': {
        requireThat(['local','cloud'].includes(cmd.mode), 'Choose a bot type.');
        if (cmd.mode === 'cloud') requireThat(this.cloud.key, 'Configure Ollama Cloud first.');
        this.vacantSeat();
        const names = ['Orbit','Nova','Atlas','Vega','Sol','Echo','Lyra','Pico','Iris','Mica'];
        const used = new Set([...this.members.values()].map(p => p.name));
        const bot = this.member(cmd.name || names.find(n => !used.has(n)) || 'AI-' + randomInt(10000), cmd.mode, 'standing');
        try { this.seat(bot, BUY_IN); } catch (e) { this.members.delete(bot.id); throw e; }
        break;
      }
      case 'approve':
      case 'reject': {
        const req = this.requests.get(cmd.id);
        requireThat(target && req, 'Request has expired.', 409);
        if (cmd.type === 'approve') this.seat(target, req.amount);
        else if (req.kind === 'join') Object.assign(target,{status:'declined',lastSeen:this.now()});
        this.requests.delete(cmd.id);
        break;
      }
      case 'rebuy': {
        requireThat(user.status === 'standing', 'Rebuy is available after busting.', 409);
        this.checkChips(user, cmd.amount);
        this.requests.set(user.id, {id:user.id,name:user.name,kind:'rebuy',amount:cmd.amount});
        break;
      }
      case 'remove':
        requireThat(target && target.id !== this.hostId, 'Select a guest or opponent.');
        this.leave(target);
        break;
      case 'stack': {
        requireThat(target && ['seated','standing'].includes(target.status), 'Select a seated or standing player.');
        requireThat(!this.inHand() || !this.hand.players.some(p => p.id === target.id), 'Adjust this stack between hands.', 409);
        if (cmd.amount === 0) Object.assign(target,{seat:null,stack:0,status:'standing'});
        else if (target.status === 'standing') this.seat(target, cmd.amount);
        else { this.checkChips(target, cmd.amount); target.stack = cmd.amount; }
        this.requests.delete(target.id);
        break;
      }
      case 'start':
      case 'next':
        if (!this.inHand()) requireThat(this.deal(), 'At least two occupied seats are needed.', 409);
        this.running = true;
        break;
      case 'pause': this.running = false; break;
      case 'action':
        requireThat(this.inHand() && this.hand.actorId === user.id && !user.auto && cmd.turnKey === this.turnKey, 'This turn has already changed.', 409);
        this.apply(user.id, cmd.action);
        break;
      case 'back':
        requireThat(['seated','standing'].includes(user.status), 'Take a seat first.', 403);
        user.auto = false;
        break;
      case 'leave': this.leave(user); break;
      default: throw new RoomError('Unknown command.');
    }
  }
  playerView(p) {
    const row = this.inHand() && this.hand.players.find(r => r.id === p.id);
    return {id:p.id, name:p.name, host:p.id === this.hostId, seat:p.seat, stack:row ? row.stack : p.stack,
      status:p.status, cards:p.cards, auto:p.auto, bot:p.bot, online:this.online(p)};
  }
  snapshot(user) {
    const host = user.id === this.hostId;
    const allowed = present(user);
    const hand = allowed && this.hand ? viewHand(this.hand, user.id) : null;
    if (this.kernelMode && hand?.legal) {
      const moves = kernelMoves(this.hand, user.id);
      const raises = moves.filter(move => move.amount !== undefined).map(({label,amount}) => ({label,amount}));
      hand.legal = {...hand.legal, fold:!hand.legal.check, raise:raises.length > 0, kernelRaises:raises};
    }
    return {roomId:this.id, kernelMode:this.kernelMode, kernelError:this.kernelError, me:this.playerView(user), players:allowed ? [...this.members.values()]
      .filter(p => ['seated','standing'].includes(p.status)).map(p => this.playerView(p)) : [],
      requests:host ? [...this.requests.values()] : [], myRequest:this.requests.get(user.id) || null,
      hand,
      turnKey:this.turnKey, clock:allowed ? this.clock : null, serverNow:this.now(), settings:this.settings,
      cloud:{configured:Boolean(this.cloud.key),primary:host ? this.cloud.primary : '',fallback:host ? this.cloud.fallback : ''},
      history:allowed ? [...this.history.keys()].reverse() : [], running:this.running,nextAt:this.running ? this.nextAt : null};
  }
  handHistory(user, number) {
    requireThat(present(user), 'Take a seat first.', 403);
    const hand = this.history.get(number);
    requireThat(hand, 'Hand unavailable.', 404);
    return viewHand(hand,user.id);
  }
  historyPage(user, before = null, limit = 50) {
    requireThat(present(user), 'Take a seat first.', 403);
    requireThat(before === null || inRange(before, 1, Number.MAX_SAFE_INTEGER), 'Invalid history cursor.');
    requireThat(inRange(limit, 1, 100), 'Invalid history page size.');
    // Completed hands are numbered consecutively from 1 for the room's lifetime.
    // An exclusive cursor remains stable if another hand settles between page requests.
    const total = this.history.size;
    const newest = before === null ? total : Math.min(total, before - 1);
    const items = [];
    let number = newest;
    while (number > 0 && items.length < limit) {
      items.push(summarizeHistoryHand(this.history.get(number), user.id));
      number--;
    }
    return {items, nextBefore: number > 0 ? number + 1 : null, total};
  }
}
