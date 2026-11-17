// ---------- Constants ----------

const SUIT_SYMBOLS = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
const RED_SUITS = ['hearts', 'diamonds'];
const RANK_LABELS = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const SEAT_COUNT = 9;
const RECONNECT_DELAY_MILLISECONDS = 2000;
const TOAST_MILLISECONDS = 3500;
const SAVED_NAME_KEY = 'pokerPlayerName';

// Where each seat sits around the table, in percent of the table size.
// Slot 0 is always you (bottom centre); the slots then go clockwise.
const SEAT_POSITIONS_WIDE = [
  { left: 50, top: 100 },
  { left: 21, top: 94 },
  { left: 1, top: 62 },
  { left: 7, top: 20 },
  { left: 32, top: 0 },
  { left: 68, top: 0 },
  { left: 93, top: 20 },
  { left: 99, top: 62 },
  { left: 79, top: 94 },
];
const SEAT_POSITIONS_TALL = [
  { left: 50, top: 100 },
  { left: 6, top: 86 },
  { left: 2, top: 60 },
  { left: 2, top: 34 },
  { left: 24, top: 5 },
  { left: 76, top: 5 },
  { left: 98, top: 34 },
  { left: 98, top: 60 },
  { left: 94, top: 86 },
];
const TABLE_CENTER = { left: 50, top: 50 };
const BET_DISTANCE_TOWARD_CENTER = 0.3;

// ---------- Page elements ----------

const elements = {};
for (const element of document.querySelectorAll('[id]')) {
  elements[element.id] = element;
}

// ---------- State ----------

let socket = null;
let roomCode = new URLSearchParams(window.location.search).get('room');
let latestState = null;
let hasLeftTable = false;
let isJoined = false;
let turnDeadline = null;
let previousCardKeys = new Set();
let renderedActionKey = null;
let toastTimer = null;

if (roomCode) {
  roomCode = roomCode.toUpperCase();
}

function getTokenKey() {
  return `pokerToken:${roomCode}`;
}

// ---------- Connection ----------

function connect(firstMessage) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${window.location.host}`);
  socket.addEventListener('open', () => sendMessage(firstMessage));
  socket.addEventListener('message', (event) => handleServerMessage(JSON.parse(event.data)));
  socket.addEventListener('close', handleConnectionLost);
}

function sendMessage(message) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function handleServerMessage(message) {
  if (message.type === 'joined') {
    isJoined = true;
    roomCode = message.roomCode;
    localStorage.setItem(getTokenKey(), message.playerToken);
    window.history.replaceState(null, '', `?room=${roomCode}`);
    elements.lobbyScreen.hidden = true;
    elements.tableScreen.hidden = false;
    elements.lobbyError.textContent = '';
  } else if (message.type === 'state') {
    latestState = message.state;
    turnDeadline =
      latestState.turnSecondsRemaining === null
        ? null
        : Date.now() + latestState.turnSecondsRemaining * 1000;
    renderTable();
  } else if (message.type === 'error') {
    if (!isJoined) {
      // Joining failed (for example the table is gone): go back to the lobby.
      // A saved seat that no longer exists should not block a fresh join.
      localStorage.removeItem(getTokenKey());
      elements.tableScreen.hidden = true;
      elements.lobbyScreen.hidden = false;
      elements.lobbyError.textContent = message.message;
      socket.close();
    } else {
      showToast(message.message);
    }
  }
}

function handleConnectionLost() {
  const wasAtTable = !elements.tableScreen.hidden;
  isJoined = false;
  if (!wasAtTable || hasLeftTable) {
    return;
  }
  showToast('Connection lost. Reconnecting…');
  setTimeout(() => {
    connect({
      type: 'join',
      roomCode,
      name: localStorage.getItem(SAVED_NAME_KEY),
      playerToken: localStorage.getItem(getTokenKey()),
    });
  }, RECONNECT_DELAY_MILLISECONDS);
}

// ---------- Lobby ----------

function readName() {
  const name = elements.nameInput.value.trim();
  if (name === '') {
    elements.lobbyError.textContent = 'Please enter your name.';
    elements.nameInput.focus();
    return null;
  }
  localStorage.setItem(SAVED_NAME_KEY, name);
  return name;
}

function joinTable(code) {
  const name = readName();
  if (name === null) {
    return;
  }
  roomCode = code.trim().toUpperCase();
  if (roomCode === '') {
    elements.lobbyError.textContent = 'Please enter the table code.';
    return;
  }
  connect({ type: 'join', roomCode, name, playerToken: localStorage.getItem(getTokenKey()) });
}

function showCreateJoinPanel() {
  elements.invitePanel.hidden = true;
  elements.createJoinPanel.hidden = false;
}

function setUpLobby() {
  elements.nameInput.value = localStorage.getItem(SAVED_NAME_KEY) || '';

  if (roomCode) {
    elements.invitePanel.hidden = false;
    elements.createJoinPanel.hidden = true;
    elements.inviteRoomCode.textContent = roomCode;
    // Coming back to a table you were already sitting at: rejoin straight away.
    const savedToken = localStorage.getItem(getTokenKey());
    const savedName = localStorage.getItem(SAVED_NAME_KEY);
    if (savedToken && savedName) {
      connect({ type: 'join', roomCode, name: savedName, playerToken: savedToken });
    }
  }

  elements.joinInviteButton.addEventListener('click', () => joinTable(roomCode));
  elements.ignoreInviteButton.addEventListener('click', () => {
    window.history.replaceState(null, '', window.location.pathname);
    elements.lobbyError.textContent = '';
    showCreateJoinPanel();
  });
  elements.joinButton.addEventListener('click', () => joinTable(elements.roomCodeInput.value));
  elements.createButton.addEventListener('click', () => {
    const name = readName();
    if (name === null) {
      return;
    }
    connect({
      type: 'create',
      name,
      startingChips: Number(elements.startingChipsInput.value),
      bigBlind: Number(elements.bigBlindInput.value),
    });
  });

  elements.copyLinkButton.addEventListener('click', async () => {
    const inviteLink = `${window.location.origin}/?room=${roomCode}`;
    try {
      await navigator.clipboard.writeText(inviteLink);
      showToast('Invite link copied. Send it to your friends!');
    } catch {
      showToast(inviteLink);
    }
  });
  elements.leaveButton.addEventListener('click', () => {
    hasLeftTable = true;
    sendMessage({ type: 'leave' });
    localStorage.removeItem(getTokenKey());
    window.location.href = window.location.pathname;
  });
}

// ---------- Small helpers ----------

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function formatChips(amount) {
  return amount.toLocaleString('en-US');
}

function showToast(text) {
  elements.toast.textContent = text;
  elements.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    elements.toast.hidden = true;
  }, TOAST_MILLISECONDS);
}

// Builds one playing card. A card with no rank is drawn face down.
// The deal animation plays only the first time a card key appears.
function createCardElement(card, cardKey, currentCardKeys) {
  const cardElement = createElement('div', 'card');
  if (card) {
    cardElement.classList.add('face-up');
    if (RED_SUITS.includes(card.suit)) {
      cardElement.classList.add('red');
    }
    cardElement.append(
      createElement('span', 'card-rank', RANK_LABELS[card.rank] || String(card.rank)),
      createElement('span', 'card-suit', SUIT_SYMBOLS[card.suit]),
    );
  } else {
    cardElement.classList.add('face-down');
  }
  currentCardKeys.add(cardKey);
  if (!previousCardKeys.has(cardKey)) {
    cardElement.classList.add('deal-in');
  }
  return cardElement;
}

// ---------- Table rendering ----------

function renderTable() {
  const state = latestState;
  const currentCardKeys = new Set();
  const you = state.seats.find((seat) => seat && seat.playerId === state.yourPlayerId);
  if (!you) {
    return;
  }

  elements.roomCodeLabel.textContent = state.roomCode;
  elements.blindsLabel.textContent = `Blinds ${state.smallBlind} / ${state.bigBlind}`;

  renderCenter(state, currentCardKeys);
  renderSeats(state, you, currentCardKeys);
  renderActionBar(state, you);

  previousCardKeys = currentCardKeys;
}

function renderCenter(state, currentCardKeys) {
  elements.potLabel.textContent = state.potTotal > 0 ? `Pot ${formatChips(state.potTotal)}` : '';

  elements.communityCards.replaceChildren(
    ...state.communityCards.map((card, cardIndex) => {
      const cardKey = `community:${state.handNumber}:${cardIndex}`;
      const cardElement = createCardElement(card, cardKey, currentCardKeys);
      cardElement.style.animationDelay = `${cardIndex * 0.12}s`;
      return cardElement;
    }),
  );

  elements.resultBanner.hidden = state.result === null;
  if (state.result) {
    elements.resultBanner.replaceChildren(
      ...state.result.winners.map((winner) => {
        const handText = winner.handName ? ` with ${winner.handName}` : '';
        return createElement(
          'div',
          'result-line',
          `${winner.name} wins ${formatChips(winner.amount)}${handText}`,
        );
      }),
    );
  }

  let centerMessage = '';
  if (state.stage === 'waiting') {
    const playerCount = state.seats.filter(Boolean).length;
    centerMessage =
      playerCount < 2 ? 'Share the invite link to bring your friends in' : 'Waiting for the host to start';
  }
  elements.centerMessage.textContent = centerMessage;
}

function renderSeats(state, you, currentCardKeys) {
  const isTallScreen = window.matchMedia('(max-aspect-ratio: 4/5)').matches;
  const seatPositions = isTallScreen ? SEAT_POSITIONS_TALL : SEAT_POSITIONS_WIDE;
  const winnerIds = state.result ? state.result.winners.map((winner) => winner.playerId) : [];
  const seatElements = [];

  for (const seat of state.seats) {
    if (!seat) {
      continue;
    }
    // Rotate the table so that your own seat is at the bottom.
    const slotIndex = (seat.seatIndex - you.seatIndex + SEAT_COUNT) % SEAT_COUNT;
    const position = seatPositions[slotIndex];
    const isYou = seat.playerId === state.yourPlayerId;
    const isCurrentTurn = seat.seatIndex === state.currentSeatIndex;

    const seatElement = createElement('div', 'seat');
    seatElement.style.left = `${position.left}%`;
    seatElement.style.top = `${position.top}%`;
    seatElement.classList.toggle('is-you', isYou);
    seatElement.classList.toggle('is-current', isCurrentTurn);
    seatElement.classList.toggle('is-folded', seat.isInHand && seat.hasFolded);
    seatElement.classList.toggle('is-away', !seat.isConnected);
    seatElement.classList.toggle('is-winner', winnerIds.includes(seat.playerId));

    const cardsElement = createElement('div', 'seat-cards');
    if (seat.hasCards) {
      for (let cardIndex = 0; cardIndex < 2; cardIndex++) {
        const card = seat.holeCards ? seat.holeCards[cardIndex] : null;
        const side = card ? 'front' : 'back';
        const cardKey = `hole:${state.handNumber}:${seat.playerId}:${cardIndex}:${side}`;
        cardsElement.append(createCardElement(card, cardKey, currentCardKeys));
      }
    }

    const plateElement = createElement('div', 'seat-plate');
    plateElement.append(
      createElement('div', 'seat-name', seat.name),
      createElement('div', 'seat-chips', formatChips(seat.chips)),
    );

    let statusText = '';
    if (!seat.isConnected) {
      statusText = 'Away';
    } else if (seat.isAllIn) {
      statusText = 'All-in';
    } else if (seat.isInHand && seat.hasFolded) {
      statusText = 'Folded';
    } else if (seat.chips === 0 && !seat.hasCards) {
      statusText = 'Out of chips';
    } else if (seat.playerId === state.hostPlayerId && state.stage === 'waiting') {
      statusText = 'Host';
    }
    if (statusText) {
      plateElement.append(createElement('div', 'seat-status', statusText));
    }

    if (isCurrentTurn && turnDeadline !== null) {
      const secondsRemaining = Math.max(0, (turnDeadline - Date.now()) / 1000);
      const timerElement = createElement('div', 'turn-timer');
      const timerFill = createElement('div', 'turn-timer-fill');
      timerElement.append(timerFill);
      plateElement.append(timerElement);
      const startPercent = Math.min(100, (secondsRemaining / state.turnSecondsTotal) * 100);
      timerFill.animate([{ width: `${startPercent}%` }, { width: '0%' }], {
        duration: secondsRemaining * 1000,
        fill: 'forwards',
      });
    }

    const hasButtons = state.stage !== 'waiting';
    if (hasButtons && seat.seatIndex === state.dealerSeatIndex) {
      plateElement.append(createElement('div', 'position-badge dealer', 'D'));
    } else if (hasButtons && seat.seatIndex === state.bigBlindSeatIndex) {
      plateElement.append(createElement('div', 'position-badge blind', 'BB'));
    } else if (hasButtons && seat.seatIndex === state.smallBlindSeatIndex) {
      plateElement.append(createElement('div', 'position-badge blind', 'SB'));
    }

    seatElement.append(cardsElement, plateElement);
    seatElements.push(seatElement);

    if (seat.betThisRound > 0) {
      const betElement = createElement('div', 'seat-bet');
      betElement.append(
        createElement('span', 'chip-icon'),
        createElement('span', '', formatChips(seat.betThisRound)),
      );
      const betLeft = position.left + (TABLE_CENTER.left - position.left) * BET_DISTANCE_TOWARD_CENTER;
      const betTop = position.top + (TABLE_CENTER.top - position.top) * BET_DISTANCE_TOWARD_CENTER;
      betElement.style.left = `${betLeft}%`;
      betElement.style.top = `${betTop}%`;
      seatElements.push(betElement);
    }
  }

  elements.seatLayer.replaceChildren(...seatElements);
}

// ---------- Action bar ----------

function renderActionBar(state, you) {
  // Rebuild the bar only when its content changes, so the raise slider is not
  // reset while you are dragging it.
  const actionKey = JSON.stringify([
    state.stage,
    state.turnNumber,
    state.yourOptions,
    state.yourHandName,
    state.hostPlayerId,
    state.canStartHand,
    state.currentSeatIndex,
    you.chips,
    you.hasFolded,
  ]);
  if (actionKey === renderedActionKey) {
    return;
  }
  renderedActionKey = actionKey;

  const bar = elements.actionBar;
  bar.replaceChildren();
  const isHost = state.yourPlayerId === state.hostPlayerId;
  const isBetweenHands = state.stage === 'waiting' || state.stage === 'showdown';

  if (state.yourHandName) {
    bar.append(createElement('div', 'hand-name', `Your hand: ${state.yourHandName}`));
  }

  const buttonRow = createElement('div', 'action-buttons');
  bar.append(buttonRow);

  if (isBetweenHands && you.chips === 0) {
    const rebuyButton = createElement(
      'button',
      'button primary',
      `Rebuy ${formatChips(state.startingChips)} chips`,
    );
    rebuyButton.addEventListener('click', () => sendMessage({ type: 'rebuy' }));
    buttonRow.append(rebuyButton);
  }

  if (state.stage === 'waiting') {
    if (isHost) {
      const startButton = createElement('button', 'button primary', 'Start game');
      startButton.disabled = !state.canStartHand;
      startButton.addEventListener('click', () => sendMessage({ type: 'start' }));
      buttonRow.append(startButton);
      if (!state.canStartHand) {
        bar.append(createElement('div', 'status-text', 'You need at least two players with chips.'));
      }
    } else {
      bar.append(createElement('div', 'status-text', 'Waiting for the host to start the game…'));
    }
    return;
  }

  if (state.stage === 'showdown') {
    bar.append(createElement('div', 'status-text', 'Next hand starts in a moment…'));
    return;
  }

  if (!state.yourOptions) {
    const currentSeat = state.seats[state.currentSeatIndex];
    const waitingText = you.hasFolded
      ? 'You folded. Waiting for the next hand…'
      : !you.isInHand
        ? 'You will be dealt in next hand.'
        : `Waiting for ${currentSeat ? currentSeat.name : 'the next player'}…`;
    bar.append(createElement('div', 'status-text', waitingText));
    return;
  }

  renderTurnControls(state, you, bar, buttonRow);
}

function renderTurnControls(state, you, bar, buttonRow) {
  const options = state.yourOptions;
  const sendAction = (action, amount) => sendMessage({ type: 'action', action, amount });

  const foldButton = createElement('button', 'button danger', 'Fold');
  foldButton.addEventListener('click', () => sendAction('fold'));
  buttonRow.append(foldButton);

  if (options.canCheck) {
    const checkButton = createElement('button', 'button secondary', 'Check');
    checkButton.addEventListener('click', () => sendAction('check'));
    buttonRow.append(checkButton);
  } else {
    const isAllInCall = options.callAmount === you.chips;
    const callText = isAllInCall
      ? `Call all-in ${formatChips(options.callAmount)}`
      : `Call ${formatChips(options.callAmount)}`;
    const callButton = createElement('button', 'button secondary', callText);
    callButton.addEventListener('click', () => sendAction('call'));
    buttonRow.append(callButton);
  }

  if (!options.canRaise) {
    return;
  }

  const raiseVerb = state.currentBet === 0 ? 'Bet' : 'Raise to';
  const raiseButton = createElement('button', 'button primary');
  buttonRow.append(raiseButton);

  const raiseRow = createElement('div', 'raise-row');
  const slider = createElement('input', 'raise-slider');
  slider.type = 'range';
  slider.min = options.minimumRaiseTo;
  slider.max = options.maximumRaiseTo;
  slider.step = 1;
  const amountInput = createElement('input', 'raise-amount');
  amountInput.type = 'number';
  amountInput.min = options.minimumRaiseTo;
  amountInput.max = options.maximumRaiseTo;
  amountInput.setAttribute('aria-label', 'Raise amount');

  const clampAmount = (amount) =>
    Math.max(options.minimumRaiseTo, Math.min(options.maximumRaiseTo, Math.round(amount) || 0));
  const setRaiseAmount = (amount, shouldUpdateInput = true) => {
    const raiseAmount = clampAmount(amount);
    slider.value = raiseAmount;
    if (shouldUpdateInput) {
      amountInput.value = raiseAmount;
    }
    raiseButton.textContent =
      raiseAmount === options.maximumRaiseTo
        ? `All-in ${formatChips(raiseAmount)}`
        : `${raiseVerb} ${formatChips(raiseAmount)}`;
  };

  slider.addEventListener('input', () => setRaiseAmount(Number(slider.value)));
  // While typing, do not rewrite the box; it is corrected when you leave it.
  amountInput.addEventListener('input', () => setRaiseAmount(Number(amountInput.value), false));
  amountInput.addEventListener('change', () => setRaiseAmount(Number(amountInput.value)));
  raiseButton.addEventListener('click', () => sendAction('raise', Number(slider.value)));

  // A pot-sized raise: call first, then raise by the size of the pot after the call.
  const potAfterCall = state.potTotal + options.callAmount;
  const quickAmounts = [
    { label: 'Min', amount: options.minimumRaiseTo },
    { label: '½ Pot', amount: state.currentBet + potAfterCall / 2 },
    { label: 'Pot', amount: state.currentBet + potAfterCall },
    { label: 'All-in', amount: options.maximumRaiseTo },
  ];
  const quickRow = createElement('div', 'quick-row');
  for (const quickAmount of quickAmounts) {
    const quickButton = createElement('button', 'button small ghost', quickAmount.label);
    quickButton.addEventListener('click', () => setRaiseAmount(quickAmount.amount));
    quickRow.append(quickButton);
  }

  raiseRow.append(quickRow, slider, amountInput);
  bar.append(raiseRow);
  setRaiseAmount(options.minimumRaiseTo);
}

// ---------- Start ----------

window.addEventListener('resize', () => {
  if (latestState) {
    renderTable();
  }
});

setUpLobby();
