import { records } from './records.js';

// Each pair occupies the same position in both languages so edits survive a language switch.
const samples = [
  {
    en: [
      'What changed in the latest canary? I need the numbers for the release review.',
      'The new cluster served more reads from cache. In the last 24 hours, p95 fell from **218 ms to 184 ms**.\n\n| Metric | Baseline | Canary |\n| --- | --- | --- |\n| p95 latency | 218 ms | 184 ms |\n| Cache hit rate | 91% | 96% |\n| Error rate | 0.29% | 0.27% |\n\nThe latency target is 200 ms. The canary finished the window 16 ms below it.',
      'Do the cache keys explain the improvement? The old keys occasionally returned the wrong locale.',
      'The new key includes both the locale and the schema version. Shadow reads matched the existing cluster in all three regions. Fewer requests now reach the origin.\n\nI would keep the TTL unchanged for the next observation window. That gives us a cleaner comparison of the key change.',
      'Can we move past 50% traffic today? What would make us roll back?',
      'Keep traffic at **50% for 24 hours** and include the evening peak. Compare upstream retries with the baseline before widening the rollout.\n\n- Roll back if p99 stays above 220 ms for five minutes.\n- Roll back if the error rate exceeds 0.5%.\n- Keep the previous version available until the observation window closes.'
    ],
    zh: [
      '发布评审要用最新一轮灰度数据。这次和基线相比有什么变化？',
      '过去 24 小时，更多请求命中了缓存，p95 延迟从 **218 ms 降到了 184 ms**。\n\n| 指标 | 基线 | 灰度 |\n| --- | --- | --- |\n| p95 延迟 | 218 ms | 184 ms |\n| 缓存命中率 | 91% | 96% |\n| 错误率 | 0.29% | 0.27% |\n\n灰度组的 p95 比 200 ms 的目标低了 16 ms。',
      '旧缓存键偶尔会读到其他语言的内容。换键之后，三个区域的读数一致吗？',
      '新缓存键包含语言和数据格式版本。三个灰度区域都做了影子读取，结果和旧集群一致。命中率上升后，回源请求也减少了。\n\n建议下一轮观察先沿用现有 TTL，这样更容易单独判断换键的效果。',
      '今天能把灰度流量提到 50% 以上吗？出现什么情况需要回滚？',
      '先维持 **50% 流量满 24 小时**，把晚高峰也算进去。确认上游重试次数与基线相近后，再扩大范围。\n\n- p99 连续五分钟高于 220 ms 时回滚。\n- 错误率超过 0.5% 时回滚。\n- 观察期结束前，保留可随时切回的旧版本。'
    ]
  }, {
    en: [
      'What goes into the new cache key? A locale mismatch would be hard to spot in the hit-rate chart.',
      'We now key on the route, locale and schema version. Two clients requesting the same route in different languages get separate entries.\n\nThe hit rate rose from **91% to 96%** after warm-up.',
      'Should we extend the TTL before increasing traffic?',
      'Leave the TTL unchanged for now. Keep shadow reads on in all three regions for 24 hours, then compare response bodies by locale and schema version.'
    ], zh: [
      '新的缓存键包含哪些字段？单看命中率，很难发现返回了错误的语言。',
      '缓存键由路由、语言和数据格式版本组成。同一路由的中英文请求会使用不同条目。\n\n预热结束后，命中率从 **91% 升到了 96%**。',
      '扩大流量前，要把 TTL 调长一点吗？',
      '先沿用现在的 TTL。三个区域都保留影子读取，观察满 24 小时，再按语言和数据格式版本逐项比对响应正文。'
    ]
  }, {
    en: [
      'How much room do we have under the latency budget?',
      'The p95 target is **200 ms** and the current reading is **184 ms**. That leaves 16 ms of headroom. Most peak-hour spikes coincide with cache misses.',
      'Which traces should I pull for the next review?',
      'Pick requests for the same route during the evening peak. Compare one cache hit with one miss, then break the miss into origin connection time and upstream processing time.'
    ], zh: [
      '按现在的读数，距离延迟上限还有多少余量？',
      'p95 目标是 **200 ms**，当前为 **184 ms**，还剩 16 ms。高峰期的延迟尖峰大多和缓存未命中同时出现。',
      '下次评审该选哪些请求追踪记录？',
      '从晚高峰同一路由中各选一条缓存命中和未命中的记录。对未命中的请求，再分开看回源连接耗时和上游处理耗时。'
    ]
  }, {
    en: [
      'How is the 50% cohort holding up?',
      'The canary is serving **50% of traffic**. Its error rate is **0.27%**, compared with 0.29% on the baseline. We still need a full peak period before expanding.',
      'Which checks should be in the handover?',
      'Record the error rate and upstream retry count by region. Keep the allocation at 50% until all three regions have been observed through the evening peak.'
    ], zh: [
      '50% 流量的灰度组目前表现怎么样？',
      '灰度组承接了 **50% 的流量**，错误率为 **0.27%**，基线是 0.29%。放量前，还需要完整观察一次高峰。',
      '交接给晚班同事时，要他们重点看什么？',
      '请按区域记录错误率和上游重试次数。三个区域都过完晚高峰之前，维持 50% 流量。'
    ]
  }, {
    en: [
      'Will the cache response change break older API clients?',
      'The platform team replayed existing clients against the new response. Required fields and their types are unchanged. Clients can continue using the current schema.',
      'What should be ready before the deployment?',
      'Keep the previous release available through the observation window. Set an alert for **p99 above 220 ms for five minutes** and verify that the on-call engineer can switch traffic back.'
    ], zh: [
      '这次缓存响应的改动会影响老版本 API 客户端吗？',
      '平台组用旧客户端回放了请求。必填字段和字段类型沿用旧格式，现有客户端可以继续使用当前数据格式。',
      '上线前还要准备哪些回滚措施？',
      '观察期内保留上一版本。为 **p99 连续五分钟超过 220 ms** 设置告警，并和值班同事确认切回旧版本的操作。'
    ]
  }
];

export function chatKey(state) {
  const scope = state?.roomId && state.me?.id
    ? 'room/' + encodeURIComponent(state.roomId) + '/' + encodeURIComponent(state.me.id) : 'workspace';
  return 'folio.chat.v1/' + scope + '/';
}

function defaults(thread, lang) {
  return samples[thread][lang === 'zh' ? 'zh' : 'en'].map((text, i) => ({
    id:'sample-' + (i + 1), role:i % 2 ? 'assistant' : 'user', text
  }));
}

const commonWords = new Set(('a an the is are was were and or to of about in on for with what how can could do does did ' +
  'has have this that me my you we it our tell please review again much many from any would should ' +
  '什么 怎么 如何 能不能 能否 能 可以 这个 那个 我们 请问 多少 帮我 有哪些 目前 当前').split(/\s+/));
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh', {granularity:'word'}) : null;
function terms(text) {
  const normalized = text.normalize('NFKC').toLowerCase();
  const parts = segmenter
    ? [...segmenter.segment(normalized)].filter(p => p.isWordLike).map(p => p.segment)
    : (normalized.match(/[a-z0-9]+|[\u3400-\u9fff]+/g) || []).flatMap(word =>
      /^[\u3400-\u9fff]/.test(word) ? [...word].slice(1).map((_, i) => word.slice(i, i + 2)) : [word]);
  return new Set(parts.filter(word => word.length > 1 && !commonWords.has(word)));
}

function excerpts(text) {
  return text.split('\n').flatMap(raw => {
    const line = raw.trim().replace(/^\s*(?:#+\s+|>\s*|[-*]\s+|\d+\.\s+)/, '');
    if (!line || line.startsWith('```') || /^\|?[\s:|-]+\|?$/.test(line)) return [];
    if (line.startsWith('|')) return [line.split('|').map(s=>s.trim()).filter(Boolean).join(' · ')];
    return line.replace(/([。！？])|([.!?])\s+/g, '$1$2\n').split('\n').filter(Boolean);
  });
}

function localReply(messages, question, lang, customized) {
  const zh = lang === 'zh';
  const query = terms(question);
  const asksForNumber = /how (?:much|many)|range|rate|number|target|预算|目标|多少|几[天地个组人]|比例|率/i.test(question);
  // If someone has replaced the sample, work from their notes before quoting any examples.
  const edited = messages.filter(m => customized.has(m.id));
  const source = edited.length ? edited : messages.filter(m => m.role === 'assistant' && m.id.startsWith('sample-'));
  const notes = messages.filter(m => m.role === 'user' && !m.id.startsWith('sample-') && !customized.has(m.id) &&
    m.text.length > 10 && !/(?:[?？]\s*$|^(?:what|why|how|when|can|which|where)\b|为什么|怎么|什么|多少)/i.test(m.text));
  source.push(...notes);
  let excerpt = '', best = 0;
  for (const message of source.slice().reverse()) {
    for (const line of excerpts(message.text)) {
      if (/[?？]\s*$/.test(line)) continue;
      const words = terms(line);
      let score = 0;
      for (const term of query) if (words.has(term)) score += term.length > 3 ? 2 : 1;
      if (score && asksForNumber && /\d/.test(line)) score += 0.5;
      if (score > best) {
        best = score;
        excerpt = line;
      }
    }
  }
  if (!excerpt && /summari[sz]e|summary|recap|概括|总结|摘要/i.test(question)) {
    excerpt = source.flatMap(m=>excerpts(m.text)).find(line=>!/[?？]\s*$/.test(line));
  }
  if (!excerpt) return zh ? '你想核对哪一项？给我一个关键词，我可以从这段对话里找出相关记录。'
    : 'Which detail would you like to check? Give me a keyword and I can look it up in this conversation.';
  const plain = excerpt.replace(/\*\*|__/g,'').trim();
  const quote = plain.length > 240 ? plain.slice(0,237) + '…' : plain;
  return (zh ? '这段对话里的记录是' : 'Here’s the relevant note from this conversation') + '\n\n> ' + quote;
}

const workspace = chatKey(null);
function entries(storage, scope, prefix = '') {
  const rows = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(scope + prefix) && /^[0-4]\//.test(key.slice(scope.length))) {
      rows[key.slice(scope.length)] = storage.getItem(key);
    }
  }
  return rows;
}
function parse(value, fallback = null) {
  try { return value === null || value === undefined ? fallback : JSON.parse(value); }
  catch { return fallback; }
}

export function createChatStore(storageProvider) {
  // Only the initial room snapshot is immutable. Each subsequent edit is its own key,
  // so two tabs editing different messages never overwrite each other's changes.
  const seedCache = new Map();
  function seed(storage, scope, saving) {
    if (scope === workspace) return {};
    const raw = storage.getItem(scope + 'seed');
    const cached = seedCache.get(scope);
    if (raw !== null) {
      if (cached?.raw === raw) return cached.rows;
      const rows = parse(raw, {}) || {};
      seedCache.set(scope, {raw, rows});
      return rows;
    }
    const rows = cached?.raw === null ? cached.rows : entries(storage, workspace);
    const json = JSON.stringify(rows);
    try {
      storage.setItem(scope + 'seed', json);
      seedCache.set(scope, {raw:json, rows});
    } catch (error) {
      if (saving) throw error;
      seedCache.set(scope, {raw:null, rows});
    }
    return rows;
  }
  function prepareChatContent(state) {
    if (chatKey(state) === workspace) return;
    try { seed(storageProvider(), chatKey(state), false); }
    catch { /* The default conversation remains readable when storage is blocked. */ }
  }
  function read(state, thread, lang, saving = false) {
    const scope = chatKey(state);
    const prefix = thread + '/';
    let rows = {};
    try {
      const storage = storageProvider();
      rows = {...seed(storage, scope, saving), ...entries(storage, scope, prefix)};
    } catch (error) {
      if (saving) throw error;
    }
    const messages = defaults(thread, lang);
    for (const key of Object.keys(rows).filter(k => k.startsWith(prefix + 'exchange/')).sort()) {
      const pair = parse(rows[key]);
      if (typeof pair?.question !== 'string' || typeof pair?.reply !== 'string') continue;
      const suffix = key.slice((prefix + 'exchange/').length);
      messages.push({id:'user-' + suffix,role:'user',text:pair.question},
        {id:'assistant-' + suffix,role:'assistant',text:pair.reply});
    }
    const customized = new Set();
    for (const message of messages) {
      const override = parse(rows[prefix + 'edit/' + message.id]);
      if (typeof override === 'string') {
        message.text = override;
        customized.add(message.id);
      }
    }
    return {messages, customized};
  }
  function getMessages(state, thread, lang) { return read(state, thread, lang).messages; }
  function saveMessage(state, thread, lang, id, text) {
    const {messages} = read(state, thread, lang, true);
    const message = messages.find(m => m.id === id);
    if (!message || typeof text !== 'string') throw Error('Invalid message.');
    const sample = defaults(thread, lang).find(m=>m.id === id);
    storageProvider().setItem(chatKey(state) + thread + '/edit/' + id, JSON.stringify(text === sample?.text ? null : text));
    return {...message, text};
  }
  function appendExchange(state, thread, lang, question) {
    if (typeof question !== 'string' || !question.trim()) throw Error('Enter a message.');
    const {messages, customized} = read(state, thread, lang, true);
    const reply = localReply(messages, question, lang, customized);
    // The timestamp sorts on reload; the random part also separates simultaneous tab writes.
    const last = messages.at(-1).id.match(/^assistant-(\d+)-/);
    const time = Math.max(Date.now(), last ? Number(last[1]) + 1 : 0);
    const id = time + '-' + [...crypto.getRandomValues(new Uint32Array(3))].map(n=>n.toString(36)).join('-');
    storageProvider().setItem(chatKey(state) + thread + '/exchange/' + id, JSON.stringify({question, reply}));
    return {user:{id:'user-' + id,role:'user',text:question},assistant:{id:'assistant-' + id,role:'assistant',text:reply}};
  }
  function getChatTitle(state, thread, lang) {
    const scope = chatKey(state);
    const key = thread + '/title';
    try {
      const storage = storageProvider();
      const start = seed(storage, scope, false);
      const value = parse(storage.getItem(scope + key) ?? start[key]);
      if (typeof value === 'string') return value;
    } catch { /* Use the localized default. */ }
    return records[thread][lang === 'zh' ? 'zh' : 'en'][0];
  }
  function saveChatTitle(state, thread, lang, title) {
    if (typeof title !== 'string' || !title.trim()) throw Error('Enter a conversation title.');
    const scope = chatKey(state), storage = storageProvider();
    seed(storage, scope, true);
    const sample = records[thread][lang === 'zh' ? 'zh' : 'en'][0];
    const text = title.trim();
    storage.setItem(scope + thread + '/title', JSON.stringify(text === sample ? null : text));
    return text;
  }
  return {getMessages, saveMessage, appendExchange, getChatTitle, saveChatTitle, prepareChatContent};
}

export const {getMessages, saveMessage, appendExchange, getChatTitle, saveChatTitle, prepareChatContent} =
  createChatStore(() => globalThis.localStorage);
