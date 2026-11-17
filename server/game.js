const { createShuffledDeck } = require('./cards');
const { evaluateHand, compareScores } = require('./handRanking');

const SEAT_COUNT = 9;
const BETTING_STAGES = ['preflop', 'flop', 'turn', 'river'];
const FLOP_CARD_COUNT = 3;

// One table of No Limit Texas Hold'em. This class holds all the game rules and
// has no networking or timers, so it can be tested on its own.
class PokerTable {
  constructor({ startingChips, smallBlind, bigBlind, createDeck = createShuffledDeck }) {
    this.startingChips = startingChips;
    this.smallBlind = smallBlind;
    this.bigBlind = bigBlind;
    this.createDeck = createDeck;

    this.seats = new Array(SEAT_COUNT).fill(null);
    this.stage = 'waiting';
    this.deck = [];
    this.communityCards = [];
    this.dealerSeatIndex = -1;
    this.smallBlindSeatIndex = -1;
    this.bigBlindSeatIndex = -1;
    this.currentSeatIndex = -1;
    this.currentBet = 0;
    this.minimumRaise = bigBlind;
    this.handNumber = 0;
    this.turnNumber = 0;
    this.lastResult = null;
  }

  // ---------- Players ----------

  getPlayers() {
    return this.seats.filter((player) => player !== null);
  }

  findPlayer(playerId) {
    return this.getPlayers().find((player) => player.playerId === playerId) || null;
  }

  addPlayer(playerId, name) {
    const seatIndex = this.seats.indexOf(null);
    if (seatIndex === -1) {
      throw new Error('This table is full.');
    }
    const player = {
      playerId,
      name,
      seatIndex,
      chips: this.startingChips,
      holeCards: [],
      betThisRound: 0,
      totalBetThisHand: 0,
      isInHand: false,
      hasFolded: false,
      isAllIn: false,
      hasActed: false,
      isConnected: true,
      hasLeft: false,
    };
    this.seats[seatIndex] = player;
    return player;
  }

  // A player who leaves during a hand folds. Their chips already in the pot stay there.
  removePlayer(playerId) {
    const player = this.findPlayer(playerId);
    if (!player) {
      return;
    }
    player.hasLeft = true;
    player.isConnected = false;

    if (!this.isBettingStage()) {
      this.removeDepartedPlayers();
      return;
    }
    if (!player.isInHand || player.hasFolded) {
      return;
    }
    if (player.seatIndex === this.currentSeatIndex) {
      this.applyAction(playerId, 'fold');
      return;
    }
    player.hasFolded = true;
    if (this.getLivePlayers().length === 1) {
      this.finishHand();
    }
  }

  removeDepartedPlayers() {
    for (const player of this.getPlayers()) {
      if (player.hasLeft) {
        this.seats[player.seatIndex] = null;
      }
    }
  }

  // A player with no chips can take a fresh stack between hands.
  rebuy(playerId) {
    const player = this.findPlayer(playerId);
    if (!player) {
      throw new Error('You are not at this table.');
    }
    const isPlayingThisHand = this.isBettingStage() && player.isInHand;
    if (player.chips > 0 || isPlayingThisHand) {
      throw new Error('You can only rebuy when you have no chips left.');
    }
    player.chips = this.startingChips;
  }

  // ---------- Hand flow ----------

  isBettingStage() {
    return BETTING_STAGES.includes(this.stage);
  }

  getPlayersReadyForNextHand() {
    return this.getPlayers().filter(
      (player) => player.chips > 0 && player.isConnected && !player.hasLeft,
    );
  }

  canStartHand() {
    return !this.isBettingStage() && this.getPlayersReadyForNextHand().length >= 2;
  }

  startHand() {
    if (!this.canStartHand()) {
      throw new Error('At least two players with chips are needed to start.');
    }
    this.removeDepartedPlayers();

    const participants = this.getPlayersReadyForNextHand();
    for (const player of this.getPlayers()) {
      player.holeCards = [];
      player.betThisRound = 0;
      player.totalBetThisHand = 0;
      player.hasFolded = false;
      player.isAllIn = false;
      player.hasActed = false;
      player.isInHand = participants.includes(player);
    }

    const isInHand = (player) => player.isInHand;
    this.dealerSeatIndex = this.findNextSeatIndex(this.dealerSeatIndex, isInHand);
    if (participants.length === 2) {
      // Heads-up rule: the dealer posts the small blind and acts first before the flop.
      this.smallBlindSeatIndex = this.dealerSeatIndex;
    } else {
      this.smallBlindSeatIndex = this.findNextSeatIndex(this.dealerSeatIndex, isInHand);
    }
    this.bigBlindSeatIndex = this.findNextSeatIndex(this.smallBlindSeatIndex, isInHand);

    this.handNumber += 1;
    this.stage = 'preflop';
    this.deck = this.createDeck();
    this.communityCards = [];
    this.lastResult = null;

    this.placeBet(this.seats[this.smallBlindSeatIndex], this.smallBlind);
    this.placeBet(this.seats[this.bigBlindSeatIndex], this.bigBlind);
    this.currentBet = this.bigBlind;
    this.minimumRaise = this.bigBlind;

    const CARDS_PER_PLAYER = 2;
    for (let cardNumber = 0; cardNumber < CARDS_PER_PLAYER; cardNumber++) {
      let seatIndex = this.dealerSeatIndex;
      for (let dealtCount = 0; dealtCount < participants.length; dealtCount++) {
        seatIndex = this.findNextSeatIndex(seatIndex, isInHand);
        this.seats[seatIndex].holeCards.push(this.deck.pop());
      }
    }

    // The first player to act before the flop sits to the left of the big blind.
    this.currentSeatIndex = this.bigBlindSeatIndex;
    this.continueHand();
  }

  // What the given player may do right now.
  getActionOptions(player) {
    const amountToCall = Math.max(0, this.currentBet - player.betThisRound);
    const maximumRaiseTo = player.betThisRound + player.chips;
    const hasOpponentWithChips = this.getLivePlayers().some(
      (opponent) => opponent !== player && !opponent.isAllIn,
    );
    return {
      canCheck: amountToCall === 0,
      callAmount: Math.min(amountToCall, player.chips),
      // A player who already acted may raise again only after a full raise by someone else.
      canRaise: !player.hasActed && maximumRaiseTo > this.currentBet && hasOpponentWithChips,
      minimumRaiseTo: Math.min(this.currentBet + this.minimumRaise, maximumRaiseTo),
      maximumRaiseTo,
    };
  }

  // actionType is 'fold', 'check', 'call' or 'raise'. For 'raise', raiseToAmount is
  // the player's new total bet for this betting round (a first bet also counts as a raise).
  applyAction(playerId, actionType, raiseToAmount) {
    if (!this.isBettingStage()) {
      throw new Error('No hand is being played right now.');
    }
    const player = this.seats[this.currentSeatIndex];
    if (!player || player.playerId !== playerId) {
      throw new Error('It is not your turn.');
    }
    const options = this.getActionOptions(player);

    if (actionType === 'fold') {
      player.hasFolded = true;
    } else if (actionType === 'check') {
      if (!options.canCheck) {
        throw new Error('You cannot check. You must call, raise or fold.');
      }
    } else if (actionType === 'call') {
      if (options.canCheck) {
        throw new Error('There is nothing to call.');
      }
      this.placeBet(player, options.callAmount);
    } else if (actionType === 'raise') {
      if (!options.canRaise) {
        throw new Error('You cannot raise right now.');
      }
      const isValidAmount =
        Number.isInteger(raiseToAmount) &&
        raiseToAmount >= options.minimumRaiseTo &&
        raiseToAmount <= options.maximumRaiseTo;
      if (!isValidAmount) {
        throw new Error(
          `Your raise must be between ${options.minimumRaiseTo} and ${options.maximumRaiseTo}.`,
        );
      }
      const raiseSize = raiseToAmount - this.currentBet;
      this.placeBet(player, raiseToAmount - player.betThisRound);
      this.currentBet = raiseToAmount;
      // An all-in for less than a full raise does not reopen the betting.
      if (raiseSize >= this.minimumRaise) {
        this.minimumRaise = raiseSize;
        for (const otherPlayer of this.getLivePlayers()) {
          otherPlayer.hasActed = false;
        }
      }
    } else {
      throw new Error('Unknown action.');
    }

    player.hasActed = true;
    this.continueHand();
  }

  // Moves the turn to the next player, or ends the betting round or the hand.
  continueHand() {
    const livePlayers = this.getLivePlayers();
    if (livePlayers.length === 1) {
      this.finishHand();
      return;
    }

    const playersAbleToAct = livePlayers.filter((player) => !player.isAllIn);
    const playersNeedingAction = playersAbleToAct.filter(
      (player) => !player.hasActed || player.betThisRound < this.currentBet,
    );
    const isOnlyPlayerWithChips =
      playersAbleToAct.length === 1 && playersAbleToAct[0].betThisRound >= this.currentBet;
    if (playersNeedingAction.length === 0 || isOnlyPlayerWithChips) {
      this.endBettingRound();
      return;
    }

    this.currentSeatIndex = this.findNextSeatIndex(this.currentSeatIndex, (player) =>
      playersNeedingAction.includes(player),
    );
    this.turnNumber += 1;
  }

  endBettingRound() {
    for (const player of this.getPlayers()) {
      player.betThisRound = 0;
      player.hasActed = false;
    }
    this.currentBet = 0;
    this.minimumRaise = this.bigBlind;

    if (this.stage === 'river') {
      this.finishHand();
      return;
    }

    const cardCount = this.stage === 'preflop' ? FLOP_CARD_COUNT : 1;
    for (let dealtCount = 0; dealtCount < cardCount; dealtCount++) {
      this.communityCards.push(this.deck.pop());
    }
    this.stage = BETTING_STAGES[BETTING_STAGES.indexOf(this.stage) + 1];

    // When at most one player still has chips, no more betting is possible,
    // so the remaining community cards are dealt straight away.
    const playersAbleToAct = this.getLivePlayers().filter((player) => !player.isAllIn);
    if (playersAbleToAct.length <= 1) {
      this.endBettingRound();
      return;
    }

    // After the flop, the first player to act sits to the left of the dealer.
    this.currentSeatIndex = this.dealerSeatIndex;
    this.continueHand();
  }

  finishHand() {
    this.stage = 'showdown';
    this.currentSeatIndex = -1;
    this.refundUncalledBet();

    const handPlayers = this.getPlayers().filter((player) => player.isInHand);
    const livePlayers = this.getLivePlayers();
    const isShowdown = livePlayers.length > 1;

    const handByPlayerId = new Map();
    if (isShowdown) {
      for (const player of livePlayers) {
        const hand = evaluateHand([...player.holeCards, ...this.communityCards]);
        handByPlayerId.set(player.playerId, hand);
      }
    }

    const winningsByPlayerId = new Map();
    for (const pot of buildPots(handPlayers)) {
      let potWinners = pot.eligiblePlayers;
      if (isShowdown) {
        const scoreOf = (player) => handByPlayerId.get(player.playerId).score;
        const bestScore = pot.eligiblePlayers
          .map(scoreOf)
          .reduce((best, score) => (compareScores(score, best) > 0 ? score : best));
        potWinners = pot.eligiblePlayers.filter(
          (player) => compareScores(scoreOf(player), bestScore) === 0,
        );
      }

      // A pot that cannot be split evenly gives its odd chips to the first
      // winners to the left of the dealer.
      const seatsAfterDealer = (player) =>
        (player.seatIndex - this.dealerSeatIndex - 1 + SEAT_COUNT) % SEAT_COUNT;
      potWinners.sort((first, second) => seatsAfterDealer(first) - seatsAfterDealer(second));
      const evenShare = Math.floor(pot.amount / potWinners.length);
      const oddChipCount = pot.amount - evenShare * potWinners.length;
      potWinners.forEach((winner, winnerIndex) => {
        const amount = evenShare + (winnerIndex < oddChipCount ? 1 : 0);
        winner.chips += amount;
        winningsByPlayerId.set(
          winner.playerId,
          (winningsByPlayerId.get(winner.playerId) || 0) + amount,
        );
      });
    }

    this.lastResult = {
      winners: [...winningsByPlayerId.entries()].map(([playerId, amount]) => ({
        playerId,
        name: this.findPlayer(playerId).name,
        amount,
        handName: isShowdown ? handByPlayerId.get(playerId).name : null,
      })),
      revealedPlayerIds: isShowdown ? livePlayers.map((player) => player.playerId) : [],
    };

    for (const player of this.getPlayers()) {
      player.betThisRound = 0;
      player.totalBetThisHand = 0;
    }
    this.removeDepartedPlayers();
  }

  // If the biggest bet was not fully called, the uncalled part goes back to the bettor.
  refundUncalledBet() {
    const betsDescending = this.getPlayers()
      .filter((player) => player.isInHand)
      .sort((first, second) => second.totalBetThisHand - first.totalBetThisHand);
    const biggestBettor = betsDescending[0];
    const uncalledAmount = biggestBettor.totalBetThisHand - betsDescending[1].totalBetThisHand;
    biggestBettor.chips += uncalledAmount;
    biggestBettor.totalBetThisHand -= uncalledAmount;
  }

  // ---------- Helpers ----------

  getLivePlayers() {
    return this.getPlayers().filter((player) => player.isInHand && !player.hasFolded);
  }

  placeBet(player, amount) {
    const paidAmount = Math.min(amount, player.chips);
    player.chips -= paidAmount;
    player.betThisRound += paidAmount;
    player.totalBetThisHand += paidAmount;
    if (player.chips === 0) {
      player.isAllIn = true;
    }
  }

  // Finds the next occupied seat clockwise after fromSeatIndex whose player matches.
  findNextSeatIndex(fromSeatIndex, matchesPlayer) {
    for (let step = 1; step <= SEAT_COUNT; step++) {
      const seatIndex = (fromSeatIndex + step + SEAT_COUNT) % SEAT_COUNT;
      const player = this.seats[seatIndex];
      if (player && matchesPlayer(player)) {
        return seatIndex;
      }
    }
    return -1;
  }

  // ---------- View ----------

  // The table as one player may see it. Other players' hole cards stay hidden
  // until a showdown.
  getStateFor(viewerPlayerId) {
    const isBetting = this.isBettingStage();
    const revealedPlayerIds =
      this.stage === 'showdown' && this.lastResult ? this.lastResult.revealedPlayerIds : [];
    const viewer = this.findPlayer(viewerPlayerId);
    const isViewerTurn = isBetting && viewer !== null && viewer.seatIndex === this.currentSeatIndex;
    const isViewerHoldingCards = viewer !== null && viewer.holeCards.length > 0 && !viewer.hasFolded;

    return {
      stage: this.stage,
      handNumber: this.handNumber,
      turnNumber: this.turnNumber,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      startingChips: this.startingChips,
      communityCards: this.communityCards,
      potTotal: this.getPlayers().reduce((total, player) => total + player.totalBetThisHand, 0),
      currentBet: this.currentBet,
      dealerSeatIndex: this.dealerSeatIndex,
      smallBlindSeatIndex: this.smallBlindSeatIndex,
      bigBlindSeatIndex: this.bigBlindSeatIndex,
      currentSeatIndex: this.currentSeatIndex,
      result: this.stage === 'showdown' ? this.lastResult : null,
      yourPlayerId: viewerPlayerId,
      yourOptions: isViewerTurn ? this.getActionOptions(viewer) : null,
      yourHandName:
        isViewerHoldingCards && this.communityCards.length >= FLOP_CARD_COUNT
          ? evaluateHand([...viewer.holeCards, ...this.communityCards]).name
          : null,
      seats: this.seats.map((player) => {
        if (player === null) {
          return null;
        }
        const hasCards = player.isInHand && !player.hasFolded && this.stage !== 'waiting';
        const mayViewerSeeCards =
          player.playerId === viewerPlayerId || revealedPlayerIds.includes(player.playerId);
        return {
          playerId: player.playerId,
          name: player.name,
          seatIndex: player.seatIndex,
          chips: player.chips,
          betThisRound: player.betThisRound,
          isInHand: player.isInHand,
          hasFolded: player.hasFolded,
          isAllIn: player.isAllIn && isBetting,
          isConnected: player.isConnected,
          hasCards,
          holeCards: hasCards && mayViewerSeeCards ? player.holeCards : null,
        };
      }),
    };
  }
}

// Splits the bets into a main pot and side pots. A player who is all-in can
// only win the part of each opponent's bet that they matched.
function buildPots(handPlayers) {
  const livePlayers = handPlayers.filter((player) => !player.hasFolded);
  const betLevels = [...new Set(livePlayers.map((player) => player.totalBetThisHand))]
    .filter((betLevel) => betLevel > 0)
    .sort((first, second) => first - second);

  const pots = [];
  let previousLevel = 0;
  for (const betLevel of betLevels) {
    let amount = 0;
    for (const player of handPlayers) {
      amount +=
        Math.min(player.totalBetThisHand, betLevel) -
        Math.min(player.totalBetThisHand, previousLevel);
    }
    pots.push({
      amount,
      eligiblePlayers: livePlayers.filter((player) => player.totalBetThisHand >= betLevel),
    });
    previousLevel = betLevel;
  }

  // Chips from a folded player above every live player's bet (possible when a
  // player leaves the table mid-hand) go into the last pot.
  for (const player of handPlayers) {
    pots[pots.length - 1].amount += Math.max(0, player.totalBetThisHand - previousLevel);
  }
  return pots;
}

module.exports = { PokerTable, buildPots, SEAT_COUNT };
