export const records = [
  { en: ['Release readiness'], zh: ['发布就绪评审'] },
  {
    en: [
      'Cache tuning',
      'Cache key review',
      'Cache keys now include the locale and schema version. Shadow reads have stayed consistent across all three canary regions.',
      'Hit rate',
      '91% → 96%',
      'Rollout gate',
      '24 hours of stable reads',
      'Keep the current TTL until the migration review is complete.'
    ],
    zh: [
      '缓存调优',
      '缓存键评审',
      '缓存键包含语言区域和数据格式版本。三个灰度区域的影子读结果一致。',
      '命中率',
      '91% → 96%',
      '放量条件',
      '读取稳定满 24 小时',
      '迁移评审结束前沿用当前 TTL。'
    ]
  },
  {
    en: [
      'Latency budget',
      'Tail latency budget',
      'The serving path is within budget. Cache misses account for most of the remaining variation during peak traffic.',
      'p95 target',
      '200 ms',
      'Current p95',
      '184 ms',
      'Compare peak-hour traces with the baseline before increasing traffic.'
    ],
    zh: [
      '延迟预算',
      '尾部延迟预算',
      '请求延迟在预算内。高峰期的延迟波动主要来自缓存未命中。',
      'p95 目标',
      '200 ms',
      '当前 p95',
      '184 ms',
      '放量前，将高峰期的请求追踪数据与基线对比。'
    ]
  },
  {
    en: [
      'Canary analysis',
      'Canary observation window',
      'The 50% cohort is holding steady. Retry volume and error rate are the final checks before widening the rollout.',
      'Current traffic',
      '50%',
      'Error rate',
      '0.27%',
      'Review one full traffic cycle before moving to the next cohort.'
    ],
    zh: [
      '灰度分析',
      '灰度观察窗口',
      '灰度流量已达 50%，运行稳定。下一次放量前，再核对重试次数和错误率。',
      '当前流量',
      '50%',
      '错误率',
      '0.27%',
      '观察一个完整流量周期后再扩大范围。'
    ]
  },
  {
    en: [
      'API rollout',
      'API rollout checklist',
      'The platform team has verified backward compatibility for the new cache responses. Existing clients can continue to use the current schema.',
      'Deploy group',
      'Platform',
      'Rollback threshold',
      '220 ms',
      'Keep the previous version available during the observation window.'
    ],
    zh: [
      'API 发布',
      'API 发布清单',
      '平台团队已确认新缓存的响应格式向后兼容。现有客户端可以继续使用原有数据格式。',
      '发布团队',
      '平台组',
      '回滚阈值',
      '220 ms',
      '观察期内保留上一版本。'
    ]
  }
];
export function showRecord(root, index, lang, back) {
  const data = records[index][lang],
    en = lang === 'en';
  if (root.firstElementChild?.dataset.recordPage === index + lang) return;
  root.innerHTML =
    '<article class="record" data-record-page="' +
    index +
    lang +
    '"><h1>' +
    data[1] +
    '</h1><p>' +
    data[2] +
    '</p><table><tbody><tr><th>' +
    data[3] +
    '</th><td>' +
    data[4] +
    '</td></tr><tr><th>' +
    data[5] +
    '</th><td>' +
    data[6] +
    '</td></tr></tbody></table><p>' +
    data[7] +
    '</p><button class="outline-btn">' +
    (en ? 'Return to release readiness' : '回到发布评审') +
    '</button></article>';
  root.querySelector('button').onclick = back;
}
