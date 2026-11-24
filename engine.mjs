import { randomInt } from 'node:crypto';

export const SMALL_BLIND = 5;
export const BIG_BLIND = 10;
const ranks = '23456789TJQKA';
const streets = ['preflop', 'flop', 'turn', 'river'];
const categories = ['high card', 'one pair', 'two pair', 'three of a kind', 'straight', 'flush', 'full house', 'four of a kind', 'straight flush'];
const deckTemplate = [...'shdc'].flatMap(suit => [...ranks].map(rank => rank + suit));

function shuffledDeck() {
  const cards = [...deckTemplate];
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

// Encode category and up to five kickers as six base-15 digits. Scores sort numerically.
function rankFive(cards) {
  const counts = new Map();
  for (const card of cards) {
    const value = ranks.indexOf(card[0]) + 2;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const values = [...counts.keys()].sort((a, b) => b - a);
  const groups = [...values].sort((a, b) => counts.get(b) - counts.get(a) || b - a);
  const [first, second] = groups;
  const flush = cards.every(card => card[1] === cards[0][1]);
  let straight = 0;
  if (values.length === 5) {
    if (values[0] - values[4] === 4) straight = values[0];
    else if (values.join() === '14,5,4,3,2') straight = 5;
  }
  let category;
  let kickers = groups;
  if (straight && flush) { category = 8; kickers = [straight]; }
  else if (counts.get(first) === 4) category = 7;
  else if (counts.get(first) === 3 && counts.get(second) === 2) category = 6;
  else if (flush) category = 5;
  else if (straight) { category = 4; kickers = [straight]; }
  else if (counts.get(first) === 3) category = 3;
  else if (counts.get(first) === 2 && counts.get(second) === 2) category = 2;
  else if (counts.get(first) === 2) category = 1;
  else category = 0;
  let score = category;
  for (let i = 0; i < 5; i++) score = score * 15 + (kickers[i] ?? 0);
  return score;
}

export function bestScore(cards) {
  if (cards.length < 5 || cards.length > 7 || new Set(cards).size !== cards.length ||
      cards.some(card => !deckTemplate.includes(card))) throw new Error('Invalid cards');
  let best = -1;
  for (let a = 0; a < cards.length - 4; a++)
    for (let b = a + 1; b < cards.length - 3; b++)
      for (let c = b + 1; c < cards.length - 2; c++)
        for (let d = c + 1; d < cards.length - 1; d++)
          for (let e = d + 1; e < cards.length; e++)
            best = Math.max(best, rankFive([cards[a], cards[b], cards[c], cards[d], cards[e]]));
  return best;
}

function clockwise(players, afterSeat) {
  return [...players.filter(p => p.seat > afterSeat), ...players.filter(p => p.seat <= afterSeat)];
}

function log(hand, type, details = {}) {
  hand.events.push({street: hand.street, type, at: Date.now(), ...details});
}

function pay(player, amount) {
  player.stack -= amount;
  player.streetBet += amount;
  player.committed += amount;
  player.allIn = player.stack === 0;
}

function postBlind(hand, player, amount, type) {
  const actual = Math.min(player.stack, amount);
  pay(player, actual);
  log(hand, type, {id: player.id, amount: actual, to: player.streetBet});
}

// All chips are represented as integer tenths of a big blind, including public views.
export function startHand(entries, {number = 1, previousButton = null, previousBigBlindId = null, deck} = {}) {
  if (!Array.isArray(entries) || entries.length < 2 || entries.length > 9 ||
      entries.some(p => !p.id || !Number.isInteger(p.seat) || p.seat < 1 || p.seat > 9 ||
        !Number.isSafeInteger(p.stack) || p.stack <= 0) ||
      !Number.isSafeInteger(entries.reduce((sum, p) => sum + p.stack, 0)) ||
      new Set(entries.map(p => p.id)).size !== entries.length ||
      new Set(entries.map(p => p.seat)).size !== entries.length) throw new Error('Invalid seats or stacks');
  if (deck && (deck.length !== 52 || new Set(deck).size !== 52 || deck.some(c => !deckTemplate.includes(c)))) {
    throw new Error('Invalid deck');
  }
  const players = entries.map(({id, seat, name, stack}) => ({
    id, seat, name, stack, startStack: stack, streetBet: 0, committed: 0, paid: 0,
    cards: [], folded: false, allIn: false, actedTo: null, position: '', rank: null,
  })).sort((a, b) => a.seat - b.seat);
  const headsUp = players.length === 2;
  // On transition to heads-up the former big blind takes the button if still seated.
  const previousBB = headsUp ? players.find(p => p.id === previousBigBlindId) : null;
  const dealer = previousBB ?? clockwise(players, previousButton ?? 0)[0];
  const order = clockwise(players, dealer.seat);
  const sb = headsUp ? dealer : order[0];
  const bb = headsUp ? order[0] : order[1];
  const positions = ['UTG','UTG+1','MP','LJ','HJ','CO'];
  const others = order.slice(2, -1);
  others.forEach((p, i) => {
    p.position = (i === 0 && others.length > 1) ? 'UTG' : positions[positions.length - others.length + i];
  });
  dealer.position = headsUp ? 'BTN/SB' : 'BTN';
  if (!headsUp) sb.position = 'SB';
  bb.position = 'BB';
  const hand = {number, button: dealer.seat, actorId: null, street: 'preflop', board: [], players,
    currentTo: BIG_BLIND, minRaise: BIG_BLIND, deck: deck ? [...deck] : shuffledDeck(),
    events: [], pools: [], showdown: false};
  for (let i = 0; i < 2; i++) for (const p of order) p.cards.push(hand.deck.shift());
  postBlind(hand, sb, SMALL_BLIND, 'sb');
  postBlind(hand, bb, BIG_BLIND, 'bb');
  advance(hand, bb.seat);
  return hand;
}

function dealStreet(hand) {
  hand.street = streets[streets.indexOf(hand.street) + 1];
  hand.deck.shift(); // burn
  const cards = hand.deck.splice(0, hand.street === 'flop' ? 3 : 1);
  hand.board.push(...cards);
  log(hand, 'board', {cards});
  for (const p of hand.players) {
    p.streetBet = 0;
    p.actedTo = null;
  }
  hand.currentTo = 0;
  hand.minRaise = BIG_BLIND;
}

function roundPosition(live, price, afterSeat) {
  const available = live.filter(p => !p.allIn);
  // With one stack left, match the live all-in price; no bets into a dry side pot.
  const currentTo = available.length === 1 ? Math.max(...live.map(p => p.streetBet)) : price;
  const needsAction = p => p.streetBet < currentTo || (available.length > 1 && p.actedTo === null);
  return {currentTo, actor:clockwise(available, afterSeat).find(needsAction)};
}

function advance(hand, afterSeat) {
  const live = hand.players.filter(p => !p.folded);
  if (live.length === 1) return settle(hand);
  const {currentTo,actor} = roundPosition(live, hand.currentTo, afterSeat);
  hand.currentTo = currentTo;
  if (actor) {
    hand.actorId = actor.id;
    return;
  }
  if (hand.street === 'river') return settle(hand);
  dealStreet(hand);
  advance(hand, hand.button);
}

export function legalActions(hand, id) {
  if (!id || hand.actorId !== id || hand.street === 'complete') return null;
  const p = hand.players.find(player => player.id === id);
  const due = Math.max(0, hand.currentTo - p.streetBet);
  const maxTo = p.streetBet + p.stack;
  const minTo = Math.min(maxTo, hand.currentTo + hand.minRaise);
  const reopened = p.actedTo === null || hand.currentTo - p.actedTo >= hand.minRaise;
  const opponentCanPlay = hand.players.some(other => other !== p && !other.folded && !other.allIn);
  return {check: due === 0, fold: true, call: due > 0, callAmount: Math.min(p.stack, due),
    raise: reopened && opponentCanPlay && maxTo > hand.currentTo,
    minTo, maxTo, currentTo: hand.currentTo};
}

export function act(hand, id, action) {
  const legal = legalActions(hand, id);
  if (!legal) throw new Error('Not your turn');
  const player = hand.players.find(p => p.id === id);
  const type = action?.type;
  if (type === 'fold') {
    player.folded = true;
    log(hand, type, {id});
  } else if (type === 'check' && legal.check) {
    log(hand, type, {id});
  } else if (type === 'call' && legal.call) {
    pay(player, legal.callAmount);
    log(hand, type, {id, amount: legal.callAmount, to: player.streetBet});
  } else if (type === (hand.currentTo === 0 ? 'bet' : 'raise') && legal.raise) {
    const target = action.amount;
    if (!Number.isSafeInteger(target) || target < legal.minTo || target > legal.maxTo) throw new Error('Invalid target');
    const increment = target - hand.currentTo;
    hand.minRaise = Math.max(increment, hand.minRaise);
    hand.currentTo = target;
    const amount = target - player.streetBet;
    pay(player, amount);
    log(hand, type, {id, amount, to: target});
  } else throw new Error('Illegal action');
  player.actedTo = hand.currentTo;
  advance(hand, player.seat);
  return hand;
}

// A departing player gives up their live hand. An all-in has no decisions left and runs out.
export function forceFold(hand, id) {
  if (!hand || hand.street === 'complete') return;
  const player = hand.players.find(p => p.id === id);
  if (!player || player.folded || player.allIn) return;
  if (hand.actorId === id) return act(hand, id, {type: 'fold'});
  const current = hand.players.find(p => p.id === hand.actorId);
  player.folded = true;
  log(hand, 'fold', {id});
  advance(hand, current.seat - 1);
}

function settle(hand) {
  const live = hand.players.filter(p => !p.folded);
  hand.showdown = live.length > 1;
  const scores = new Map();
  if (hand.showdown) {
    for (const p of live) {
      const score = bestScore([...p.cards, ...hand.board]);
      scores.set(p.id, score);
      p.rank = categories[Math.floor(score / (15 ** 5))];
    }
  }
  const levels = [...new Set(hand.players.map(p => p.committed))].filter(Boolean).sort((a, b) => a - b);
  let lower = 0;
  for (const level of levels) {
    const contributors = hand.players.filter(p => p.committed >= level);
    const amount = (level - lower) * contributors.length;
    lower = level;
    const refund = contributors.length === 1;
    let eligible = refund ? contributors : contributors.filter(p => !p.folded);
    if (!eligible.length) {
      // Out-of-turn departures can leave dead money above the largest live contribution.
      const largest = Math.max(...live.map(p => p.committed));
      eligible = live.filter(p => p.committed === largest);
    }
    const ids = eligible.map(p => p.id);
    const last = hand.pools.at(-1);
    if (!refund && last && last.eligible.length === ids.length && last.eligible.every((id, i) => id === ids[i])) {
      last.amount += amount;
    } else hand.pools.push({amount, eligible: ids, refund});
  }
  for (const pool of hand.pools) {
    const eligible = clockwise(hand.players, hand.button).filter(p => pool.eligible.includes(p.id));
    const high = Math.max(...eligible.map(p => scores.get(p.id) ?? -1));
    const winners = eligible.filter(p => (scores.get(p.id) ?? -1) === high);
    pool.winners = winners.map(p => p.id);
    const split = Math.floor(pool.amount / winners.length);
    const odd = pool.amount % winners.length;
    pool.shares = winners.map((p, i) => {
      const amount = split + (i < odd ? 1 : 0);
      p.stack += amount;
      p.paid += amount;
      return {id: p.id, amount};
    });
  }
  hand.actorId = null;
  hand.street = 'complete';
  // History needs the board and dealt hole cards; nothing can draw from the stub now.
  hand.deck.length = 0;
}

// Preview only the pending action on this street. The button and board never advance here.
function nextIfMatched(hand) {
  if (!hand.actorId) return null;
  const actor = hand.players.find(p => p.id === hand.actorId);
  const payment = Math.min(actor.stack, hand.currentTo - actor.streetBet);
  const matched = {...actor, actedTo:hand.currentTo, streetBet:actor.streetBet + payment, allIn:actor.stack === payment};
  const live = hand.players.filter(p => !p.folded).map(p => p === actor ? matched : p);
  return roundPosition(live, hand.currentTo, actor.seat).actor?.id ?? null;
}

export function viewHand(hand, viewerId) {
  if (!hand) return null;
  const {number, street, button, actorId, currentTo, showdown} = hand;
  return {number, street, button, actorId, currentTo, showdown, nextIfMatched:nextIfMatched(hand), board: [...hand.board],
    pot: hand.players.reduce((sum, p) => sum + p.committed, 0),
    players: hand.players.map(p => {
      const showCards = p.id === viewerId || (showdown && !p.folded);
      return {id:p.id, seat:p.seat, name:p.name, position:p.position, stack:p.stack,
        startStack:p.startStack, streetBet:p.streetBet, committed:p.committed, paid:p.paid,
        folded:p.folded, allIn:p.allIn, cards:showCards ? [...p.cards] : [], rank:showCards ? p.rank : null};
    }),
    events: structuredClone(hand.events), pools: structuredClone(hand.pools), legal: legalActions(hand, viewerId)};
}
