import {summarizeHistoryHand} from './hand-summary.js';
import {bb, escapeText, eventText, handRanks, netChips, renderCards, streetText, tFor} from './poker-format.js';

function netDirection(amount) {
  return amount > 0 ? 'gain' : amount < 0 ? 'loss' : 'even';
}

// Stack differences capture side pots, split pots and refunds, including when a player
// receives chips at settlement but finishes the hand with a net loss.
function historyOverview(hand, viewer, t) {
  const {pot, net} = summarizeHistoryHand(hand, viewer?.id);
  const refunds = hand.pools.reduce((sum, pool) => sum + (pool.refund ? pool.amount : 0), 0);
  const fold = viewer && hand.events.find(event => event.type === 'fold' && event.id === viewer.id);
  let result = '';
  if (!viewer) result = t('Did not play', '未参局');
  else if (fold) result = streetText(fold.street, t) + ' · ' + t('Folded', '弃牌');
  else if (hand.showdown) result = viewer.rank ? escapeText(t(viewer.rank, handRanks[viewer.rank] || viewer.rank)) : t('Showdown', '摊牌');
  else result = t('Won without showdown', '对手弃牌，你赢得底池');
  if (net === 0) result = t('Break even', '持平') + ' · ' + result;

  const board = hand.board?.length
    ? renderCards(hand.board, t)
    : t('Ended preflop', '翻牌前结束');
  return `<header class="hh-heading"><h3>${t('Hand', '手牌')} #${Number(hand.number)}</h3><small>${hand.players.length} ${t('seats', '席')} · ${hand.showdown ? t('Showdown', '摊牌') : t('No showdown', '未摊牌')}</small></header>
    <dl class="hh-overview">
      <div><dt>${t('Your hole cards', '你的底牌')}</dt><dd>${renderCards(viewer?.cards, t)}${viewer ? '<small class="hh-subline">' + escapeText(viewer.position) + '</small>' : ''}</dd></div>
      <div><dt>${t('Your net', '你的净盈亏')}</dt><dd data-history-net="${net === null ? '' : bb(net)}" class="hh-${netDirection(net)}">${net === null ? '—' : netChips(net) + ' <small>BB</small>'}<small class="hh-subline">${result}</small></dd></div>
      <div><dt>${t('Final pot', '最终底池')}</dt><dd data-history-pot="${bb(pot)}">${bb(pot)} <small>BB</small>${refunds ? '<small class="hh-subline">' + t('Uncalled bet returned', '退回未跟注部分') + ' ' + bb(refunds) + ' BB</small>' : ''}</dd></div>
    </dl>
    <div class="hh-board"><span>${t('Board', '公共牌')}</span><b>${board}</b></div>`;
}

function historyPools(pools, byId, t) {
  let potCount = 0;
  const rows = pools.map(pool => {
    let label = t('Uncalled bet returned', '退回未跟注部分');
    if (!pool.refund) {
      label = potCount ? t('Side pot', '边池') + ' ' + potCount : t('Main pot', '主池');
      potCount++;
    }
    const awards = pool.shares.map(share => {
      const player = byId.get(share.id);
      return `<span>${escapeText(player?.name)} <b>${bb(share.amount)} BB</b></span>`;
    });
    return `<div class="hh-pool"><div><strong>${label}</strong>${awards.length > 1 ? '<small>' + t('Split', '平分') + '</small>' : ''}</div><div class="hh-recipients">${awards.join(' · ')}</div></div>`;
  });
  if (!rows.length) return '';
  return `<section class="hh-pools"><h4>${t('Payouts', '底池分配')}</h4>${rows.join('')}</section>`;
}

function historyStreets(hand, byId, viewerId, t) {
  const stacks = new Map(hand.players.map(p => [p.id, p.startStack]));
  let pot = 0;
  const streets = [];
  for (const street of ['preflop', 'flop', 'turn', 'river']) {
    const events = hand.events.filter(event => event.street === street);
    if (!events.length) continue;
    const startPot = pot;
    const rows = [];
    let dealt = [];
    for (const event of events) {
      if (event.type === 'board') {
        dealt = event.cards;
        continue;
      }
      const player = byId.get(event.id);
      if (!player) continue;
      const paid = event.amount || 0;
      const stack = stacks.get(player.id) - paid;
      pot += paid;
      stacks.set(player.id, stack);
      const action = eventText(event, t) + (paid ? ' BB' : '');
      const paidNote = event.type === 'raise' && event.to !== paid ? '<small>' + t('added', '本次投入') + ' ' + bb(paid) + ' BB</small>' : '';
      const allIn = paid > 0 && stack === 0 ? '<small>' + t('All-in', '全下') + '</small>' : '';
      rows.push(`<li${player.id === viewerId ? ' class="hh-self"' : ''}><span class="hh-action-player"><small>${escapeText(player.position)}</small>${escapeText(player.name)}</span><span class="hh-action">${action}${paidNote}${allIn}</span></li>`);
    }
    streets.push(`<details class="hh-street" data-history-street="${street}" open><summary><b>${streetText(street, t)}</b><span class="hh-dealt">${dealt.length ? renderCards(dealt, t) : ''}</span><small>${t('Starting pot', '本轮开始时的底池')} ${bb(startPot)} BB</small></summary>
      ${rows.length ? '<ol>' + rows.join('') + '</ol>' : '<p>' + t('No betting on this street.', '本轮无需行动。') + '</p>'}</details>`);
  }
  return `<section class="hh-streets"><h4>${t('Action by street', '行动记录')}</h4>${streets.join('')}</section>`;
}

function historySeats(hand, viewerId, t) {
  const rows = hand.players.map(player => {
    const net = player.stack - player.startStack;
    const name = escapeText(player.name);
    const cards = renderCards(player.cards, t); // Uses the authorized hand view for this reader.
    const rank = player.rank && player.cards?.length ? t(player.rank, handRanks[player.rank] || player.rank) : '';
    return `<tr${player.id === viewerId ? ' class="hh-self"' : ''}>
      <td><small>${escapeText(player.position || player.seat)}</small>${name}${player.id === viewerId ? ' <small>' + t('(you)', '（你）') + '</small>' : ''}</td>
      <td>${cards}${rank ? '<small class="hh-rank">' + escapeText(rank) + '</small>' : ''}</td>
      <td>${bb(player.startStack)} → ${bb(player.stack)}</td><td class="hh-${netDirection(net)}">${netChips(net)}</td></tr>`;
  });
  return `<section class="hh-seats"><h4>${t('Player results', '玩家盈亏')} <small>BB</small></h4><table>
    <thead><tr><th>${t('Seat / player', '位置 / 玩家')}</th><th>${t('Hole cards', '底牌')}</th><th>${t('Stack before → after', '起始筹码 → 结束筹码')}</th><th>${t('Net', '净盈亏')}</th></tr></thead><tbody>${rows.join('')}</tbody></table></section>`;
}

export function renderHistory(container, hand, {lang = 'en', viewerId} = {}) {
  const t = tFor(lang);
  if (!hand) {
    container.textContent = t('No completed hands yet.', '暂无牌谱。');
    return;
  }
  const byId = new Map(hand.players.map(player => [player.id, player]));
  container.innerHTML = `<article class="gw-history">
    ${historyOverview(hand, byId.get(viewerId), t)}
    ${historyPools(hand.pools, byId, t)}
    ${historyStreets(hand, byId, viewerId, t)}
    ${historySeats(hand, viewerId, t)}
  </article>`;
}
