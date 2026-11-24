import {summarizeHistoryHand} from './hand-summary.js';

const PAGE_SIZE = 24;
const suits = {s:'♠', h:'♥', d:'♦', c:'♣'};

export function handOptionLabel(hand, lang) {
  const zh = lang === 'zh';
  const parts = ['#' + hand.number];
  if (hand.played) {
    parts.push(hand.cards.map(card => card[0].replace('T','10') + suits[card[1]]).join(' '));
    if (!hand.net) parts.push(zh ? '持平' : 'Even');
    else parts.push((hand.net > 0 ? '+' : '−') + Math.abs(hand.net) / 10 + ' BB');
  } else parts.push(zh ? '未参局' : 'Not dealt in');
  parts.push((zh ? '底池 ' : 'Pot ') + hand.pot / 10 + ' BB');
  return parts.join(' · ');
}

// The running server holds live rooms in memory. Its original per-hand route
// lets already-open rooms gain rich summaries without restarting the game.
export function makeHistorySource(read, roomId, viewerId) {
  const base = '/api/rooms/' + encodeURIComponent(roomId) + '/history';
  const details = new Map();
  const inFlight = new Map();
  let useLegacy = false;

  async function detail(number) {
    if (details.has(number)) return details.get(number);
    if (inFlight.has(number)) return inFlight.get(number);
    const request = read(base + '/' + number).then(hand => {
      details.set(number, hand);
      if (details.size > PAGE_SIZE) details.delete(details.keys().next().value);
      return hand;
    }).finally(() => inFlight.delete(number));
    inFlight.set(number, request);
    return request;
  }

  async function summaries(numbers, active) {
    if (!useLegacy) {
      try {
        const result = await read(base + '?before=' + (numbers[0] + 1) + '&limit=' + numbers.length);
        return result.items;
      } catch (error) {
        if (error.status !== 404) throw error;
        useLegacy = true;
      }
    }
    const items = [];
    for (let i = 0; i < numbers.length && active(); i += 4) {
      const batch = await Promise.all(numbers.slice(i, i + 4).map(detail));
      items.push(...batch.map(hand => summarizeHistoryHand(hand, viewerId)));
    }
    return items;
  }
  return {detail, summaries};
}

export function openHistoryReader(root, {read, roomId, viewerId, lang, renderHand}) {
  const t = (en, zh) => lang === 'zh' ? zh : en;
  root.innerHTML = `
    <div class="history-toolbar">
      <label for="hand-select">${t('Find a hand', '查找手牌')}</label>
      <select id="hand-select" class="row-select"></select>
      <div class="history-step">
        <button id="history-prev" type="button" class="outline-btn" title="${t('Older hand (←)', '上一手（←）')}"><span aria-hidden="true">‹</span> ${t('Previous','上一手')}</button>
        <button id="history-next" type="button" class="outline-btn" title="${t('Newer hand (→)', '下一手（→）')}">${t('Next','下一手')} <span aria-hidden="true">›</span></button>
      </div>
      <div class="history-more"><span data-history-count></span><button type="button" id="history-older">${t('Load older hands','查看更早的牌谱')}</button></div>
    </div>
    <p class="form-error" role="alert" data-history-error hidden></p>
    <button type="button" class="outline-btn" data-history-retry hidden>${t('Retry','重试')}</button>
    <div id="history-item" class="modal-history" tabindex="0" aria-label="${t('Hand details','本手详情')}"></div>`;
  const find = selector => root.querySelector(selector);
  const menu = find('#hand-select');
  const prev = find('#history-prev');
  const next = find('#history-next');
  const more = find('#history-older');
  const errorBox = find('[data-history-error]');
  const retry = find('[data-history-retry]');
  const output = find('#history-item');
  const source = makeHistorySource(read, roomId, viewerId);
  const rows = new Map();
  const options = new Map();
  let numbers = [];
  let initialized = false;
  let count = PAGE_SIZE;
  let selection = null;
  let filling = false;
  let stopped = false;
  let selectionVersion = 0;
  const active = () => !stopped && root.isConnected && root.closest('dialog').open;

  function updateMenu() {
    const visible = numbers.slice(0, count);
    // Keep native options in place as their labels arrive, including while
    // a player is browsing the open dropdown on a phone.
    for (const [index, id] of visible.entries()) {
      let option = options.get(id);
      if (!option) {
        option = new Option('', id);
        options.set(id, option);
      }
      const label = rows.has(id) ? handOptionLabel(rows.get(id), lang) : '#' + id + ' …';
      if (option.text !== label) option.text = label;
      if (menu.options[index] !== option) menu.insertBefore(option, menu.options[index] || null);
    }
    while (menu.options.length > visible.length) menu.remove(menu.options.length - 1);
    menu.value = String(selection);
    const index = numbers.indexOf(selection);
    prev.disabled = index < 0 || index === numbers.length - 1;
    next.disabled = index <= 0;
    more.hidden = count >= numbers.length;
    find('[data-history-count]').textContent = visible.length < numbers.length
      ? t(visible.length+' of '+numbers.length+' hands', '已列出 '+visible.length+' / '+numbers.length+' 手')
      : t(numbers.length+(numbers.length === 1 ? ' hand' : ' hands'), '共 '+numbers.length+' 手');
    find('.history-toolbar').hidden = !numbers.length;
  }

  function showError(error) {
    if (!active()) return;
    errorBox.textContent = error.message;
    errorBox.hidden = retry.hidden = false;
  }

  async function fillSummaries() {
    if (filling) return;
    filling = true;
    try {
      while (active()) {
        const visible = numbers.slice(0, count);
        const start = visible.findIndex(id => !rows.has(id));
        if (start === -1) break;
        // Use one contiguous window per request, including any cached rows inside it.
        const page = visible.slice(start, start + PAGE_SIZE);
        const items = await source.summaries(page, active);
        if (!active()) break;
        if (!items.some(item => item.number === page[0])) throw Error(t('Hand summary unavailable.', '暂时无法加载牌谱摘要。'));
        for (const item of items) rows.set(item.number, item);
        updateMenu();
      }
    } catch (error) { showError(error); }
    finally { filling = false; }
  }

  async function select(number) {
    const index = numbers.indexOf(number);
    if (index < 0) return;
    selection = number;
    const version = ++selectionVersion;
    if (index >= count) count += PAGE_SIZE;
    updateMenu();
    errorBox.hidden = retry.hidden = true;
    output.setAttribute('aria-busy', 'true');
    output.textContent = t('Loading hand…','正在加载牌谱…');
    output.scrollTop = 0;
    const request = source.detail(number);
    void fillSummaries();
    try {
      const hand = await request;
      if (!active() || version !== selectionVersion) return;
      if (!rows.has(number)) {
        rows.set(number, summarizeHistoryHand(hand, viewerId));
        updateMenu();
      }
      renderHand(output, hand, {lang, viewerId});
    } catch (error) {
      if (active() && version === selectionVersion) {
        output.replaceChildren();
        showError(error);
      }
    }
    finally { if (version === selectionVersion) output.removeAttribute('aria-busy'); }
  }

  function step(delta) {
    const target = numbers[numbers.indexOf(selection) + delta];
    if (target !== undefined) void select(target);
  }
  prev.onclick = () => step(1);
  next.onclick = () => step(-1);
  menu.onchange = () => void select(Number(menu.value));
  more.onclick = () => { count += PAGE_SIZE; updateMenu(); void fillSummaries(); };
  retry.onclick = () => void select(selection);
  function onKey(event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        event.target.closest('input,select,textarea,[contenteditable=true]')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      step(event.key === 'ArrowLeft' ? 1 : -1);
    }
  }
  const dialog = root.closest('dialog');
  dialog.addEventListener('keydown', onKey);
  return {
    refresh(ids) {
      if (initialized && numbers.length === ids.length && numbers[0] === ids[0]) return;
      initialized = true;
      numbers = ids;
      if (!numbers.length) {
        updateMenu();
        output.textContent = t('Completed hands will appear here.', '第一手结束后可在这里查看牌谱。');
      } else if (!numbers.includes(selection)) void select(numbers[0]);
      else {
        // Keep reading the same hand as newer hands complete.
        count = Math.max(count, numbers.indexOf(selection) + 1);
        updateMenu();
        void fillSummaries();
      }
    },
    destroy() {
      stopped = true;
      dialog.removeEventListener('keydown', onKey);
    }
  };
}
