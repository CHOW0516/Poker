const crypto = require('node:crypto');

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
const LOWEST_RANK = 2;
const ACE_RANK = 14;

// Returns a new 52-card deck in random order. Jack = 11, Queen = 12, King = 13, Ace = 14.
function createShuffledDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let rank = LOWEST_RANK; rank <= ACE_RANK; rank++) {
      deck.push({ rank, suit });
    }
  }
  for (let lastIndex = deck.length - 1; lastIndex > 0; lastIndex--) {
    const swapIndex = crypto.randomInt(lastIndex + 1);
    [deck[lastIndex], deck[swapIndex]] = [deck[swapIndex], deck[lastIndex]];
  }
  return deck;
}

module.exports = { createShuffledDeck, SUITS, ACE_RANK };
