import './terminal.js';
import { chatMarkup, syncChat } from './chat.js';
import {bb, escapeText, eventText, handRanks, netChips, renderCards, streetText, tFor} from './poker-format.js';
export {renderHistory} from './history-view.js';
import { syncDocument } from './document.js';
// UI values are in big blinds. The service uses integer tenths of a big blind.
const controllers = new WeakMap();
const glyphs = {
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
  history: '<path d="M3 10a9 9 0 1 1 1 7M3 4v6h6m3-3v6l4 2"/>',
  note: '<path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8m-8 4h6"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  bot: '<rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 7V3m-4 9h1m6 0h1m-7 4h6"/>'
};
function icon(key, size = 16) {
  return `<svg class="gw-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyphs[key]}</svg>`;
}
const presets = [25,33,40,50,60,75,100,125];
export function presetAmount(hand, playerId, percentage) {
  const player = hand.players.find(p => p.id === playerId);
  const {callAmount, minTo, maxTo} = hand.legal;
  const suggested = (player?.streetBet || 0) + callAmount + (hand.pot + callAmount) * percentage / 100;
  return Math.max(minTo, Math.min(maxTo, Math.round(suggested)));
}
function docMarkup(ctx) {
  const t = tFor(ctx.options.lang);
  const navigation = ctx.options.documentIndex
    ? `<button type="button" class="gw-doc-button" data-ui="mainDocument">${t('Back to main document','返回主文档')}</button>`
    : `<span>${t('Document','文档')}</span>`;
  return `<div class="gw-doc-workspace"><div class="gw-doc-bar">${icon('note')} ${navigation}<div class="gw-doc-buttons"></div></div>
  <div class="gw-doc-columns"><article class="gw-paper"></article><folio-splitter data-split="document"></folio-splitter>
  <aside class="gw-review"><button type="button" class="gw-review-head" data-review-toggle aria-expanded="true" aria-controls="gw-review-content">${icon('note')} ${t('Review thread','审阅批注')}<span class="gw-review-turn" hidden>${t('Your turn','轮到你')}</span><span class="gw-review-chevron" aria-hidden="true">⌃</span></button><div class="gw-tool-slot" id="gw-review-content"></div></aside></div></div>`;
}
function setReviewOpen(panel, open) {
  panel.querySelector('[data-review-toggle]').setAttribute('aria-expanded', String(open));
  panel.querySelector('.gw-tool-slot').hidden = !open;
}
function cliMarkup(ctx) {
  const t=tFor(ctx.options.lang);
  return `<div class="gw-terminal"><div class="gw-term-head"><span class="gw-term-lights">● ● ●</span><span>tmux / edge-cache</span><span>zsh</span></div><div class="gw-term-columns"><div class="gw-term-code"><folio-terminal lang="${ctx.options.lang === 'zh' ? 'zh' : 'en'}"></folio-terminal></div><folio-splitter data-split="terminal"></folio-splitter><aside class="gw-watch"><div class="gw-watch-cmd"><span class="gw-prompt">~ $</span> watch -n 1 ./review</div><div class="gw-tool-slot"></div></aside></div><div class="gw-term-foot"><span>[review] &nbsp; 0:zsh* &nbsp; 1:watch</span><span>${t('local session','本地会话')}</span></div></div>`;
}
function tableOfSeats(state, t) {
  const h = state.hand;
  const seats = new Map((h?.players || []).map(p => [p.id, p]));
  const roster = new Map(state.players.map(p => [p.id, p]));
  const ids = new Set([...seats.keys(),...state.players.filter(p=>p.status==='seated').map(p=>p.id)]);
  const streetEvents = (h?.events || []).filter(e => e.street === h?.street && e.id);
  const rows = [...ids].map(id => {
    const info = roster.get(id);
    const hp = seats.get(id);
    const seat = hp?.seat ?? info?.seat;
    const me = id === state.me.id;
    const actor = id === h?.actorId;
    const event = streetEvents.filter(e => e.id === id).at(-1);
    let status = hp ? t('In hand','参局中') : t('Ready','就绪');
    if (h && !hp) status = t('Next hand','下一手');
    if (event) status = eventText(event,t);
    if (hp?.allIn) status = t('All-in','全下');
    if (hp?.folded) status = t('Folded','已弃牌');
    if (actor) status = me ? t('Your turn','轮到你') : t('Acting','行动中');
    if (h?.street==='complete' && hp) status = t('Net','净盈亏') + ' ' + netChips(hp.stack - hp.startStack) + ' BB';
    const name = escapeText(hp?.name ?? info?.name);
    return [seat,`<tr class="${actor?'gw-current':''} ${hp?.folded?'gw-folded':''}"><td>${escapeText(hp?.position || String(seat ?? '—'))}</td><td><span class="gw-seat-name">${name}</span>${me?' <small>'+t('you','你')+'</small>':info?.bot?' <small>AI</small>':''}</td><td>${bb(hp?.stack ?? info?.stack)}</td><td>${status}${info?.auto?' · '+t('Auto','托管'):''}</td></tr>`];
  }).sort((a,b)=>a[0]-b[0]);
  return `<div class="gw-seat-list"><h3>${t('Table','座位')} <span>· ${rows.length} ${t('seats','席')}</span></h3><table><thead><tr><th>${t('Pos','位置')}</th><th>${t('Player','玩家')}</th><th>${t('Stack','筹码')}</th><th>${t('Status','状态')}</th></tr></thead><tbody>${rows.map(row=>row[1]).join('')}</tbody></table></div>`;
}
function winnerText(h,t) {
  const labels = (h.pools || []).map((pool, index) => {
    const names = pool.shares.map(s => escapeText(h.players.find(p=>p.id===s.id)?.name) + ' ' + bb(s.amount) + ' BB').join(t(', ', '、'));
    const label = pool.refund ? t('Uncalled bet returned','退回未跟注部分') : index===0 ? t('Main pot','主池') : t('Side pot','边池');
    return `<div>${label} · ${names}</div>`;
  });
  return labels.join('');
}
function exposedHands(hand,t) {
  if (!hand.showdown) return '';
  return hand.players.filter(p=>!p.folded && p.cards?.length).map(p=>{
    const rank = p.rank ? ' · '+escapeText(t(p.rank,handRanks[p.rank] || p.rank)) : '';
    return `<div>${escapeText(p.name)} ${renderCards(p.cards,t)}${rank}</div>`;
  }).join('');
}
function actionTrace(ctx, actor, toCall, t) {
  if (!actor) return '';
  const {hand,roomId}=ctx.state;
  const actions=hand.events.filter(e=>e.id && e.street===hand.street).map(e=>{
    const p=hand.players.find(player=>player.id===e.id);
    return escapeText(p?.position || p?.name) + ' ' + eventText(e,t);
  });
  const next=hand.players.find(p=>p.id===hand.nextIfMatched);
  const after=toCall ? t('After a call','跟注后') : t('After a check','过牌后');
  const outcome=next ? t('next','下一位')+' · '+escapeText(next.position)+' '+escapeText(next.name)
    : t('round closes','本轮结束');
  const preview=actions.slice(-3).join(' › ');
  const key=roomId+'-'+hand.number+'-'+hand.street;
  const full=actions.length>3 ? `<details class="gw-trace" data-trace-key="${escapeText(key)}" ${ctx.openTraceKey===key?'open':''}>
    <summary>${t('All '+actions.length+' actions','本轮全部 '+actions.length+' 次行动')}</summary>
    <ol>${actions.map(text=>'<li>'+text+'</li>').join('')}</ol></details>` : '';
  return `<strong class="gw-actor">${escapeText(actor.position)} ${escapeText(actor.name)} · ${t('to act','待行动')}</strong>
    <small class="gw-next">${after} · ${outcome}</small>
    ${preview ? '<span class="gw-recent-actions">'+preview+'</span>' : ''}${full}`;
}
// Chip amounts stay in tenths of a BB until formatting. Folded chips remain in the pot.
export function potBreakdown(hand) {
  if (hand.street === 'complete') {
    const returned = hand.pools.reduce((sum, pool) => sum + (pool.refund ? pool.amount : 0), 0);
    return { awarded: hand.pot - returned, returned };
  }
  const street = hand.players.reduce((sum, player) => sum + player.streetBet, 0);
  const base = hand.pot - street;
  let before = base;
  // A short big blind still leaves a full 1 BB bring-in when a raise is possible.
  let price = hand.street === 'preflop' ? 10 : 0;
  let lastWager = null;
  for (const event of hand.events) {
    if (event.street !== hand.street) continue;
    if (event.type === 'raise' || event.type === 'bet') {
      lastWager = { type: event.type, id: event.id, to: event.to, paid: event.amount,
        by: event.to - price, before };
      price = event.to;
    }
    before += event.amount || 0;
  }
  return { base, street, total: hand.pot, lastWager };
}

function potValue(ledger, t) {
  if ('awarded' in ledger) {
    const returned = ledger.returned ? `<small data-pot-refund="${bb(ledger.returned)}"> · ${t('uncalled bet returned','退回未跟注部分')} ${bb(ledger.returned)} BB</small>` : '';
    return `<span data-pot-total="${bb(ledger.awarded)}">${bb(ledger.awarded)} BB</span>${returned}`;
  }
  return `<span class="gw-pot-equation">
    <span><small>${t('Starting pot','本轮开始时的底池')}</small> <b data-pot-base="${bb(ledger.base)}">${bb(ledger.base)}</b></span>
    <span class="gw-pot-op">+</span>
    <span><small>${t('Bets this round','本轮下注')}</small> <b data-pot-street="${bb(ledger.street)}">${bb(ledger.street)}</b></span>
    <span class="gw-pot-sum">= <span data-pot-total="${bb(ledger.total)}">${bb(ledger.total)}</span> BB</span>
  </span>`;
}

function wagerNote(hand, ledger, t) {
  const wager = ledger.lastWager;
  if (!wager) return '';
  const player = hand.players.find(p => p.id === wager.id);
  const who = escapeText(player?.position || player?.name);
  const isRaise = wager.type === 'raise';
  const action = isRaise
    ? `${t('raised to','加注至')} <b data-raise-to="${bb(wager.to)}">${bb(wager.to)}</b> BB · ${t('raise size','加注额')} <b data-raise-by="${bb(wager.by)}">${bb(wager.by)}</b> BB`
    : `${t('bet','下注')} <b>${bb(wager.to)}</b> BB`;
  const beforeLabel = isRaise ? t('Pot before raise','加注前底池') : t('Pot before bet','下注前底池');
  return `<div class="gw-pot-wager"><span>${who} ${action}</span>
    <small>${beforeLabel} <span data-pot-before="${bb(wager.before)}">${bb(wager.before)}</span> BB · ${t('added','本次投入')} <span data-pot-paid="${bb(wager.paid)}">${bb(wager.paid)}</span> BB</small></div>`;
}

function summaryBlock(ctx, t) {
  const state=ctx.state;
  const h = state.hand;
  if (!h) {
    return `<div class="gw-wait"><strong>${t('Waiting to start','等待开局')}</strong><p>${t('Two seated players are needed to deal.','至少两位玩家入座后即可发牌。')}</p><small>0.5 / 1 BB</small></div>`;
  }
  const me = h.players.find(p=>p.id===state.me.id);
  const actor = h.players.find(p=>p.id===h.actorId);
  const toCall = actor ? Math.min(actor.stack,Math.max(0,h.currentTo-actor.streetBet)) : 0;
  const yourTurn = actor?.id === state.me.id;
  const ledger = potBreakdown(h);
  const details = [
    [t('Hole cards','底牌'),renderCards(me?.cards,t)],
    [t('Board','公共牌'),renderCards(h.board,t)],
    [h.street === 'complete' ? t('Final pot','最终底池') : t('Pot','当前底池'),potValue(ledger, t),'gw-pot-row'],
  ];
  if (actor) {
    const position = escapeText(actor.position);
    const label = yourTurn ? t('To call','跟注额') : t('To call (' + position + ')',position + ' 跟注额');
    details.push([label,bb(toCall)+' <small>BB</small>']);
  }
  return `<div class="gw-hand-live"><dl class="gw-hand-data">${details.map(([k,v,cls])=>`<div${cls ? ' class="'+cls+'"' : ''}><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    ${wagerNote(h, ledger, t)}
    <div class="gw-street"><b>${streetText(h.street,t)}</b>${actionTrace(ctx,actor,toCall,t)}</div>
    ${h.street==='complete' ? '<div class="gw-winners">'+winnerText(h,t)+exposedHands(h,t)+'</div>' : ''}</div>`;
}
// Convert only complete decimal amounts. In particular, an empty field or "3."
// is an edit still in progress and must never dispatch the last valid amount.
export function parseBetAmount(text, {minTo, maxTo}) {
  const decimal = text.trim().normalize('NFKC').replace(',', '.');
  if (!/^(?:\d+|\d*\.\d)$/.test(decimal)) return null;
  const [whole, tenth = '0'] = decimal.split('.');
  const units = Number(whole + tenth);
  return Number.isSafeInteger(units) && units >= minTo && units <= maxTo ? units : null;
}

function amountText(units) {
  if (units === null) return '—';
  const tenth = units % 10;
  const whole = (units - tenth) / 10;
  return tenth ? whole + '.' + tenth : String(whole);
}

// Interior stops are on the 0.5 BB grid. When a boundary is off grid, use the
// outermost stop for the exact legal amount so a short all-in remains reachable.
export function sliderBounds({minTo, maxTo}) {
  return {min: Math.floor(minTo / 5) / 2, max: Math.ceil(maxTo / 5) / 2};
}

export function amountAtStop(stop, {minTo, maxTo}) {
  const units = Math.round(stop * 2) * 5;
  return Math.max(minTo, Math.min(maxTo, units));
}

export function stopForAmount(units, legal) {
  const {min, max} = sliderBounds(legal);
  if (units <= legal.minTo) return min;
  if (units >= legal.maxTo) return max;
  return Math.round(units / 5) / 2;
}

function sizeInputs(ctx) {
  const t = tFor(ctx.options.lang);
  const legal = ctx.state.hand.legal;
  const {min, max} = sliderBounds(legal);
  const singleSize = legal.minTo === legal.maxTo;
  const stop = stopForAmount(ctx.amount ?? legal.minTo, legal);
  const invalid = ctx.amount === null;
  const bounds = singleSize ? amountText(legal.minTo) + ' BB' : amountText(legal.minTo) + '–' + amountText(legal.maxTo) + ' BB';
  const hint = t('Enter ' + bounds + ', up to one decimal place.', '请输入 ' + bounds + '，最多保留一位小数。');
  const label = legal.currentTo === 0 ? t('Bet amount','下注额') : t('Raise to','加注至');
  return `<div class="gw-sizing"><label>${label} <input class="gw-amount" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" maxlength="32" aria-invalid="${invalid}" aria-describedby="gw-amount-hint" value="${escapeText(ctx.draftText)}"> BB</label>
  <input class="gw-range" type="range" aria-label="${label} (BB)" aria-valuetext="${amountText(amountAtStop(stop, legal))} BB" min="${min}" max="${max}" step="0.5" value="${stop}" ${singleSize?'disabled':''}>
  <div class="gw-presets">${presets.map(p=>`<button type="button" data-pct="${p}" aria-pressed="${ctx.pct===p}">${p}%</button>`).join('')}</div>
  <small id="gw-amount-hint" class="gw-amount-hint" ${invalid?'':'hidden'}>${hint}</small></div>`;
}
function controls(ctx, t) {
  const {me,hand,players} = ctx.state;
  const buttons=[];
  if (me.auto) buttons.push(`<button data-cmd="back">${t("I'm back",'取消托管')}</button>`);
  const ready = players.filter(p=>p.status==='seated' && p.stack>0).length;
  if (me.host && (!hand || hand.street==='complete')) {
    if (ready < 9) buttons.push(`<button data-cmd="addBot">${icon('bot',14)} ${t('Add practice player','添加练习对手')}</button>`);
    if (ready >=2 && !ctx.state.running) buttons.push(`<button class="gw-main-action" data-cmd="start">${t('Start dealing','开始发牌')}</button>`);
  }
  let size='';
  if (hand?.actorId===me.id && hand.legal) {
    const legal = hand.legal;
    if (legal.fold) buttons.push(`<button data-play="fold">${t('Fold','弃牌')}</button>`);
    if (legal.check) buttons.push(`<button data-play="check">${t('Check','过牌')}</button>`);
    if (legal.call) buttons.push(`<button data-play="call">${t('Call','跟注')} ${bb(legal.callAmount)}</button>`);
    if (legal.raise) {
      const verb = legal.currentTo===0 ? t('Bet','下注') : t('Raise to','加注至');
      buttons.push(`<button type="button" data-play="${legal.currentTo===0?'bet':'raise'}" ${ctx.amount===null?'disabled':''}>${verb} <span class="gw-amount-text">${amountText(ctx.amount)}</span></button>`);
      size=sizeInputs(ctx);
    }
  }
  return `<div class="gw-tool-actions">${buttons.join('')}${ctx.state.clock ? '<span class="gw-clock">'+icon('timer',14)+' <span data-clock></span><progress class="gw-time-progress" max="1" aria-hidden="true"></progress></span>':''}</div>${size}`;
}
const regionMarkup = new WeakMap();

function updateRegion(node, html) {
  if (regionMarkup.get(node) === html) return;
  node.innerHTML = html;
  regionMarkup.set(node, html);
}

function renderTool(slot, ctx) {
  const t = tFor(ctx.options.lang);
  const {me, hand, players, history, clock, turnKey, running, roomId} = ctx.state;
  if (me.status === 'pending' || me.status === 'declined') {
    const pending = me.status === 'pending';
    updateRegion(slot, `<section class="gw-status-panel"><h3>${pending?t('Seat requested','已申请入座'):t('Request declined','申请已被拒绝')}</h3><p>${pending?t('Waiting for the host to approve your seat. This view updates automatically.','等待房主批准，页面会自动更新。'):t('Leave this session to request another seat.','离开本场后可以重新申请入座。')}</p><button data-cmd="leave">${t('Leave session','离开本场')}</button></section>`);
    return;
  }

  let tool = slot.querySelector('.gw-tool');
  if (!tool) {
    regionMarkup.delete(slot);
    slot.innerHTML = '<section class="gw-tool"><header></header><div class="gw-tool-body"><div data-seat-pane></div><folio-splitter data-split="table"></folio-splitter><div data-hand-pane></div></div><div class="gw-rebuy-controls"></div><div class="gw-decisions"></div></section>';
    tool = slot.firstElementChild;
  }
  const label = hand ? t('Hand','手牌') + ' #' + hand.number : t('Session','协作会话');
  updateRegion(tool.querySelector('header'), `<span>${icon('layers',16)} ${label}</span><div>${history?.length ? '<button data-cmd="history">'+icon('history',14)+' '+t('History','牌谱')+'</button>':''}<button data-cmd="manage">${t('Session details','会话详情')}</button></div>`);
  updateRegion(tool.querySelector('[data-seat-pane]'), tableOfSeats(ctx.state, t));
  updateRegion(tool.querySelector('[data-hand-pane]'), summaryBlock(ctx, t));

  // A standing player may edit a rebuy while the rest of the table plays several turns.
  const rebuy = tool.querySelector('.gw-rebuy-controls');
  const rebuyKey = me.status === 'standing' ? roomId + '.' + me.id : null;
  if (rebuyKey !== ctx.rebuyKey) {
    ctx.rebuyKey = rebuyKey;
    ctx.rebuyDraft = '100';
  }
  if (!rebuyKey) rebuy.replaceChildren();
  else if (!rebuy.firstChild) {
    rebuy.innerHTML = `<div class="gw-tool-actions"><label>${t('Buy-in','买入')} <input class="gw-rebuy" aria-label="${t('Rebuy amount in BB','重新买入筹码（BB）')}" type="number" min="0.1" step="0.1"> BB</label><button data-cmd="rebuy">${t('Request rebuy','申请重新买入')}</button></div>`;
    const input = rebuy.querySelector('input');
    input.value = ctx.rebuyDraft;
    input.oninput = () => { ctx.rebuyDraft = input.value; };
  }

  // Keep the actual form elements (and the IME, caret and selection) for the whole
  // decision. Seat presence and time-bank ticks only update the surrounding view.
  const decisions = tool.querySelector('.gw-decisions');
  const betweenHands = me.host && (!hand || hand.street === 'complete');
  const ready = betweenHands ? players.filter(p => p.status === 'seated' && p.stack > 0).length : 0;
  const key = JSON.stringify([turnKey, me.id, me.auto, hand?.actorId, hand?.legal,
    Boolean(clock), betweenHands, ready, betweenHands && running]);
  if (decisions.dataset.context !== key) {
    decisions.innerHTML = controls(ctx, t);
    decisions.dataset.context = key;
  }
}
function updateClock(ctx) {
  const span = ctx.root.querySelector('[data-clock]'), clock = ctx.state?.clock;
  if (!span || !clock) return;
  const t=tFor(ctx.options.lang);
  const remaining=Math.max(0,clock.deadline-Date.now()-ctx.clockSkew);
  const left=Math.ceil(remaining/1000);
  ctx.root.querySelector('.gw-time-progress').value=Math.min(1,remaining/Math.max(1,clock.deadline-clock.startedAt));
  const actor=ctx.state.players.find(p=>p.id===ctx.state.hand?.actorId);
  const cardsLeft = actor?.cards ?? 0;
  const clockLabel = clock.phase === 'bank' ? t('Time bank','时间卡') : t('Time to act','行动时间');
  span.textContent = t(`${clockLabel} ${left}s · ${cardsLeft} time ${cardsLeft === 1 ? 'card' : 'cards'} left`, `${clockLabel} ${left} 秒 · 剩余时间卡 ${cardsLeft} 张`);
}
function initDraft(ctx) {
  const key = ctx.state?.turnKey;
  if (key === ctx.draftKey) return;
  ctx.draftKey = key;
  ctx.pct = 50;
  const hand = ctx.state?.hand;
  ctx.amount = hand?.legal?.raise ? presetAmount(hand, ctx.state.me.id, 50) : null;
  ctx.draftText = ctx.amount === null ? '' : amountText(ctx.amount);
}
function syncDraft(ctx, text, pct = null) {
  const legal = ctx.state.hand.legal;
  const units = parseBetAmount(text, legal);
  ctx.draftText = text;
  ctx.amount = units;
  ctx.pct = pct;
  const input = ctx.root.querySelector('.gw-amount');
  // Writing the value on each keystroke would move the caret or end composition.
  if (input.value !== text) input.value = text;
  input.setAttribute('aria-invalid', String(units === null));
  ctx.root.querySelector('.gw-amount-hint').hidden = units !== null;
  const amountLabel = ctx.root.querySelector('.gw-amount-text');
  amountLabel.textContent = amountText(units);
  amountLabel.closest('button').disabled = units === null || ctx.busy;
  if (units !== null) {
    const slider = ctx.root.querySelector('.gw-range');
    const stop = stopForAmount(units, legal);
    slider.value = String(stop);
    slider.setAttribute('aria-valuetext', amountText(amountAtStop(stop, legal)) + ' BB');
  }
  ctx.root.querySelectorAll('[data-pct]').forEach(button => {
    button.setAttribute('aria-pressed', String(Number(button.dataset.pct) === pct));
  });
}
async function onClick(ctx,event) {
  const b=event.target.closest('button');
  if (!b || !ctx.root.contains(b)) return;
  if (b.hasAttribute('data-review-toggle')) {
    setReviewOpen(b.closest('.gw-review'), b.getAttribute('aria-expanded') !== 'true');
    return;
  }
  const cmd=b.dataset.cmd, play=b.dataset.play;
  if (cmd==='manage') return ctx.options.onManage?.();
  if (cmd==='history') return ctx.options.onHistory?.();
  if (b.dataset.pct) {
    const pct=Number(b.dataset.pct);
    syncDraft(ctx,amountText(presetAmount(ctx.state.hand,ctx.state.me.id,pct)),pct);
    return;
  }
  if (!play && !['leave','addBot','start','back','rebuy'].includes(cmd)) return;
  if (ctx.busy) return;
  let payload={};
  const amountAction = play==='bet' || play==='raise';
  if (play) {
    payload={turnKey:ctx.state.turnKey,action:{type:play}};
    if (amountAction) {
      const amount = parseBetAmount(ctx.root.querySelector('.gw-amount').value, ctx.state.hand.legal);
      if (amount === null) return;
      payload.action.amount = amount;
    }
  } else if (cmd==='addBot') payload={mode:'local'};
  else if (cmd==='rebuy') {
    const input=ctx.root.querySelector('.gw-rebuy');
    if (!input.reportValidity() || !input.value) return;
    payload={amount:Math.round(Number(input.value)*10)};
  }
  ctx.busy=true;
  b.disabled=true;
  try {await ctx.options.onAction?.(play?'action':cmd,payload);}
  finally {
    ctx.busy = false;
    b.disabled = false;
    const confirm = ctx.root.querySelector('[data-play="bet"], [data-play="raise"]');
    if (confirm) confirm.disabled = ctx.amount === null;
  }
}
function setupController(root) {
  const ctx={root,options:{},state:null,amount:null,draftText:'',pct:50,busy:false,clockSkew:0};
  root.addEventListener('toggle',e=>{
    if (e.target.matches('details[data-trace-key]')) {
      ctx.openTraceKey=e.target.open ? e.target.dataset.traceKey : null;
    }
  },true);
  root.addEventListener('click',e=>void onClick(ctx,e));
  root.addEventListener('input',e=>{
    if (e.target.matches('.gw-range')) {
      const units = amountAtStop(Number(e.target.value), ctx.state.hand.legal);
      syncDraft(ctx, amountText(units));
    }
    if (e.target.matches('.gw-amount')) syncDraft(ctx, e.target.value);
  });
  root.addEventListener('keydown',e=>{
    if (!e.target.matches('.gw-amount') || e.isComposing || ctx.amount === null) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const {minTo, maxTo} = ctx.state.hand.legal;
    const units = Math.max(minTo, Math.min(maxTo, ctx.amount + (e.key === 'ArrowUp' ? 5 : -5)));
    syncDraft(ctx, amountText(units));
  });
  root.addEventListener('wheel',e=>{
    if (!e.target.matches('.gw-amount,.gw-range') || e.target !== document.activeElement || !e.deltaY || e.ctrlKey) return;
    const legal = ctx.state.hand.legal;
    const direction = e.deltaY < 0 ? 1 : -1;
    let units;
    if (e.target.matches('.gw-range')) units = amountAtStop(Number(e.target.value) + direction * 0.5, legal);
    else if (ctx.amount !== null) units = Math.max(legal.minTo, Math.min(legal.maxTo, ctx.amount + direction));
    else return;
    e.preventDefault();
    syncDraft(ctx, amountText(units));
  },{passive:false});
  controllers.set(root,ctx);
  return ctx;
}
export function renderGame(root,state,options={}) {
  const ctx=controllers.get(root)||setupController(root);
  ctx.options=options;ctx.state=state;
  if (state?.serverNow && state.serverNow!==ctx.clockSample) {
    ctx.clockSkew=state.serverNow-Date.now();
    ctx.clockSample=state.serverNow;
  }
  const skin=options.skin || 'chat', lang=options.lang || 'en';
  const pageKey=skin+'-'+lang+(skin === 'document' ? '-'+(options.documentIndex || 0) : '');
  const pageChanged=pageKey!==ctx.pageKey || !root.querySelector('.gw-tool-slot');
  root.classList.add('gw-root');root.dataset.gwSkin=skin;
  root.toggleAttribute('data-active-hand',!!state?.hand && state.hand.street!=='complete');
  if (pageChanged) {
    ctx.pageKey=pageKey;
    root.innerHTML=skin==='cli'?cliMarkup(ctx):skin==='document'?docMarkup(ctx):chatMarkup();
  }
  if (skin === 'chat') syncChat(root,state,lang);
  if (skin === 'document') syncDocument(root,state,lang,options.documentIndex);
  const slot=root.querySelector('.gw-tool-slot');
  if (!state) {
    ctx.markup=null;ctx.draftKey=null;ctx.rebuyKey=null;
    regionMarkup.delete(slot);
    if (options.entryNode && slot.firstElementChild!==options.entryNode) slot.replaceChildren(options.entryNode);
    return;
  }
  initDraft(ctx);
  // Ignore polling timestamps. Patch the tool only when its visible game state changes.
  const signature=JSON.stringify([pageKey,state.roomId,state.me,state.players,state.hand,state.turnKey,state.clock?.phase,state.running,state.history?.length]);
  if (pageChanged || ctx.markup!==signature) {
    ctx.markup=signature;
    const wasActing=ctx.ownTurn;
    ctx.ownTurn=state.hand?.actorId===state.me.id;
    renderTool(slot,ctx);
    if (skin === 'document') {
      slot.parentElement.querySelector('.gw-review-turn').hidden = !ctx.ownTurn;
      if (ctx.ownTurn && (!wasActing || pageChanged) &&
          !root.querySelector('.gw-paper :is(input, textarea):focus')) setReviewOpen(slot.parentElement,true);
    }
    if (ctx.ownTurn && (!wasActing || pageChanged)) {
      requestAnimationFrame(() => {
        // A turn notification must not scroll the user's active editor out of view.
        if (document.querySelector('dialog[open]') || document.activeElement?.matches('input, textarea, select, [contenteditable=true]')) return;
        if (skin === 'document') {
          // Scroll the margin contents only. Keep the reader on their paragraph.
          const decisions = slot.querySelector('.gw-decisions');
          if (decisions) slot.scrollTop += Math.max(0, decisions.getBoundingClientRect().bottom - slot.getBoundingClientRect().bottom);
        } else slot.querySelector('.gw-decisions')?.scrollIntoView({block:'nearest'});
      });
    }
  }
  updateClock(ctx);
}
