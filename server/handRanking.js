const { ACE_RANK } = require('./cards');

const CATEGORY = {
  HIGH_CARD: 0,
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
};

const CATEGORY_NAMES = [
  'High Card',
  'One Pair',
  'Two Pair',
  'Three of a Kind',
  'Straight',
  'Flush',
  'Full House',
  'Four of a Kind',
  'Straight Flush',
];

const HAND_SIZE = 5;
const LOW_ACE_RANK = 1;

// Returns the highest card rank of the best straight in the given ranks, or null.
// The ace can be high (10-J-Q-K-A) or low (A-2-3-4-5).
function findStraightHighRank(ranks) {
  const rankSet = new Set(ranks);
  if (rankSet.has(ACE_RANK)) {
    rankSet.add(LOW_ACE_RANK);
  }
  for (let highRank = ACE_RANK; highRank >= HAND_SIZE; highRank--) {
    let isStraight = true;
    for (let offset = 0; offset < HAND_SIZE; offset++) {
      if (!rankSet.has(highRank - offset)) {
        isStraight = false;
        break;
      }
    }
    if (isStraight) {
      return highRank;
    }
  }
  return null;
}

// Finds the best five-card poker hand in the given cards (usually two hole cards
// plus the community cards). Returns { score, name }. The score is a list of
// numbers: the hand category first, then the tie-breaking ranks. Compare two
// scores with compareScores.
function evaluateHand(cards) {
  const ranksDescending = cards.map((card) => card.rank).sort((first, second) => second - first);

  const countByRank = new Map();
  const ranksBySuit = new Map();
  for (const card of cards) {
    countByRank.set(card.rank, (countByRank.get(card.rank) || 0) + 1);
    if (!ranksBySuit.has(card.suit)) {
      ranksBySuit.set(card.suit, []);
    }
    ranksBySuit.get(card.suit).push(card.rank);
  }

  // Biggest groups first; for groups of the same size, the higher rank first.
  const rankGroups = [...countByRank.entries()]
    .map(([rank, count]) => ({ rank, count }))
    .sort((first, second) => second.count - first.count || second.rank - first.rank);
  const biggestGroup = rankGroups[0];
  const secondGroup = rankGroups[1];

  const ranksWithout = (...excludedRanks) =>
    ranksDescending.filter((rank) => !excludedRanks.includes(rank));
  const makeResult = (category, tieBreakers, name = CATEGORY_NAMES[category]) => ({
    score: [category, ...tieBreakers],
    name,
  });

  const flushRanks = [...ranksBySuit.values()].find((ranks) => ranks.length >= HAND_SIZE);
  if (flushRanks) {
    const straightFlushHighRank = findStraightHighRank(flushRanks);
    if (straightFlushHighRank !== null) {
      const name = straightFlushHighRank === ACE_RANK ? 'Royal Flush' : 'Straight Flush';
      return makeResult(CATEGORY.STRAIGHT_FLUSH, [straightFlushHighRank], name);
    }
  }

  if (biggestGroup.count === 4) {
    const kickers = ranksWithout(biggestGroup.rank).slice(0, 1);
    return makeResult(CATEGORY.FOUR_OF_A_KIND, [biggestGroup.rank, ...kickers]);
  }

  if (biggestGroup.count === 3 && secondGroup && secondGroup.count >= 2) {
    return makeResult(CATEGORY.FULL_HOUSE, [biggestGroup.rank, secondGroup.rank]);
  }

  if (flushRanks) {
    const topFlushRanks = [...flushRanks].sort((first, second) => second - first).slice(0, HAND_SIZE);
    return makeResult(CATEGORY.FLUSH, topFlushRanks);
  }

  const straightHighRank = findStraightHighRank(ranksDescending);
  if (straightHighRank !== null) {
    return makeResult(CATEGORY.STRAIGHT, [straightHighRank]);
  }

  if (biggestGroup.count === 3) {
    const kickers = ranksWithout(biggestGroup.rank).slice(0, 2);
    return makeResult(CATEGORY.THREE_OF_A_KIND, [biggestGroup.rank, ...kickers]);
  }

  if (biggestGroup.count === 2 && secondGroup && secondGroup.count === 2) {
    const kickers = ranksWithout(biggestGroup.rank, secondGroup.rank).slice(0, 1);
    return makeResult(CATEGORY.TWO_PAIR, [biggestGroup.rank, secondGroup.rank, ...kickers]);
  }

  if (biggestGroup.count === 2) {
    const kickers = ranksWithout(biggestGroup.rank).slice(0, 3);
    return makeResult(CATEGORY.ONE_PAIR, [biggestGroup.rank, ...kickers]);
  }

  return makeResult(CATEGORY.HIGH_CARD, ranksDescending.slice(0, HAND_SIZE));
}

// Returns a positive number when firstScore is better, negative when
// secondScore is better, and 0 when the hands are tied.
function compareScores(firstScore, secondScore) {
  const length = Math.max(firstScore.length, secondScore.length);
  for (let index = 0; index < length; index++) {
    const difference = (firstScore[index] || 0) - (secondScore[index] || 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

module.exports = { evaluateHand, compareScores, CATEGORY };
