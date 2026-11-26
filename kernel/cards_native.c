/* Card id = rank * 4 + suit. Scores increase with hand strength. */
#include <stdint.h>

#ifdef _MSC_VER
#include <intrin.h>
static int top_rank(unsigned mask) {
    unsigned long index;
    _BitScanReverse(&index, mask);
    return (int)index;
}
static int popcount(unsigned mask) {
    int n = 0;
    while (mask) { mask &= mask - 1; ++n; }
    return n;
}
#else

static int top_rank(unsigned mask) {
    return 31 - __builtin_clz(mask);
}

static int popcount(unsigned mask) { return __builtin_popcount(mask); }
#endif

static unsigned best_ranks(unsigned mask, int count) {
    while (popcount(mask) > count)
        mask &= mask - 1;
    return mask;
}

static int straight(unsigned ranks) {
    unsigned runs = ranks & (ranks << 1) & (ranks << 2)
                        & (ranks << 3) & (ranks << 4);
    if (runs) return top_rank(runs);
    return (ranks & 0x100f) == 0x100f ? 3 : -1;
}

/* Category occupies bits 26+, followed by group ranks, then kickers. */
int score7(const unsigned char *cards) {
    unsigned suits[4] = {0}, ranks = 0, pairs = 0, trips = 0, quads = 0;
    for (int i = 0; i < 7; ++i) {
        unsigned bit = 1u << (cards[i] / 4);
        quads |= trips & bit;
        trips |= pairs & bit;
        pairs |= ranks & bit;
        ranks |= bit;
        suits[cards[i] % 4] |= bit;
    }
    for (int suit = 0; suit < 4; ++suit) {
        if (popcount(suits[suit]) >= 5) {
            int high = straight(suits[suit]);
            if (high >= 0) return (8 << 26) + high;
            /* Seven cards cannot contain a flush alongside quads or a full house. */
            return (5 << 26) + best_ranks(suits[suit], 5);
        }
    }
    if (quads)
        return (7 << 26) + (top_rank(quads) << 13) + best_ranks(ranks ^ quads, 1);
    int trip = trips ? top_rank(trips) : -1;
    if (trips && (pairs ^ (1u << trip)))
        return (6 << 26) + (trip << 13) + top_rank(pairs ^ (1u << trip));
    int high = straight(ranks);
    if (high >= 0) return (4 << 26) + high;
    if (trips)
        return (3 << 26) + (trip << 13) + best_ranks(ranks ^ trips, 2);
    if (popcount(pairs) >= 2) {
        unsigned two = best_ranks(pairs, 2);
        return (2 << 26) + (two << 13) + best_ranks(ranks ^ two, 1);
    }
    if (pairs)
        return (1 << 26) + (top_rank(pairs) << 13) + best_ranks(ranks ^ pairs, 3);
    return best_ranks(ranks, 5);
}

static uint64_t next64(uint64_t *state) {
    uint64_t x = (*state += UINT64_C(0x9e3779b97f4a7c15));
    x = (x ^ (x >> 30)) * UINT64_C(0xbf58476d1ce4e5b9);
    x = (x ^ (x >> 27)) * UINT64_C(0x94d049bb133111eb);
    return x ^ (x >> 31);
}

static unsigned bounded(uint64_t *state, unsigned bound) {
    /* Reject the incomplete range to keep each legal draw equally likely. */
    uint64_t product = (next64(state) >> 32) * bound;
    if ((unsigned)product < bound) {
        unsigned threshold = -bound % bound;
        while ((unsigned)product < threshold)
            product = (next64(state) >> 32) * bound;
    }
    return product >> 32;
}

double equity_mc(const unsigned char *visible, int board_len, int rollouts) {
    unsigned char hero[7], vill[7], deck[52];
    uint64_t hole = 0, board = 0;
    for (int i = 0; i < 2; ++i) {
        hero[i] = visible[i];
        hole |= UINT64_C(1) << visible[i];
    }
    for (int i = 0; i < board_len; ++i) {
        hero[2 + i] = vill[2 + i] = visible[2 + i];
        board |= UINT64_C(1) << visible[2 + i];
    }
    uint64_t state = hole * UINT64_C(0x9e3779b97f4a7c15) ^ board;
    int left = 0;
    for (int c = 0; c < 52; ++c)
        if (!((board | hole) & (UINT64_C(1) << c))) deck[left++] = c;
    int64_t score = 0;
    for (int trial = 0; trial < rollouts; ++trial) {
        /* Every prefix is a fresh uniform draw regardless of prior deck order. */
        for (int j = 0; j < 7 - board_len; ++j) {
            int pick = j + bounded(&state, left - j);
            unsigned char card = deck[pick];
            deck[pick] = deck[j];
            deck[j] = card;
            if (j < 2) vill[j] = card;
            else hero[board_len + j] = vill[board_len + j] = card;
        }
        int a = score7(hero), b = score7(vill);
        score += (a > b) * 2 + (a == b);
    }
    return score / (2.0 * rollouts);
}
