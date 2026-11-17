const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateHand, compareScores } = require('../server/handRanking');
const { parseCards } = require('./parseCards');

function nameOf(text) {
  return evaluateHand(parseCards(text)).name;
}

function compareHands(firstText, secondText) {
  return compareScores(evaluateHand(parseCards(firstText)).score, evaluateHand(parseCards(secondText)).score);
}

test('names every hand category from seven cards', () => {
  assert.equal(nameOf('As Ks Qs Js Ts 2d 3c'), 'Royal Flush');
  assert.equal(nameOf('9h 8h 7h 6h 5h Ad Ac'), 'Straight Flush');
  assert.equal(nameOf('9h 9d 9s 9c 5h Ad Ac'), 'Four of a Kind');
  assert.equal(nameOf('Kh Kd Ks 8c 8h 2d 3c'), 'Full House');
  assert.equal(nameOf('Kh Qh 9h 8h 5h 2d 3c'), 'Flush');
  assert.equal(nameOf('9h 8d 7s 6c 5h Ad Ac'), 'Straight');
  assert.equal(nameOf('Jh Jd Js 3c 8h 2d 4c'), 'Three of a Kind');
  assert.equal(nameOf('Qh Qd 7s 7c 3h 2d 9c'), 'Two Pair');
  assert.equal(nameOf('Ah Ad 3s 8c Th 2d 9c'), 'One Pair');
  assert.equal(nameOf('Kh 7d 5s 3c 2h Jd 9c'), 'High Card');
});

test('ace plays low in A-2-3-4-5 and that straight loses to 2-3-4-5-6', () => {
  assert.equal(nameOf('Ah 2d 3s 4c 5h Kd Qc'), 'Straight');
  assert.ok(compareHands('2h 3d 4s 5c 6h Kd Qc', 'Ah 2d 3s 4c 5h Kd Qc') > 0);
});

test('a wrap-around like Q-K-A-2-3 is not a straight', () => {
  assert.equal(nameOf('Qh Kd As 2c 3h 8d 9c'), 'High Card');
});

test('a low straight flush is found with the ace low', () => {
  assert.equal(nameOf('Ah 2h 3h 4h 5h Kd Kc'), 'Straight Flush');
});

test('a flush and a straight in different cards is only a flush', () => {
  assert.equal(nameOf('2h 3h 4h 5d 6c Kh 9h'), 'Flush');
});

test('two three-of-a-kinds make a full house using the higher one as trips', () => {
  const hand = evaluateHand(parseCards('9h 9d 9s 4c 4h 4d Ac'));
  assert.equal(hand.name, 'Full House');
  assert.deepEqual(hand.score.slice(1), [9, 4]);
});

test('three pairs use the two highest pairs and the best kicker', () => {
  const hand = evaluateHand(parseCards('Kh Kd 9s 9c 4h 4d Ac'));
  assert.deepEqual(hand.score.slice(1), [13, 9, 14]);
});

test('kickers break ties', () => {
  assert.ok(compareHands('Ah Ad Ks 8c 5h 3d 2c', 'As Ac Qs 8d 5c 3h 2d') > 0);
  assert.ok(compareHands('Ah Kd 9s 8c 5h 3d 2c', 'As Kc 9d 7d 5c 3h 2d') > 0);
});

test('identical five-card hands tie even when the unused cards differ', () => {
  // Board plays for both: A-K-Q-J-T straight.
  assert.equal(compareHands('Ah Kd Qs Jc Th 2d 3c', 'Ah Kd Qs Jc Th 4s 5s'), 0);
});

test('higher categories beat lower ones', () => {
  const handsFromBestToWorst = [
    '9h 8h 7h 6h 5h Ad Ac',
    '9h 9d 9s 9c 5h Ad Ac',
    'Kh Kd Ks 8c 8h 2d 3c',
    'Kh Qh 9h 8h 5h 2d 3c',
    '9h 8d 7s 6c 5h Ad Ac',
    'Jh Jd Js 3c 8h 2d 4c',
    'Qh Qd 7s 7c 3h 2d 9c',
    'Ah Ad 3s 8c Th 2d 9c',
    'Kh 7d 5s 3c 2h Jd 9c',
  ];
  for (let index = 0; index < handsFromBestToWorst.length - 1; index++) {
    assert.ok(compareHands(handsFromBestToWorst[index], handsFromBestToWorst[index + 1]) > 0);
  }
});
