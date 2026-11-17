const test = require('node:test');
const assert = require('node:assert/strict');
const { PokerTable } = require('../server/game');
const { parseCards } = require('./parseCards');

// Builds a table whose deck deals the given cards in order: first one card to
// each player (starting left of the dealer), then a second card each, then the
// flop, turn and river.
function createTable({ chipCounts, dealOrder = null, smallBlind = 10, bigBlind = 20 }) {
  const options = { startingChips: 1000, smallBlind, bigBlind };
  if (dealOrder) {
    options.createDeck = () => parseCards(dealOrder).reverse();
  }
  const table = new PokerTable(options);
  chipCounts.forEach((chips, index) => {
    table.addPlayer(`player${index}`, `Player ${index}`).chips = chips;
  });
  return table;
}

function chipsOf(table, index) {
  return table.findPlayer(`player${index}`).chips;
}

function currentPlayerId(table) {
  return table.seats[table.currentSeatIndex].playerId;
}

test('heads-up: the dealer posts the small blind and acts first before the flop', () => {
  const table = createTable({ chipCounts: [1000, 1000] });
  table.startHand();
  assert.equal(table.dealerSeatIndex, 0);
  assert.equal(table.smallBlindSeatIndex, 0);
  assert.equal(table.bigBlindSeatIndex, 1);
  assert.equal(currentPlayerId(table), 'player0');

  table.applyAction('player0', 'call');
  assert.equal(table.stage, 'preflop', 'the big blind still has the option');
  table.applyAction('player1', 'check');
  assert.equal(table.stage, 'flop');
  assert.equal(currentPlayerId(table), 'player1', 'the big blind acts first after the flop');
});

test('three players: blinds sit left of the dealer and the button moves each hand', () => {
  const table = createTable({ chipCounts: [1000, 1000, 1000] });
  table.startHand();
  assert.deepEqual(
    [table.dealerSeatIndex, table.smallBlindSeatIndex, table.bigBlindSeatIndex],
    [0, 1, 2],
  );
  assert.equal(currentPlayerId(table), 'player0');

  table.applyAction('player0', 'fold');
  table.applyAction('player1', 'fold');
  assert.equal(table.stage, 'showdown');
  assert.equal(chipsOf(table, 2), 1010, 'the big blind wins the small blind');
  assert.deepEqual(table.lastResult.revealedPlayerIds, [], 'no cards are shown after a fold win');

  table.startHand();
  assert.equal(table.dealerSeatIndex, 1);
});

test('an uncalled bet goes back to the bettor', () => {
  const table = createTable({ chipCounts: [1000, 1000, 1000] });
  table.startHand();
  table.applyAction('player0', 'raise', 500);
  table.applyAction('player1', 'fold');
  table.applyAction('player2', 'fold');
  assert.equal(chipsOf(table, 0), 1030);
  assert.equal(table.lastResult.winners[0].amount, 50);
});

test('raise rules: minimum raise, checking and acting out of turn', () => {
  const table = createTable({ chipCounts: [1000, 1000, 1000] });
  table.startHand();
  assert.throws(() => table.applyAction('player1', 'call'), /not your turn/);
  assert.throws(() => table.applyAction('player0', 'check'), /cannot check/);
  assert.throws(() => table.applyAction('player0', 'raise', 30), /between 40 and 1000/);
  assert.throws(() => table.applyAction('player0', 'raise', 1001), /between/);
  assert.throws(() => table.applyAction('player0', 'raise', 60.5), /between/);

  table.applyAction('player0', 'raise', 100);
  // The raise was 80 more, so the next raise must be to at least 180.
  assert.throws(() => table.applyAction('player1', 'raise', 150), /between 180 and 1000/);
  table.applyAction('player1', 'raise', 180);
  table.applyAction('player2', 'fold');
  table.applyAction('player0', 'call');
  assert.equal(table.stage, 'flop');
  assert.equal(table.getStateFor('player0').potTotal, 380);
});

test('an all-in for less than a full raise does not reopen the betting', () => {
  const table = createTable({ chipCounts: [1000, 1000, 130] });
  table.startHand();
  table.applyAction('player0', 'raise', 100);
  table.applyAction('player1', 'call');
  table.applyAction('player2', 'raise', 130); // all-in, only 30 more
  assert.equal(currentPlayerId(table), 'player0');
  const options = table.getActionOptions(table.findPlayer('player0'));
  assert.equal(options.canRaise, false);
  assert.equal(options.callAmount, 30);
  assert.throws(() => table.applyAction('player0', 'raise', 400), /cannot raise/);
  table.applyAction('player0', 'call');
  table.applyAction('player1', 'call');
  assert.equal(table.stage, 'flop');
});

test('side pots: a short all-in player can only win what they matched', () => {
  const table = createTable({
    chipCounts: [300, 300, 100],
    // Dealer is player0, so cards go to player1, player2, player0.
    dealOrder: 'Ks As 7c Kd Ad 2h 3c 4d 8h 9s Js',
  });
  table.startHand();
  table.applyAction('player0', 'raise', 300);
  table.applyAction('player1', 'call');
  table.applyAction('player2', 'call');
  assert.equal(table.stage, 'showdown', 'the board runs out when everyone is all-in');
  assert.equal(table.communityCards.length, 5);
  assert.equal(chipsOf(table, 2), 300, 'pair of aces wins the main pot of 3 x 100');
  assert.equal(chipsOf(table, 1), 400, 'pair of kings wins the side pot of 2 x 200');
  assert.equal(chipsOf(table, 0), 0);
  assert.deepEqual(table.lastResult.revealedPlayerIds.sort(), ['player0', 'player1', 'player2']);
});

test('a tied pot is split and the odd chip goes to the first winner left of the dealer', () => {
  const table = createTable({
    chipCounts: [1000, 1000, 1000],
    smallBlind: 5,
    bigBlind: 10,
    // player1 and player2 both play the board's ace-high straight.
    dealOrder: '2c 2d 7h 3c 3d 8h Ah Kd Qs Jc Th',
  });
  table.startHand();
  table.applyAction('player0', 'call');
  table.applyAction('player1', 'call');
  table.applyAction('player2', 'check');
  table.applyAction('player1', 'raise', 15);
  table.applyAction('player2', 'call');
  table.applyAction('player0', 'fold');
  assert.equal(table.stage, 'turn');
  for (const stage of ['river', 'showdown']) {
    table.applyAction('player1', 'check');
    table.applyAction('player2', 'check');
    assert.equal(table.stage, stage);
  }
  // The pot is 10 + 25 + 25 = 60, split evenly between the two winners.
  assert.equal(chipsOf(table, 0) + chipsOf(table, 1) + chipsOf(table, 2), 3000);
  assert.equal(chipsOf(table, 1), 1005);
  assert.equal(chipsOf(table, 2), 1005);
});

test('odd chip: a three-way pot that cannot be split evenly', () => {
  const table = createTable({
    chipCounts: [1000, 1000, 1000, 1000],
    smallBlind: 5,
    bigBlind: 10,
    // Dealer player0; cards go to player1, player2, player3, player0. Board plays for all.
    dealOrder: '2c 2d 2h 7s 3c 3d 3h 8s Ah Kd Qs Jc Th',
  });
  table.startHand();
  table.applyAction('player3', 'call');
  table.applyAction('player0', 'call');
  table.applyAction('player1', 'call');
  table.applyAction('player2', 'check');
  table.applyAction('player1', 'check');
  table.applyAction('player2', 'check');
  table.applyAction('player3', 'check');
  table.applyAction('player0', 'fold');
  while (table.stage !== 'showdown') {
    table.applyAction(currentPlayerId(table), 'check');
  }
  // Pot of 40 split three ways: 13 each, and the odd chip to player1 (first left of the dealer).
  assert.equal(chipsOf(table, 1), 1004);
  assert.equal(chipsOf(table, 2), 1003);
  assert.equal(chipsOf(table, 3), 1003);
});

test('a player who cannot cover the big blind is all-in for less', () => {
  const table = createTable({ chipCounts: [1000, 12] });
  table.startHand();
  assert.equal(table.findPlayer('player1').isAllIn, true);
  table.applyAction('player0', 'call');
  assert.equal(table.stage, 'showdown');
  assert.equal(chipsOf(table, 0) + chipsOf(table, 1), 1012);
  assert.ok([0, 12, 24].includes(chipsOf(table, 1)), 'lose, split or win a pot of 2 x 12');
});

test('hole cards are hidden from other players until showdown', () => {
  const table = createTable({ chipCounts: [1000, 1000] });
  table.startHand();
  const stateForPlayer0 = table.getStateFor('player0');
  assert.equal(stateForPlayer0.seats[0].holeCards.length, 2);
  assert.equal(stateForPlayer0.seats[1].holeCards, null);
  assert.equal(stateForPlayer0.seats[1].hasCards, true);
  assert.equal(JSON.stringify(stateForPlayer0).includes('deck'), false);

  table.applyAction('player0', 'call');
  table.applyAction('player1', 'check');
  while (table.stage !== 'showdown') {
    table.applyAction(currentPlayerId(table), 'check');
  }
  assert.equal(table.getStateFor('player0').seats[1].holeCards.length, 2);
});

test('a player who leaves on their turn folds and the hand goes on', () => {
  const table = createTable({ chipCounts: [1000, 1000, 1000] });
  table.startHand();
  table.removePlayer('player0');
  assert.equal(currentPlayerId(table), 'player1');
  table.removePlayer('player2'); // the big blind leaves out of turn
  assert.equal(table.stage, 'showdown');
  // Only the called part of the big blind (10) stays in the pot.
  assert.equal(chipsOf(table, 1), 1010);
  assert.equal(table.getPlayers().length, 1);
  assert.equal(table.canStartHand(), false);
});

test('players without chips sit out and can rebuy between hands', () => {
  const table = createTable({ chipCounts: [1000, 1000, 0] });
  table.startHand();
  assert.equal(table.findPlayer('player2').isInHand, false);
  assert.throws(() => table.rebuy('player0'), /no chips left/);
  table.rebuy('player2');
  assert.equal(chipsOf(table, 2), 1000);
});

test('random play: chips are never created or lost and every hand finishes', () => {
  const PLAYER_COUNT = 6;
  const HAND_COUNT = 3000;
  const MAXIMUM_ACTIONS_PER_HAND = 400;
  const table = createTable({ chipCounts: new Array(PLAYER_COUNT).fill(1000) });
  let expectedTotalChips = PLAYER_COUNT * 1000;

  for (let handCount = 0; handCount < HAND_COUNT; handCount++) {
    for (const player of table.getPlayers()) {
      if (player.chips === 0) {
        table.rebuy(player.playerId);
        expectedTotalChips += 1000;
      }
    }
    table.startHand();
    let actionCount = 0;
    while (table.isBettingStage()) {
      actionCount += 1;
      assert.ok(actionCount < MAXIMUM_ACTIONS_PER_HAND, 'the hand must finish');
      const player = table.seats[table.currentSeatIndex];
      const options = table.getActionOptions(player);
      const randomNumber = Math.random();
      if (options.canRaise && randomNumber < 0.3) {
        const raiseRange = options.maximumRaiseTo - options.minimumRaiseTo;
        const raiseTo = options.minimumRaiseTo + Math.floor(Math.random() * Math.random() * (raiseRange + 1));
        table.applyAction(player.playerId, 'raise', raiseTo);
      } else if (options.canCheck) {
        table.applyAction(player.playerId, 'check');
      } else if (randomNumber < 0.8) {
        table.applyAction(player.playerId, 'call');
      } else {
        table.applyAction(player.playerId, 'fold');
      }
      const chipsOnTable = table
        .getPlayers()
        .reduce((total, tablePlayer) => total + tablePlayer.chips + tablePlayer.totalBetThisHand, 0);
      assert.equal(chipsOnTable, expectedTotalChips);
      assert.ok(table.getPlayers().every((tablePlayer) => tablePlayer.chips >= 0));
    }
    assert.equal(table.stage, 'showdown');
  }
});
