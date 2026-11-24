import {icon} from './icons.js';
import {renderMarkdown} from './markdown.js';
import {chatKey, getChatTitle, saveChatTitle, getMessages, saveMessage, appendExchange} from './chat-content.js';

const desks = new WeakMap();
const element = (tag, className, value) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
};
const words = (lang, en, zh) => lang === 'zh' ? zh : en;

function pencil(label, attribute) {
  const button = element('button','chat-pencil');
  button.type = 'button';
  button.setAttribute(attribute,'');
  button.title = label;
  button.setAttribute('aria-label',label);
  button.innerHTML = icon('pencil',14);
  return button;
}

export function chatMarkup(hasTable = true) {
  return '<folio-chat class="gw-chat-stream"><header class="chat-thread-head"></header><section class="chat-turns" data-chat-lead></section>' +
    (hasTable ? '<div class="gw-tool-slot"></div>' : '') +
    '<section class="chat-turns" data-chat-thread></section><div class="chat-dock"></div></folio-chat>';
}

// Unsaved drafts belong to a particular seat and thread, even if a skin change
// temporarily unmounts the transcript.
export function syncChat(root, state, lang, thread = 0) {
  const key = chatKey(state);
  let desk = desks.get(root);
  if (!desk || desk.key !== key) {
    desk = {key, threads:new Map()};
    desks.set(root,desk);
  }
  if (!desk.threads.has(thread)) desk.threads.set(thread,{question:'',edit:null,paused:false});
  root.querySelector('folio-chat')?.configure(state,lang,thread,desk.threads.get(thread));
}

class FolioChat extends (globalThis.HTMLElement || class {}) {
  configure(state, lang, thread, memory) {
    this.state = state;
    if (this.memory === memory && this.lang === lang) return;
    this.lang = lang;
    this.thread = thread;
    this.memory = memory;
    this.pending = null;
    this.activityIndex = 0;
    this.render();
    this.tick();
  }
  t(en,zh) { return words(this.lang,en,zh); }
  connectedCallback() {
    this.media = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.handleVisibility = () => this.tick();
    this.syncStorage = event => {
      if (this.memory && (event.key === null || event.key.startsWith(chatKey(this.state)))) {
        // Preserve the live editor and composer during an edit in another tab.
        this.renderThread();
        document.dispatchEvent(new Event('folio-chat-title'));
      }
    };
    this.media.addEventListener('change',this.handleVisibility);
    document.addEventListener('visibilitychange',this.handleVisibility);
    window.addEventListener('storage',this.syncStorage);
    if (this.memory) this.tick();
  }
  disconnectedCallback() {
    clearTimeout(this.timer);
    this.media.removeEventListener('change',this.handleVisibility);
    document.removeEventListener('visibilitychange',this.handleVisibility);
    window.removeEventListener('storage',this.syncStorage);
  }
  render() {
    const dock = this.querySelector('.chat-dock');
    dock.innerHTML = '<div class="chat-activity" data-chat-activity><span class="chat-work-dots" aria-hidden="true"><i></i><i></i><i></i></span><span data-chat-status></span><button type="button" data-chat-pause></button></div>' +
      '<form class="gw-composer"><textarea rows="1" name="question"></textarea><button type="submit">' + icon('right',17) + '</button></form><div class="chat-error" role="alert" hidden></div>';
    const form = dock.querySelector('form');
    const field = form.elements.question;
    const prompt = this.t('Message Folio…','给 Folio 发消息…');
    field.placeholder = prompt;
    field.setAttribute('aria-label',prompt);
    field.value = this.memory.question;
    const send = form.querySelector('[type=submit]');
    send.title = this.t('Send message','发送消息');
    send.setAttribute('aria-label',send.title);
    send.disabled = !field.value.trim();
    field.oninput = () => {
      this.memory.question = field.value;
      send.disabled = !field.value.trim();
    };
    field.onkeydown = event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        if (!send.disabled) form.requestSubmit();
      }
    };
    form.onsubmit = event => {
      event.preventDefault();
      const question = field.value.trim();
      if (!question || !this.store(() => {
        const {assistant} = appendExchange(this.state,this.thread,this.lang,question);
        this.pending = {id:assistant.id, text:assistant.text, shown:0, started:false};
      })) return;
      this.memory.question = field.value = '';
      send.disabled = true;
      this.renderThread();
      this.tick();
      const latest = this.querySelector('[data-chat-thread] > :last-child');
      latest?.scrollIntoView({block:'center'});
    };
    this.querySelector('[data-chat-pause]').onclick = () => {
      this.memory.paused = !this.memory.paused;
      this.tick();
    };
    this.renderThread();
  }
  store(action) {
    const error = this.querySelector('.chat-error');
    try {
      action();
      error.hidden = true;
      return true;
    } catch {
      error.hidden = false;
      error.textContent = this.t('Couldn’t save in this browser. Your draft is still here.','当前浏览器无法保存，草稿仍在输入框中。');
      return false;
    }
  }
  renderThread() {
    const title = getChatTitle(this.state,this.thread,this.lang);
    const head = this.querySelector('.chat-thread-head');
    if (this.memory.edit?.id !== 'title' || !head.querySelector('[name=chatMessage]')) {
      if (this.memory.edit?.id === 'title') head.replaceChildren(this.editor());
      else {
        const edit = pencil(this.t('Edit conversation title','编辑对话标题'),'data-chat-title-edit');
        edit.onclick = () => this.startEdit('title',title);
        head.replaceChildren(element('h1','',title),edit);
      }
    }
    const messages = getMessages(this.state,this.thread,this.lang);
    const current = new Map([...this.querySelectorAll('[data-chat-message]')].map(row => [row.dataset.chatMessage,row]));
    const lead = this.querySelector('[data-chat-lead]');
    const thread = this.querySelector('[data-chat-thread]');
    for (const [index, message] of messages.entries()) {
      const parent = index < 2 ? lead : thread;
      let row = current.get(message.id);
      if (!row) {
        row = element('article','chat-message');
        row.dataset.chatMessage = message.id;
        row.dataset.role = message.role;
        parent.append(row);
      }
      current.delete(message.id);
      const editing = this.memory.edit?.id === message.id;
      if (editing && row.querySelector('[name=chatMessage]')) continue;
      if (!editing && row.savedText === message.text && row.dataset.mode === 'read') continue;
      row.savedText = message.text;
      row.dataset.mode = editing ? 'edit' : 'read';
      const assistant = message.role === 'assistant';
      const author = element('div','chat-byline');
      if (assistant) {
        const mark = element('span','gw-folio-mark');
        mark.innerHTML = icon('layers',13);
        author.append(mark,'Folio');
      } else author.append(this.t('You','你'));
      const edit = pencil(this.t('Edit message','编辑消息'),'data-chat-edit');
      edit.onclick = () => this.startEdit(message.id,message.text);
      if (!editing) author.append(edit);
      if (editing) row.replaceChildren(author,this.editor());
      else {
        const body = element('div','chat-body folio-markdown');
        body.innerHTML = renderMarkdown(message.text);
        row.replaceChildren(author,body);
      }
    }
    for (const row of current.values()) row.remove();
  }
  startEdit(id, value) {
    if (this.memory.edit && this.memory.edit.id !== id) {
      this.querySelector('[name=chatMessage]')?.focus();
      return;
    }
    this.finishPending();
    this.memory.edit = {id,value};
    this.renderThread();
    this.tick();
    this.querySelector('[name=chatMessage]')?.focus();
  }
  editor() {
    const draft = this.memory.edit;
    const isTitle = draft.id === 'title';
    const form = element('form','chat-editor');
    const field = element(isTitle ? 'input' : 'textarea');
    field.name = 'chatMessage';
    field.setAttribute('aria-label',isTitle ? this.t('Conversation title','对话标题') : this.t('Message in Markdown','消息正文（Markdown）'));
    field.value = draft.value;
    field.required = true;
    field.oninput = () => { draft.value = field.value; field.setCustomValidity(''); };
    if (!isTitle) field.rows = Math.min(12,Math.max(3,draft.value.split('\n').length + 1));
    const actions = element('div','chat-editor-actions');
    const cancel = element('button','outline-btn',this.t('Cancel','取消'));
    cancel.type = 'button';
    cancel.setAttribute('data-chat-cancel','');
    const save = element('button','solid-btn',this.t('Save changes','保存修改'));
    save.type = 'submit';
    save.setAttribute('data-chat-save','');
    const close = () => {
      this.memory.edit = null;
      this.renderThread();
      this.tick();
      const origin = isTitle ? this.querySelector('[data-chat-title-edit]') :
        this.querySelector('[data-chat-message="' + CSS.escape(draft.id) + '"] [data-chat-edit]');
      origin?.focus({preventScroll:true});
    };
    cancel.onclick = close;
    form.onkeydown = event => {
      if (event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); form.requestSubmit(); }
    };
    form.onsubmit = event => {
      event.preventDefault();
      if (!field.value.trim()) {field.setCustomValidity(this.t('Enter some text.','请输入文字。'));field.reportValidity();return;}
      if (!this.store(() => isTitle ? saveChatTitle(this.state,this.thread,this.lang,field.value.trim()) :
        saveMessage(this.state,this.thread,this.lang,draft.id,field.value))) return;
      close();
      if (isTitle) document.dispatchEvent(new Event('folio-chat-title'));
    };
    actions.append(cancel,save);
    form.append(field,actions);
    return form;
  }
  pendingBody() {
    return this.pending && this.querySelector('[data-chat-message="' + CSS.escape(this.pending.id) + '"] .chat-body');
  }
  finishPending() {
    const body = this.pendingBody();
    if (body) { body.innerHTML = renderMarkdown(this.pending.text); body.classList.remove('chat-streaming'); }
    this.pending = null;
  }
  tick() {
    clearTimeout(this.timer);
    if (!this.memory || !this.isConnected) return;
    const quiet = this.media.matches;
    const paused = this.memory.paused || Boolean(this.memory.edit);
    const button = this.querySelector('[data-chat-pause]');
    button.hidden = quiet;
    button.disabled = Boolean(this.memory.edit);
    const pauseLabel = this.memory.paused ? this.t('Resume animation','继续动画') : this.t('Pause animation','暂停动画');
    button.title = pauseLabel;
    button.setAttribute('aria-label',pauseLabel);
    button.textContent = this.memory.paused ? '▷' : 'Ⅱ';
    const activity = this.querySelector('[data-chat-activity]');
    const label = activity.querySelector('[data-chat-status]');
    const status = (phase,copy) => {activity.dataset.phase = phase;label.textContent = copy;};
    if (quiet) this.finishPending();
    if (quiet || paused || document.hidden) {
      status(paused ? 'paused' : 'idle', this.memory.edit ? this.t('Editing message','正在编辑') :
        this.memory.paused ? this.t('Paused','已暂停') : this.t('Ready','就绪'));
      return;
    }
    const body = this.pendingBody();
    let delay;
    if (body) {
      if (!this.pending.started) {
        this.pending.started = true;
        body.textContent = '···';
        status('thinking',this.t('Thinking…','正在思考…'));
        delay = 850;
      } else {
        const {text} = this.pending;
        this.pending.shown += Math.max(8, Math.ceil(text.length / 52));
        status('writing',this.t('Writing a reply…','正在撰写回复…'));
        if (this.pending.shown >= text.length) {this.finishPending();delay = 1800;}
        else {
          body.textContent = text.slice(0,this.pending.shown);
          body.classList.add('chat-streaming');
          delay = 75;
        }
      }
    } else {
      const steps = [
        this.t('Thinking…','正在思考…'),this.t('Reading the thread…','正在阅读对话…'),
        this.t('Checking the notes…','正在核对笔记…'),this.t('Organizing the findings…','正在整理要点…')
      ];
      status('thinking',steps[this.activityIndex++ % steps.length]);
      delay = 3600;
    }
    this.timer = setTimeout(() => this.tick(),delay);
  }
}
if (typeof customElements !== 'undefined') customElements.define('folio-chat', FolioChat);
