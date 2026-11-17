const SUIT_BY_LETTER = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
const RANK_BY_LETTER = { T: 10, J: 11, Q: 12, K: 13, A: 14 };

// parseCards('As Kd 7h') -> [{ rank: 14, suit: 'spades' }, ...]
function parseCards(text) {
  return text.split(' ').map((cardText) => ({
    rank: RANK_BY_LETTER[cardText[0]] || Number(cardText[0]),
    suit: SUIT_BY_LETTER[cardText[1]],
  }));
}

module.exports = { parseCards };
