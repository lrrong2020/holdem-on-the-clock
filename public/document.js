import { renderMarkdown } from './markdown.js';
import { records } from './records.js';

// Personal documents live entirely in this browser. The server-generated seat
// identity, rather than the nickname, separates people who share a browser.
const prefix = 'folio.personal-document.v1.';
export function documentKey(state, index = 0) {
  const owner = state?.roomId && state.me?.id
    ? prefix + encodeURIComponent(state.roomId) + '/' + encodeURIComponent(state.me.id)
    : prefix + 'workspace';
  // The main document keeps its original key for previously saved copies.
  return index ? owner + '/document-' + index : owner;
}

const examples = {
  en: {
    title: 'Cache migration review', meta: 'Platform Engineering / RFC-024',
    owner: 'Owner', team: 'Platform team',
    intro: 'We propose moving production traffic to the new cache cluster. Consistent hashing will reduce hot partitions and provide headroom for the next two quarters.',
    rollout: 'Rollout sequence',
    plan: 'Begin with shadow reads, then shift 5% of traffic to the canary. Increase the allocation only after a full day of stable results.',
    columns: ['Stage', 'Traffic', 'Window'],
    verify: 'Verification',
    check: 'Compare shadow reads against the legacy cluster. Roll back if p99 latency exceeds 220 ms for five minutes, or if the error rate crosses 0.5%.',
    details: [
      '## Traffic comparison and slow requests',
      'For each sampled request, read the same key from both clusters and return the response from the old one. Record the region, client version, hit or miss, and response checksum. Check differences within each region before combining the results.',
      'During the evening peak, pull five of the slowest successful reads from each cluster. Compare time in the cache with time spent fetching from the origin. Keep the trace IDs with the rollout notes so the next shift can inspect the same requests.',
      '## Regional checks',
      '- Check the current traffic share in all three regions before adjusting a route.\n- In each region, compare hit rate, origin retries and p99 latency with the control group over the same 15-minute window.\n- If one region diverges, hold its traffic share and record a trace from an affected request.',
      '## Rollback procedure',
      'When a rollback threshold is reached, stop the rollout and route reads in the affected region back to the old cluster. Leave both clusters running. Record the time of the routing change and the last version served.',
      'Watch the error rate and p99 latency for the next two five-minute windows. Keep the rollout on hold until the on-call engineer can account for the change in both metrics.',
      '## Shift handover',
      'Before signing off, record the traffic share in each region, the last comparison window and the name of the person taking over. Include a link to one slow trace and note which threshold would require a rollback. The incoming engineer confirms the live routing before making the next change.'
    ].join('\n\n')
  },
  zh: {
    title: '缓存迁移评审', meta: '平台工程 / RFC-024', owner: '负责人', team: '平台团队',
    intro: '我们计划将生产流量迁移到新缓存集群。采用一致性哈希可以减少热点分区，并为接下来两个季度预留容量。',
    rollout: '上线顺序',
    plan: '先执行影子读取，再将 5% 的流量切入灰度。观察满一天且运行稳定后，才继续提高流量比例。',
    columns: ['阶段', '流量', '观察期'],
    verify: '验证',
    check: '将影子读取结果与旧集群比对。若 p99 延迟超过 220 毫秒达五分钟，或错误率超过 0.5%，则回滚。',
    details: [
      '## 流量对照与慢请求',
      '对抽样请求，分别从新旧集群读取同一个键，仍用旧集群的结果响应客户端。记录区域、客户端版本、缓存是否命中以及响应校验和。先在每个区域内核对差异，再汇总结果。',
      '晚高峰时，从两个集群各取五条耗时最长的成功请求，分别查看缓存读取和回源耗时。把链路追踪 ID 附在发布记录里，方便下一班工程师复查同一批请求。',
      '## 分区检查清单',
      '- 调整路由前，确认三个区域实际分配到的流量比例。\n- 按区域对比灰度组与对照组在同一段 15 分钟内的命中率、回源重试次数和 p99 延迟。\n- 某个区域出现偏差时，先维持该区域的流量比例，并记录一条受影响的请求链路。',
      '## 回滚步骤',
      '触发回滚条件时，停止放量，将受影响区域的读取流量切回旧集群。两个集群均保持运行，记录切换时间和最后一次对外提供服务的版本。',
      '在接下来的两个五分钟窗口分别检查错误率和 p99 延迟。待值班工程师查明两项指标的变化原因后，再决定何时恢复灰度。',
      '## 值班交接',
      '交班前写明各区域的实际流量比例、最近一次比对的时间段和接班人。附上一条慢请求的追踪链接，并注明回滚阈值。接班人先核对线上路由，再做下一次调整。'
    ].join('\n\n')
  }
};
const stages = [['Canary','5%','24h'], ['Ramp','25–50%','24h'], ['Rollout','100%','48h']];
for (const sample of Object.values(examples)) {
  // Retain the styled layout for older copies where only the title was edited.
  sample.legacyBody = [sample.meta, sample.owner + ' · ' + sample.team, sample.intro,
    sample.rollout, sample.plan, [sample.columns, ...stages].map(row=>row.join('\t')).join('\n'),
    sample.verify, sample.check].join('\n\n');
  const table = [sample.columns, ['---','---','---'], ...stages]
    .map(row=>'| ' + row.join(' | ') + ' |').join('\n');
  sample.shortMarkdown = [sample.meta, sample.owner + ' · **' + sample.team + '**', sample.intro,
    '## ' + sample.rollout, sample.plan, table, '## ' + sample.verify, sample.check].join('\n\n');
  sample.body = sample.shortMarkdown + '\n\n' + sample.details;
}

const documents = records.map((record, index) => {
  if (index === 0) return examples;
  return Object.fromEntries(Object.entries(record).map(([lang, fields]) => {
    const [, title, intro, leftLabel, leftValue, rightLabel, rightValue, conclusion] = fields;
    const table = ['| ' + leftLabel + ' | ' + rightLabel + ' |', '| --- | --- |',
      '| ' + leftValue + ' | ' + rightValue + ' |'].join('\n');
    return [lang,{title, body:[intro, table, conclusion].join('\n\n')}];
  }));
});
function sampleFor(lang, index = 0) { return documents[index][lang === 'zh' ? 'zh' : 'en']; }

export function createDocumentStore(storageProvider) {
  const cache = new Map();
  function readKey(key) {
    if (!cache.has(key)) {
      let value = null;
      try {
        const data = JSON.parse(storageProvider().getItem(key));
        if (data?.sample === true) value = {sample:true};
        else if (typeof data?.title === 'string' && typeof data.body === 'string') {
          value = {title:data.title, body:data.body};
        }
      } catch { /* A storage restriction or invalid record leaves the sample usable. */ }
      cache.set(key,value);
    }
    return cache.get(key);
  }
  function read(state, index = 0) {
    const key = documentKey(state,index);
    const workspace = documentKey(null,index);
    let record = readKey(key);
    if (!record && key !== workspace) {
      // Freeze the starting copy at entry. Another player's template edit on
      // this browser must not change the document in an existing session.
      record = readKey(workspace) || {sample:true};
      try { storageProvider().setItem(key, JSON.stringify(record)); }
      catch { /* Preserve this page's starting copy even when storage is full. */ }
      cache.set(key,record);
    }
    return record?.sample ? null : record;
  }
  function save(state, draft, lang, useAsTemplate = false, index = 0) {
    const sample = sampleFor(lang,index);
    const record = draft.title === sample.title && draft.body === sample.body
      ? {sample:true} : {title:draft.title, body:draft.body};
    const key = documentKey(state,index);
    const workspace = documentKey(null,index);
    storageProvider().setItem(key,JSON.stringify(record));
    cache.set(key, record);
    if (useAsTemplate && key !== workspace) {
      try {
        storageProvider().setItem(workspace,JSON.stringify(record));
        cache.set(workspace,record);
      } catch {
        return {templateSaved:false};
      }
    }
    return {templateSaved:true};
  }
  function invalidate(key) {
    if (key === null) cache.clear();
    else cache.delete(key);
  }
  return {read, save, invalidate};
}

const store = createDocumentStore(() => globalThis.localStorage);
const editors = new WeakMap();
export function preparePersonalDocument(state) {
  if (state?.me?.id) documents.forEach((_, index) => store.read(state,index));
}
export function getDocumentTitle(state, lang='en', index=0) {
  return store.read(state,index)?.title ?? sampleFor(lang,index).title;
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function defaultPaper(paper, sample, title, fullSample) {
  const owner = element('p', sample.owner + ' ', 'gw-doc-owner');
  owner.append(element('strong', sample.team));
  const table = element('table');
  for (const [index, cells] of [sample.columns, ...stages].entries()) {
    const tr = index === 0 ? table.createTHead().insertRow() : table.tBodies[0].insertRow();
    for (const content of cells) tr.append(element(index === 0 ? 'th' : 'td',content));
    if (index === 0) table.createTBody();
  }
  paper.replaceChildren(element('small',sample.meta), element('h1',title), owner,
    element('p',sample.intro), element('h2',sample.rollout), element('p',sample.plan),
    table, element('h2',sample.verify), element('p',sample.check));
  if (fullSample) {
    const details = element('div', undefined, 'folio-markdown');
    details.innerHTML = renderMarkdown(sample.details);
    paper.append(details);
  }
}

function button(action, label, handler) {
  const node = element('button',label,'gw-doc-button');
  node.type = 'button';
  node.dataset.docAction = action;
  node.addEventListener('click', handler);
  return node;
}

function render(editor) {
  const {lang, state, paper, bar, draft, index} = editor;
  const t = (en,zh) => lang === 'zh' ? zh : en;
  const sample = sampleFor(lang,index);
  const saved = store.read(state,index);
  const doc = saved || sample;
  editor.saved = saved;
  bar.replaceChildren();
  if (!draft) {
    const matchingSample = index === 0 && Object.values(examples).find(item=>
      item.body === doc.body || item.shortMarkdown === doc.body || item.legacyBody === doc.body);
    if (matchingSample) defaultPaper(paper,matchingSample,doc.title,doc.body === matchingSample.body);
    else {
      const prose = element('div', undefined, 'gw-custom-prose folio-markdown');
      prose.innerHTML = renderMarkdown(doc.body);
      paper.replaceChildren(element('h1',doc.title), prose);
    }
    if (editor.message) {
      const status = element('span',editor.message,'gw-doc-status');
      status.setAttribute('role','status');
      bar.append(status);
    }
    bar.append(button('edit',t('Edit document','编辑文档'),()=>{
      editor.message = '';
      editor.draft = {title:doc.title, body:doc.body, useAsTemplate:false};
      render(editor);
      paper.querySelector('[name=docTitle]').focus();
    }));
    return;
  }

  const titleLabel = element('label',t('Title','标题'),'gw-doc-field');
  const title = element('input');
  title.name = 'docTitle';
  title.type = 'text';
  title.value = draft.title;
  title.autocomplete = 'off';
  title.spellcheck = false;
  title.required = true;
  titleLabel.append(title);
  const bodyLabel = element('label',t('Body (Markdown)','正文（Markdown）'),'gw-doc-field');
  const body = element('textarea');
  body.name = 'docBody';
  body.value = draft.body;
  body.spellcheck = false;
  body.autocomplete = 'off';
  bodyLabel.append(body);
  const scope = state?.me?.id
    ? t('Saved in this browser for this session.','本场文档保存在当前浏览器。')
    : t('New sessions in this browser use this document.','当前浏览器的新会话使用这份文档。');
  const hint = element('p',scope,'gw-doc-help');
  hint.setAttribute('role','status');
  const options = [];
  if (state?.me?.id) {
    const reuse = element('label',undefined,'gw-doc-template');
    const box = element('input');
    box.type = 'checkbox';
    box.name = 'docTemplate';
    box.checked = draft.useAsTemplate;
    box.onchange = () => { draft.useAsTemplate = box.checked; };
    reuse.append(box, t('Also use for new sessions','也用于新会话'));
    options.push(reuse);
  }
  const actions = element('div',undefined,'gw-doc-actions');
  function closeEditor(message) {
    editor.message = message;
    editor.draft = null;
    render(editor);
    bar.querySelector('button')?.focus({preventScroll:true});
  }
  actions.append(button('reset',t('Load example','载入示例'),()=>{
    // Load the sample as a draft. Cancel still returns to the last saved copy.
    draft.title = title.value = sample.title;
    draft.body = body.value = sample.body;
    title.setCustomValidity('');
    body.focus();
  }),button('cancel',t('Cancel','取消'),()=>closeEditor('')),button('save',t('Save document','保存文档'),()=>{
    if (!title.value.trim()) {
      title.setCustomValidity(t('Enter a title.','请输入文档标题。'));
      title.reportValidity();
      return;
    }
    let result;
    try {
      result = store.save(state, {title:title.value.trim(), body:body.value},lang,draft.useAsTemplate,index);
    } catch {
      hint.textContent = t('Could not save in this browser. Your changes are still here.','当前浏览器无法保存，你仍可在此处修改或复制草稿。');
      return;
    }
    closeEditor(result.templateSaved ? t('Saved on this device','已保存到本机') :
      t('Session copy saved. The browser could not store the template.','本场文档已保存，浏览器未能保存模板。'));
    document.dispatchEvent(new Event('folio-document-saved'));
  }));
  title.oninput = () => { title.setCustomValidity(''); draft.title = title.value; };
  body.oninput = () => { draft.body = body.value; };
  paper.replaceChildren(titleLabel,bodyLabel,...options,hint,actions);
}

// Called after the outer skin is drawn. A normal game poll leaves these DOM
// nodes untouched, including an in-progress input-method composition/selection.
export function syncDocument(root, state, lang='en', index=0) {
  const paper = root.querySelector('.gw-paper');
  const scope = documentKey(state);
  let session = editors.get(root);
  if (session?.scope !== scope) {
    session = {scope, pages:new Map()};
    editors.set(root,session);
  }
  let editor = session.pages.get(index);
  if (!editor) {
    editor = {index, draft:null, message:''};
    session.pages.set(index,editor);
  }
  // A concurrent save in another tab becomes visible after Cancel. It must not
  // interrupt the active tab's typing or take over its explicitly edited copy.
  const sameSurface = editor.paper === paper && editor.lang === lang;
  if (sameSurface && (editor.draft || editor.saved === store.read(state,index))) return;
  editor.state = state;
  editor.lang = lang;
  editor.paper = paper;
  editor.bar = root.querySelector('.gw-doc-buttons');
  if (paper) render(editor);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage',({key})=>{
    if (key !== null && !key.startsWith(prefix)) return;
    store.invalidate(key);
    document.dispatchEvent(new Event('folio-document-saved'));
  });
}
