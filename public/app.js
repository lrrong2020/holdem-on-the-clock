import './splitter.js';
import { localizedError } from './errors.js';
import { keepPresence } from './presence.js';
import { icon } from './icons.js';
import { renderGame, renderHistory } from './game.js';
import { getDocumentTitle, preparePersonalDocument } from './document.js';
import { getChatTitle, prepareChatContent } from './chat-content.js';
import { chatMarkup, syncChat } from './chat.js';
import { openHistoryReader } from './history-nav.js';
import { showRecord, records } from './records.js';

const $ = (selector) => document.querySelector(selector);
const dialog = $('#dialog');
let dialogGesture = null;
const view = $('#view');
const roomPath = /^\/r\/([A-Za-z0-9_-]{20})\/?$/;
const readPref = (key, fallback) => {
  try {
    return localStorage.getItem('folio.' + key) || fallback;
  } catch {
    return fallback;
  }
};
function remember(key, value) {
  try {
    localStorage.setItem('folio.' + key, value);
  } catch {
    /* Private browsing can disable storage. */
  }
}
let lang = readPref('lang', 'en') === 'zh' ? 'zh' : 'en';
let skin = readPref('skin', 'chat');
if (!['chat', 'cli', 'document'].includes(skin)) skin = 'chat';
let roomId = roomPath.exec(location.pathname)?.[1] ?? null;
const lastDocument = history.state?.folioDocument;
let state = null,
  expired = false,
  record = skin === 'document' && Number.isInteger(lastDocument) && records[lastDocument] ? lastDocument : 0,
  modal = '',
  shellKey = '',
  entry = null,
  entryKey = '';
let requestVersion = 0,
  pendingPoll = false,
  busy = false,
  disconnected = false;
let historyReader = null;
let address = { origins: [], publicOrigin: null };
const t = (en, zh) => (lang === 'zh' ? zh : en);
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]
  );
function title(i) {
  if (skin === 'chat') return getChatTitle(state,i,lang);
  if (skin === 'document') return getDocumentTitle(state,lang,i);
  return records[i][lang][0];
}
const actBtn = (action, text, style = 'outline-btn', ico = '') =>
  '<button type="button" data-ui="' +
  action +
  '" class="' +
  style +
  '">' +
  (ico ? icon(ico, 16) : '') +
  text +
  '</button>';
const num = (value) => String(value / 10);
function notice(message) {
  const node = $('#notice');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => (node.hidden = true), 3800);
}
function netStatus(failed) {
  disconnected = failed;
  $('#connection').textContent = t(
    'Connection interrupted. Reconnecting…',
    '连接中断，正在重新连接…'
  );
  $('#connection').hidden = !failed;
}
async function api(path, data) {
  let res;
  try {
    res = await fetch(path, {
      method: data === undefined ? 'GET' : 'POST',
      cache: 'no-store',
      headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(6500)
    });
  } catch {
    netStatus(true);
    throw Error(
      t(
        'Could not reach the workspace. Check the connection and try again.',
        '无法连接工作区，请检查网络后重试。'
      )
    );
  }
  const response = await res
    .json()
    .catch(() => ({ error: t('Connection interrupted.', '连接中断。') }));
  if (res.status >= 500) netStatus(true);
  else netStatus(false);
  if (!res.ok)
    throw Object.assign(Error(localizedError(response.error, lang)), {
      status: res.status
    });
  return response;
}
function setRoute(id) {
  roomId = id;
  requestVersion++;
  entryKey = '';
  shellKey = '';
  record = 0;
  history.replaceState(null, '', id ? '/r/' + id : '/');
}
function applyState(next) {
  state = next;
  keepPresence(next.roomId);
  expired = false;
  render();
  if (dialog.open && modal === 'manage') updatePeople();
  if (dialog.open && modal === 'history') historyReader?.refresh(next.history);
}
async function command(type, payload = {}) {
  if (busy || !state) return;
  busy = true;
  requestVersion++;
  try {
    const next = await api('/api/rooms/' + roomId + '/command', {
      ...payload,
      type
    });
    if (next.left) {
      keepPresence(null);
      state = null;
      setRoute(null);
      closeModal();
      render();
    } else applyState(next);
    return next;
  } catch (err) {
    showError(err.message);
  } finally {
    busy = false;
    requestVersion++;
  }
}
async function poll() {
  if (!roomId || busy || pendingPoll) return;
  const seq = requestVersion,
    id = roomId;
  pendingPoll = true;
  try {
    const next = await api('/api/rooms/' + id);
    if (seq === requestVersion && id === roomId) applyState(next);
  } catch (e) {
    if (seq !== requestVersion) return;
    if (e.status === 401 || e.status === 404) {
      const vanished = Boolean(state);
      keepPresence(null);
      state = null;
      expired = e.status === 404;
      if (vanished) {
        closeModal();
        notice(
          expired
            ? t('This session has ended.', '本场已结束。')
            : t('Your seat has been released.', '你的座位已释放。')
        );
      }
      render();
    }
  } finally {
    pendingPoll = false;
  }
}
function newEntry() {
  const k = [roomId, expired, lang].join('.');
  if (k === entryKey && entry) return entry;
  entryKey = k;
  entry = document.createElement('section');
  entry.className = 'entry-box';
  const invited = roomId && !expired;
  const heading = invited
    ? t('Session invitation', '会话邀请')
    : expired
      ? t('Previous session ended', '上一场会话已结束')
      : t('Private session', '私密会话');
  entry.innerHTML =
    '<span class="entry-glyph">' +
    icon('group', 20) +
    '</span><div class="entry-copy"><b>' +
    heading +
    '</b>' +
    (expired ? '<small>' + t('Reuse this link for a new session.', '可用原链接重新开桌。') + '</small>' : '') +
    '</div><div class="entry-actions">' +
    (invited
      ? actBtn('join', t('Request a seat', '申请入座'), 'solid-btn')
      : actBtn(
          'create',
          t('Create session', '创建会话'),
          'solid-btn',
          'plus'
        )) +
    '</div>';
  return entry;
}
const compactNav = matchMedia('(max-width:780px)');
function updateSidebarAccess() {
  $('#sidebar').inert =
    compactNav.matches && !document.body.classList.contains('nav-open');
}
function closeNav() {
  document.body.classList.remove('nav-open');
  $('#shade').hidden = true;
  updateSidebarAccess();
}
compactNav.addEventListener('change', closeNav);
updateSidebarAccess();
function toggleNav() {
  const open = document.body.classList.toggle('nav-open');
  $('#shade').hidden = !open;
  updateSidebarAccess();
}
function renderShell() {
  const me = state?.me;
  const k = JSON.stringify([
    lang,
    skin,
    records.map((_,index) => title(index)),
    me?.name,
    me?.status,
    me?.host,
    state?.requests?.length,
    state?.kernelMode,
    record,
    roomId,
    expired
  ]);
  if (k === shellKey) return;
  shellKey = k;
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.querySelector('folio-splitter[data-split=sidebar]').lang = lang;
  document.body.dataset.skin = skin;
  document.title = title(record) + ' · Folio';
  const profile = me?.name || t('Personal workspace', '个人工作区');
  $('#sidebar').innerHTML =
    '<div class="brand"><img src="/folio.svg" alt="">Folio</div><div class="sidebar-body">' +
    (state?.kernelMode ? '' : actBtn(
      state ? 'invite' : 'entry',
      state ? t('Invite members', '邀请成员') : t('New session', '新建会话'),
      'side-new', state ? 'link' : 'plus'
    )) +
    '<button class="side-row ' +
    (!record ? 'on' : '') +
    '" data-record="0">' +
    icon(skin === 'document' ? 'doc' : 'message', 17) +
    '<span class="thread-title">' + esc(title(0)) + '</span>' +
    '</button>' +
    '<div class="side-label">' +
    t('Recent threads', '最近主题') +
    '</div>' +
    records
      .slice(1)
      .map(
        (_, i) =>
          '<button class="side-row ' +
          (record === i + 1 ? 'on' : '') +
          '" data-record="' +
          (i + 1) +
          '">' +
          icon('message', 16) +
          '<span class="thread-title">' + esc(title(i + 1)) + '</span>' +
          '</button>'
      )
      .join('') +
    '</div><div class="side-footer">' +
    actBtn('history', t('Session history', '会话记录'), 'side-meta', 'clock') +
    actBtn(
      'manage',
      t('Session settings', '会话设置') +
        (state?.requests.length ? ' (' + state.requests.length + ')' : ''),
      'side-meta',
      'sliders'
    ) +
    '<button class="profile" data-ui="' +
    (me ? 'manage' : 'entry') +
    '"><span class="avatar">' +
    esc(me?.name.slice(0, 1).toUpperCase() || 'F') +
    '</span><span><strong>' +
    esc(profile) +
    '</strong>' +
    (me?.host ? '<small>' + t('Host', '房主') + '</small>' : '') +
    '</span>' +
    icon('down', 15) +
    '</button></div>';
  if (!me) {
    const settingsButton = $('#sidebar [data-ui="manage"]');
    settingsButton.disabled = true;
    settingsButton.title = t('Available in a session', '开桌后可用');
  }
  const modes = [
    ['chat', 'message', t('Chat', '对话')],
    ['document', 'doc', t('Document', '文档')],
    ['cli', 'terminal', t('Terminal', '终端')]
  ];
  $('#topbar').innerHTML =
    '<div class="crumb"><button class="flat-btn mobile-menu" data-ui="nav" aria-label="' +
    t('Open sidebar', '打开侧栏') +
    '">' +
    icon('menu', 19) +
    '</button><b>' +
    esc(title(record)) +
    '</b></div><div class="header-controls"><div class="segmented" aria-label="' +
    t('Appearance', '外观') +
    '">' +
    modes
      .map(
        ([value, ico, label]) =>
          '<button class="' +
          (value === skin ? 'on' : '') +
          '" data-skin-option="' +
          value +
          '" aria-pressed="' +
          (value === skin) +
          '" aria-label="' +
          label +
          '" title="' +
          label +
          '">' +
          icon(ico, 14) +
          '<span>' +
          label +
          '</span></button>'
      )
      .join('') +
    '</div><button class="flat-btn lang-btn" data-ui="language" title="' +
    t('切换为中文', 'Switch to English') +
    '">' +
    icon('globe', 15) +
    (lang === 'en' ? '中文' : 'EN') +
    '</button>' +
    (state
      ? '<button class="flat-btn invite-btn" data-ui="manage" aria-label="' +
        t('Manage session', '管理会话') +
        '">' +
        icon('sliders', 16) +
        (state.requests.length
          ? '<span>(' + state.requests.length + ')</span>'
          : '') +
        '</button>'
      : '') +
    '</div>';
}
function render() {
  prepareChatContent(state);
  preparePersonalDocument(state);
  renderShell();
  if (record && skin !== 'document') {
    if (skin === 'chat') {
      view.classList.add('gw-root');
      view.removeAttribute('data-active-hand');
      view.dataset.gwSkin = 'chat';
      if (!view.querySelector('folio-chat[data-record-chat]')) {
        view.innerHTML = chatMarkup(false);
        view.firstElementChild.setAttribute('data-record-chat','');
      }
      syncChat(view,state,lang,record);
    } else showRecord(view, record, lang, () => selectRecord(0));
    return;
  }
  renderGame(view, state, {
    lang,
    skin,
    documentIndex: record,
    entryNode: state ? null : newEntry(),
    onAction: command,
    onManage: manage,
    onHistory: historyModal,
    onInvite: invite
  });
}
function selectRecord(i) {
  if (record !== i) view.replaceChildren();
  record = i;
  history.replaceState(skin === 'document' ? {folioDocument:i} : null, '');
  closeNav();
  render();
}
function modalFrame(id, heading, ico, content) {
  closeNav();
  dialogGesture = null;
  historyReader?.destroy();
  historyReader = null;
  dialog.dataset.modal = id;
  if (dialog.open) dialog.close();
  modal = id;
  $('#dialog-content').innerHTML =
    '<div class="modal-head"><span class="modal-glyph">' +
    icon(ico, 20) +
    '</span><button data-ui="close" aria-label="' +
    t('Close', '关闭') +
    '">' +
    icon('close', 19) +
    '</button></div><h2>' +
    heading +
    '</h2><div id="form-error" class="form-error" role="alert" hidden></div>' +
    content;
  dialog.showModal();
  const target = dialog.querySelector('[data-focus]');
  if (target) target.focus();
}
dialog.addEventListener('close', () => {
  if (!dialog.open) {
    historyReader?.destroy();
    historyReader = null;
    modal = '';
  }
});
function closeModal() {
  if (dialog.open) dialog.close();
  modal = '';
}
function showError(message) {
  if (!dialog.open) {
    notice(message);
    return;
  }
  const el = $('#form-error');
  el.hidden = false;
  el.textContent = message;
}
function field(label, name, type = 'text', value = '', attrs = '') {
  return (
    '<label class="field">' +
    label +
    '<input name="' +
    name +
    '" type="' +
    type +
    '" value="' +
    esc(value) +
    '" ' +
    attrs +
    '></label>'
  );
}
function formEnd(label) {
  return (
    '<div class="form-actions"><button class="solid-btn" type="submit">' +
    label +
    '</button></div>'
  );
}
function openEntry() {
  if (state) return manage();
  if (roomId && !expired) return join();
  create();
}
function create() {
  const kernelChoice = address.kernelAvailable
    ? '<label><input type="radio" name="mode" value="kernel" checked> ' + t('Play Kernel', '挑战 Kernel') +
      '<small>' + t('Heads-up · 100 BB each hand', '单挑 · 每手 100 BB') + '</small></label>'
    : '';
  modalFrame(
    'create',
    t('Create session', '创建会话'),
    'stack',
    '<form data-form="create" class="form-stack">' +
      field(
        t('Your nickname', '你的昵称'),
        'name',
        'text',
        readPref('name', ''),
        'data-focus required maxlength="32" autocomplete="nickname"'
      ) +
      '<div class="mode-choices"><label><input type="radio" name="mode" value="solo"' + (address.kernelAvailable ? '' : ' checked') + '> ' +
      t('Solo practice', '单人练习') +
      '<small>' +
      t('One local opponent', '一位本地练习对手') +
      '</small></label><label><input type="radio" name="mode" value="friends"> ' +
      t('With friends', '和朋友一起') +
      '<small>' +
      t('Invite up to 8 people', '最多邀请 8 位朋友') +
      '</small></label>' + kernelChoice + '</div><p class="hint">' +
      t(
        '100 BB buy-in · 0.5/1 BB blinds · Play chips only',
        '买入 100 BB · 盲注 0.5/1 BB · 虚拟筹码'
      ) +
      '</p>' +
      formEnd(t('Create session', '创建会话')) +
      '</form>'
  );
}
function join() {
  modalFrame(
    'join',
    t('Request a seat', '申请入座'),
    'group',
    '<form data-form="join" class="form-stack">' +
      field(
        t('Your nickname', '你的昵称'),
        'name',
        'text',
        readPref('name', ''),
        'data-focus required maxlength="32" autocomplete="nickname"'
      ) +
      '<p class="hint">' +
      t(
        'Once the host approves your seat, you start with 100 BB.',
        '房主同意后即可入座，起始筹码为 100 BB。'
      ) +
      '</p>' +
      formEnd(t('Send request', '提交申请')) +
      '</form>'
  );
}
function invite() {
  if (!state) return openEntry();
  if (state.kernelMode) return;
  const origin =
    address.publicOrigin ||
    (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
      ? address.origins[0]
      : null) ||
    location.origin;
  const href = origin + '/r/' + roomId;
  modalFrame(
    'invite',
    t('Invite members', '邀请成员'),
    'link',
    '<div class="form-stack"><p class="hint">' +
      t(
        'Guests need host approval to join.',
        '访客须经房主批准才能入座。'
      ) +
      '</p>' +
      field(
        t('Invitation link', '邀请链接'),
        'invite',
        'url',
        href,
        'readonly data-focus'
      ) +
      (!origin.startsWith('https:')
        ? '<p class="hint">' +
          t(
            'This address is for devices on the same network.',
            '此地址适用于同一局域网内的设备。'
          ) +
          '</p>'
        : '') +
      '<div class="form-actions">' +
      actBtn('copy', t('Copy link', '复制链接'), 'solid-btn', 'link') +
      '</div></div>'
  );
}
function manage() {
  if (!state) return openEntry();
  const { me, settings: s, cloud } = state;
  const host = me.host;
  let content = '<div id="people"></div>';
  if (host) {
    content +=
      '<div class="settings-block small-actions">' +
      (state.kernelMode ? '' : actBtn('addBot', t('Add local opponent', '添加本地 AI')) +
        actBtn('addCloud', t('Add cloud opponent', '添加云端 AI'))) +
      (state.kernelError ? actBtn('retryKernel', t('Retry Kernel', '重试 Kernel')) : actBtn(
        state.running ? 'pause' : 'start',
        state.running
          ? t('Pause after hand', '本手后暂停')
          : t('Start dealing', '开始发牌')
      )) +
      '</div>' +
      '<details class="settings-block"><summary>' +
      t('Action timer', '行动计时') +
      '</summary><form data-form="settings" class="form-stack"><div class="three-inputs">' +
      field(
        t('Time to act (s)', '行动时间（秒）'),
        'baseSeconds',
        'number',
        s.baseSeconds,
        'required min="1" max="600"'
      ) +
      field(
        t('Time cards per player', '每人时间卡（张）'),
        'initialCards',
        'number',
        s.initialCards,
        'required min="0" max="100"'
      ) +
      field(
        t('Seconds per card', '每张时长（秒）'),
        'cardSeconds',
        'number',
        s.cardSeconds,
        'required min="1" max="600"'
      ) +
      '</div>' +
      formEnd(t('Save timer', '保存计时设置')) +
      '</form></details>';
    if (!state.kernelMode) content +=
      '<details class="settings-block" id="cloud-config"><summary>Ollama Cloud' +
      (cloud.configured ? ' · ' + t('Configured', '已配置') : '') +
      '</summary><form data-form="cloud" class="form-stack"><p class="hint">' +
      t(
        'The host server keeps this key in memory for this session. Each model sees its own hand and public table data.',
        '本场密钥只保存在房主服务器的内存中。每个 AI 只能看到自己的底牌和牌桌上的公开信息。'
      ) +
      '</p>' +
      field('API key', 'key', 'password', '', 'required autocomplete="off"') +
      field(
        t('Primary model', '主模型'),
        'primary',
        'text',
        cloud.primary,
        'required'
      ) +
      field(
        t('Fallback model', '备用模型'),
        'fallback',
        'text',
        cloud.fallback
      ) +
      formEnd(t('Save connection', '保存连接')) +
      '</form></details>';
  }
  if (me.status === 'standing' && !state.kernelMode)
    content +=
      '<form class="settings-block" data-form="rebuy">' +
      field(
        t('Rebuy amount (BB)', '重新买入筹码（BB）'),
        'amount',
        'number',
        '100',
        'min="0.1" step="0.1" required'
      ) +
      formEnd(t('Request rebuy', '申请重新买入')) +
      '</form>';
  modalFrame(
    'manage',
    t('Session settings', '会话设置'),
    'sliders',
    content +
      '<div class="form-actions">' +
      actBtn('leaveConfirm', t('Leave session', '离开会话')) +
      (state.kernelMode ? '' : actBtn('invite', t('Invite members', '邀请成员'), 'solid-btn', 'link')) +
      '</div>'
  );
  updatePeople();
}
function updatePeople() {
  const el = $('#people');
  if (!el || !state) return;
  const { me, requests, players } = state;
  const signature = JSON.stringify([
    requests,
    players.map((p) => [p.id, p.status, p.stack, p.online]),
    lang
  ]);
  if (el.dataset.signature === signature) return;
  el.dataset.signature = signature;
  const personBtn = (v, id, label) =>
    '<button data-member="' +
    esc(id) +
    '" data-operation="' +
    v +
    '">' +
    label +
    '</button>';
  el.innerHTML =
    (requests.length
      ? '<section class="settings-block"><h3>' +
        t('Player requests', '待处理申请') +
        ' (' +
        requests.length +
        ')</h3>' +
        requests
          .map(
            (r) =>
              '<div class="person"><span>' +
              esc(r.name) +
              ' <small>' +
              (r.kind === 'rebuy' ? t('Rebuy', '重新买入') : t('Buy-in', '买入')) +
              ' ' + num(r.amount) +
              ' BB</small></span>' +
              personBtn('approve', r.id, t('Approve', '批准')) +
              personBtn('reject', r.id, t('Decline', '拒绝')) +
              '</div>'
          )
          .join('') +
        '</section>'
      : '') +
    '<section class="settings-block"><h3>' +
    t('Members', '成员') +
    ' · ' +
    players.length +
    '</h3>' +
    players
      .map(
        (p) =>
          '<div class="person"><span>' +
          esc(p.name) +
          ' <small>' +
          (p.bot
            ? 'AI'
            : p.host
              ? t('Host', '房主')
              : p.online
                ? t('Online', '在线')
                : t('Offline', '离线')) +
          ' · ' +
          num(p.stack) +
          ' BB</small></span>' +
          (me.host && !state.kernelMode
            ? personBtn('stack', p.id, t('Stack', '筹码')) +
              (p.id === me.id
                ? ''
                : personBtn('remove', p.id, t('Remove', '移出')))
            : '') +
          '</div>'
      )
      .join('') +
    '</section>';
}
function memberAction(op, id) {
  if (['approve', 'reject'].includes(op)) return command(op, { id });
  const player = state?.players.find((p) => p.id === id);
  if (!player) return;
  if (op === 'stack')
    modalFrame(
      'stack',
      t('Adjust stack', '调整筹码') + ' · ' + esc(player.name),
      'sliders',
      '<form data-form="stack" class="form-stack"><input type="hidden" name="id" value="' +
        esc(id) +
        '">' +
        field(
          t('Stack (BB)', '筹码量（BB）'),
          'amount',
          'number',
          num(player.stack),
          'min="0" step="0.1" required data-focus'
        ) +
        '<p class="hint">' +
        t(
          'For a player in the current hand, wait until the hand ends to change their stack. Set it to 0 to free the seat.',
          '若该玩家参与本手，请在本手结束后调整筹码。设为 0 即腾出座位。'
        ) +
        '</p>' +
        formEnd(t('Save stack', '保存筹码')) +
        '</form>'
    );
  if (op === 'remove')
    modalFrame(
      'remove',
      t('Remove member?', '移出成员？'),
      'group',
      '<p>' +
        esc(player.name) +
        '</p><div class="form-actions">' +
        actBtn('manage', t('Cancel', '取消')) +
        '<button class="solid-btn" data-remove="' +
        esc(id) +
        '">' +
        t('Remove member', '确认移出') +
        '</button></div>'
    );
}
function historyModal() {
  const heading = t('Hand history', '本场牌谱');
  if (!state) {
    modalFrame('history', heading, 'clock',
      '<p class="hint">' + t('Each completed hand appears here.', '每手牌结算后，牌谱会显示在这里。') + '</p>');
    return;
  }
  modalFrame('history', heading, 'clock', '<div id="history-browser"></div>');
  historyReader = openHistoryReader($('#history-browser'), {
    read: api, roomId: state.roomId, viewerId: state.me.id, lang, renderHand: renderHistory
  });
  historyReader.refresh(state.history);
}
function leaveConfirm() {
  modalFrame(
    'leave',
    t('Leave this session?', '离开当前会话？'),
    'leave',
    '<p class="hint">' +
      t(
        'Leaving frees your seat. When the last human player leaves, the session ends and its hand history is deleted.',
        '离开后会腾出座位。最后一位真人玩家离桌后，本场结束，牌谱随之清除。'
      ) +
      '</p><div class="form-actions">' +
      actBtn('manage', t('Stay', '留下')) +
      actBtn('leave', t('Leave session', '离开会话'), 'solid-btn') +
      '</div>'
  );
}
document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  const type = form.dataset.form;
  const data = Object.fromEntries(new FormData(form));
  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  try {
    if (type === 'create' || type === 'join') {
      if (busy) return;
      busy = true;
      requestVersion++;
      let next;
      try {
        next =
          type === 'create'
            ? await api('/api/create', {
                name: data.name.trim(),
                ...(data.mode === 'kernel' ? { mode: 'kernel' } : {}),
                ...(expired && roomId ? { roomId } : {})
              })
            : await api('/api/rooms/' + roomId + '/join', {
                name: data.name.trim()
              });
      } finally {
        busy = false;
        requestVersion++;
      }
      setRoute(next.roomId);
      remember('name', data.name.trim());
      closeModal();
      applyState(next);
      if (type === 'create' && data.mode === 'solo') {
        if (await command('addBot', { mode: 'local' })) await command('start');
      }
      return;
    }
    const args = { ...data };
    if (type === 'settings')
      for (const key of Object.keys(args)) args[key] = Number(args[key]);
    if (['stack', 'rebuy'].includes(type))
      args.amount = Math.round(Number(data.amount) * 10);
    if (await command(type, args)) {
      manage();
      notice(t('Saved', '已保存'));
    }
  } catch (e) {
    showError(e.message);
  } finally {
    button.disabled = false;
  }
});
document.addEventListener('click', async (event) => {
  const el = event.target.closest('button,[data-ui]');
  if (!el) return;
  if (el.hasAttribute('data-record'))
    return selectRecord(Number(el.dataset.record));
  if (el.dataset.operation)
    return memberAction(el.dataset.operation, el.dataset.member);
  if (el.dataset.remove) {
    if (await command('remove', { id: el.dataset.remove })) manage();
    return;
  }
  if (el.dataset.skinOption) {
    skin = el.dataset.skinOption;
    remember('skin', skin);
    selectRecord(0);
    return;
  }
  if (!el.dataset.ui) return;
  const actions = {
    nav: toggleNav,
    mainDocument: () => selectRecord(0),
    entry: openEntry,
    create,
    join,
    manage,
    invite,
    history: historyModal,
    close: closeModal,
    leaveConfirm,
    copy: async () => {
      const input = dialog.querySelector('[name=invite]');
      try {
        await navigator.clipboard.writeText(input.value);
        notice(t('Invitation link copied', '邀请链接已复制'));
      } catch {
        input.select();
        notice(
          t('Select and copy the invitation link', '请选择并复制邀请链接')
        );
      }
    },
    language: () => {
      lang = lang === 'en' ? 'zh' : 'en';
      remember('lang', lang);
      render();
    },
    leave: () => command('leave'),
    retryKernel: async () => {
      if (await command('retryKernel')) closeModal();
    },
    start: async () => {
      if (await command('start')) closeModal();
    },
    pause: async () => {
      if (await command('pause')) manage();
    },
    addBot: () => command('addBot', { mode: 'local' }),
    addCloud: async () => {
      if (!state?.cloud.configured) {
        $('#cloud-config').open = true;
        $('#cloud-config input').focus();
        return;
      }
      await command('addBot', { mode: 'cloud' });
    }
  };
  closeNav();
  if (actions[el.dataset.ui]) await actions[el.dataset.ui]();
});
$('#shade').onclick = closeNav;
function outsideDialog(event) {
  const {left, right, top, bottom} = dialog.getBoundingClientRect();
  return event.clientX < left || event.clientX >= right ||
    event.clientY < top || event.clientY >= bottom;
}
function isOnDialogBackdrop(event) {
  return event.target === dialog && outsideDialog(event);
}
// A selection drag that starts in an input and ends outside the dialog also
// produces a click on the dialog. Only dismiss for a press AND release on the backdrop.
dialog.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0) return;
  dialogGesture = null;
  if (isOnDialogBackdrop(event)) dialogGesture = {id:event.pointerId, kind:'backdrop'};
  else if (event.pointerType === 'mouse' && event.target.matches('textarea, input:not([type]), input:is([type=text],[type=number],[type=url],[type=password],[type=search],[type=email],[type=tel])')) {
    dialogGesture = {id:event.pointerId, kind:'selection'};
  }
});
dialog.addEventListener('pointermove', event => {
  // WebKit clears a field's selection as soon as a drag enters ::backdrop.
  if (dialogGesture?.kind === 'selection' && dialogGesture.id === event.pointerId &&
      event.buttons === 1 && event.cancelable && outsideDialog(event)) event.preventDefault();
});
dialog.addEventListener('pointerup', event => {
  if (dialogGesture?.id !== event.pointerId) return;
  if (dialogGesture.kind === 'backdrop' && isOnDialogBackdrop(event)) dialogGesture.released = true;
  else dialogGesture = null;
});
dialog.addEventListener('pointercancel', () => { dialogGesture = null; });
dialog.addEventListener('click', event => {
  const dismiss = dialogGesture?.released && isOnDialogBackdrop(event);
  dialogGesture = null;
  if (dismiss) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeNav();
});
document.addEventListener('folio-document-saved', render);
document.addEventListener('folio-chat-title', render);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void poll();
});
async function boot() {
  try {
    address = await api('/api/address');
  } catch {
    /* Show available local UI. */
  }
  if (roomId) await poll();
  render();
  setInterval(poll, 850);
}
void boot();
