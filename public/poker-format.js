export const escapeText = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[ch]);
export const bb = value => Number.isFinite(value) ? String(value / 10) : '—';
export const tFor = lang => (en, zh) => lang === 'zh' ? zh : en;

export function renderCards(list, t) {
  if (!list?.length) return '<span class="gw-dash">—</span>';
  const suits = {s:t('spades','黑桃'), h:t('hearts','红桃'), c:t('clubs','梅花'), d:t('diamonds','方块')};
  return list.map(card => {
    const rank = card.slice(0,-1).replace(/^T$/,'10');
    const suit = card.slice(-1);
    return `<span class="gw-card gw-suit-${escapeText(suit)}" aria-label="${escapeText(rank + ' ' + suits[suit])}">${escapeText(rank)}<sup>${escapeText(suit)}</sup></span>`;
  }).join(' ');
}
const streetNames = {preflop:['Preflop','翻牌前'],flop:['Flop','翻牌圈'],turn:['Turn','转牌圈'],river:['River','河牌圈'],complete:['Complete','已结算']};
export const streetText = (street, t) => streetNames[street] ? t(...streetNames[street]) : escapeText(street);
const actNames = {sb:['Small blind','小盲注'],bb:['Big blind','大盲注'],smallBlind:['Small blind','小盲注'],bigBlind:['Big blind','大盲注'],check:['Check','过牌'],call:['Call','跟注'],fold:['Fold','弃牌'],bet:['Bet','下注'],raise:['Raise to','加注至'],refund:['Refund','退回'],award:['Won','赢得'],board:['Board','公共牌'],showdown:['Showdown','摊牌']};
export function eventText(event, t) {
  const label = actNames[event.type] ? t(...actNames[event.type]) : escapeText(event.type);
  const amount = event.type === 'raise' || event.type === 'bet' ? event.to ?? event.amount : event.amount;
  return `${label}${amount > 0 ? ' ' + bb(amount) : ''}`;
}

export const handRanks = {
  'high card':'高牌','one pair':'一对','two pair':'两对','three of a kind':'三条',
  straight:'顺子',flush:'同花','full house':'葫芦','four of a kind':'四条','straight flush':'同花顺'
};

export function netChips(amount) {
  return (amount > 0 ? '+' : '') + bb(amount);
}
