// Use the same figures in the picker and the replay. Monetary values are in
// tenths of a BB. Only the viewer's own hole cards belong in this projection.
export function summarizeHistoryHand(hand, viewerId) {
  const seat = hand.players.find(player => player.id === viewerId);
  const pot = hand.pools.reduce((awarded, pool) => awarded + (pool.refund ? 0 : pool.amount), 0);
  return {
    number: hand.number,
    cards: seat ? [...seat.cards] : [],
    played: Boolean(seat),
    pot,
    net: seat ? seat.stack - seat.startStack : null,
    showdown: hand.showdown
  };
}
