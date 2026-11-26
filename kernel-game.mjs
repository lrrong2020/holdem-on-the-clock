// The checkpoint's game tree uses half-BB chips. The live engine counts tenths of a BB.
import { legalActions } from './engine.mjs';

const CHIP = 5;

export function kernelMoves(hand, id) {
  const legal = legalActions(hand, id);
  if (!legal) return [];
  const moves = legal.check ? [] : [{label:'fold', type:'fold'}];
  moves.push({label:'call', type:legal.check ? 'check' : 'call'});

  const wagers = hand.events.filter(e => e.street === hand.street && (e.type === 'bet' || e.type === 'raise'));
  if (!legal.raise || wagers.length >= 2) return moves;

  const pot = hand.players.reduce((sum, player) => sum + player.committed, 0);
  const calledPot = pot + legal.callAmount;
  const halfPot = Math.ceil(calledPot / (2 * CHIP)) * CHIP;
  const type = legal.currentTo === 0 ? 'bet' : 'raise';
  let previous = legal.currentTo;
  for (const [label, increment] of [['half',halfPot],['pot',calledPot]]) {
    const amount = Math.max(legal.minTo, legal.currentTo + increment);
    if (amount > previous && amount < legal.maxTo) {
      moves.push({label,type,amount});
      previous = amount;
    }
  }
  moves.push({label:'allin',type,amount:legal.maxTo});
  return moves;
}
