const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');
const { PokerTable } = require('./game');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIRECTORY = path.join(__dirname, '..', 'public');
const STATIC_FILES = {
  '/': { fileName: 'index.html', contentType: 'text/html; charset=utf-8' },
  '/style.css': { fileName: 'style.css', contentType: 'text/css; charset=utf-8' },
  '/client.js': { fileName: 'client.js', contentType: 'text/javascript; charset=utf-8' },
};

const TURN_SECONDS = 30;
const DISCONNECTED_TURN_SECONDS = 3;
const SHOWDOWN_DELAY_MILLISECONDS = 8000;
const FOLD_WIN_DELAY_MILLISECONDS = 4000;
const DISCONNECTED_REMOVAL_MILLISECONDS = 5 * 60 * 1000;
const KEEP_ALIVE_MILLISECONDS = 25 * 1000;
const MAXIMUM_MESSAGE_BYTES = 2048;
const MAXIMUM_ROOM_COUNT = 500;

const ROOM_CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const ROOM_CODE_LENGTH = 6;
const MAXIMUM_NAME_LENGTH = 14;
const MINIMUM_STARTING_CHIPS = 100;
const MAXIMUM_STARTING_CHIPS = 1000000;
const MINIMUM_BIG_BLIND = 2;

const roomByCode = new Map();

// ---------- Rooms ----------

function createRoomCode() {
  let roomCode;
  do {
    roomCode = '';
    for (let letterCount = 0; letterCount < ROOM_CODE_LENGTH; letterCount++) {
      roomCode += ROOM_CODE_LETTERS[crypto.randomInt(ROOM_CODE_LETTERS.length)];
    }
  } while (roomByCode.has(roomCode));
  return roomCode;
}

function createRoom(startingChips, bigBlind) {
  if (roomByCode.size >= MAXIMUM_ROOM_COUNT) {
    throw new Error('The server is full. Please try again later.');
  }
  const isValidStartingChips =
    Number.isInteger(startingChips) &&
    startingChips >= MINIMUM_STARTING_CHIPS &&
    startingChips <= MAXIMUM_STARTING_CHIPS;
  if (!isValidStartingChips) {
    throw new Error(
      `Starting chips must be between ${MINIMUM_STARTING_CHIPS} and ${MAXIMUM_STARTING_CHIPS}.`,
    );
  }
  const isValidBigBlind =
    Number.isInteger(bigBlind) && bigBlind >= MINIMUM_BIG_BLIND && bigBlind <= startingChips;
  if (!isValidBigBlind) {
    throw new Error(`The big blind must be between ${MINIMUM_BIG_BLIND} and the starting chips.`);
  }

  const room = {
    roomCode: createRoomCode(),
    table: new PokerTable({ startingChips, smallBlind: Math.floor(bigBlind / 2), bigBlind }),
    hostPlayerId: null,
    socketByPlayerId: new Map(),
    playerIdByToken: new Map(),
    removalTimerByPlayerId: new Map(),
    turnTimer: null,
    turnTimerKey: null,
    turnDeadline: null,
    nextHandTimer: null,
  };
  roomByCode.set(room.roomCode, room);
  return room;
}

function cleanName(rawName) {
  const name = typeof rawName === 'string' ? rawName.trim().slice(0, MAXIMUM_NAME_LENGTH) : '';
  if (name === '') {
    throw new Error('Please enter your name.');
  }
  return name;
}

// Seats the socket's player in the room, or reconnects them when their saved
// token matches a player who is still seated.
function joinRoom(room, socket, rawName, playerToken) {
  const knownPlayerId = room.playerIdByToken.get(playerToken);
  let player = knownPlayerId ? room.table.findPlayer(knownPlayerId) : null;
  let token = playerToken;

  if (player && !player.hasLeft) {
    player.isConnected = true;
    clearTimeout(room.removalTimerByPlayerId.get(player.playerId));
    room.removalTimerByPlayerId.delete(player.playerId);
    const previousSocket = room.socketByPlayerId.get(player.playerId);
    if (previousSocket && previousSocket !== socket) {
      previousSocket.session = null;
      previousSocket.close();
    }
  } else {
    player = room.table.addPlayer(crypto.randomUUID(), cleanName(rawName));
    token = crypto.randomUUID();
    room.playerIdByToken.set(token, player.playerId);
  }

  room.socketByPlayerId.set(player.playerId, socket);
  socket.session = { room, playerId: player.playerId };
  send(socket, { type: 'joined', roomCode: room.roomCode, playerToken: token });
}

function removePlayerFromRoom(room, playerId) {
  room.table.removePlayer(playerId);
  room.socketByPlayerId.delete(playerId);
  clearTimeout(room.removalTimerByPlayerId.get(playerId));
  room.removalTimerByPlayerId.delete(playerId);
  for (const [token, tokenPlayerId] of room.playerIdByToken) {
    if (tokenPlayerId === playerId) {
      room.playerIdByToken.delete(token);
    }
  }
}

// Call after every change to a room: it keeps the host and timers correct and
// sends the new state to everyone.
function afterRoomChange(room) {
  const connectedPlayers = room.table.getPlayers().filter((player) => player.isConnected);
  const isHostConnected = connectedPlayers.some((player) => player.playerId === room.hostPlayerId);
  if (!isHostConnected) {
    room.hostPlayerId = connectedPlayers.length > 0 ? connectedPlayers[0].playerId : null;
  }

  if (room.table.getPlayers().every((player) => player.hasLeft)) {
    clearTimeout(room.turnTimer);
    clearTimeout(room.nextHandTimer);
    roomByCode.delete(room.roomCode);
    return;
  }

  scheduleTimers(room);
  broadcastState(room);
}

function scheduleTimers(room) {
  const { table } = room;

  if (!table.isBettingStage()) {
    clearTimeout(room.turnTimer);
    room.turnTimerKey = null;
    room.turnDeadline = null;
    if (table.stage === 'showdown' && room.nextHandTimer === null) {
      const wasShowdown = table.lastResult.revealedPlayerIds.length > 0;
      const delay = wasShowdown ? SHOWDOWN_DELAY_MILLISECONDS : FOLD_WIN_DELAY_MILLISECONDS;
      room.nextHandTimer = setTimeout(() => {
        room.nextHandTimer = null;
        if (table.canStartHand()) {
          table.startHand();
        } else {
          table.stage = 'waiting';
        }
        afterRoomChange(room);
      }, delay);
    }
    return;
  }

  clearTimeout(room.nextHandTimer);
  room.nextHandTimer = null;

  // Restart the turn timer only when the turn itself changed, not when
  // something unrelated happened (for example another player joining).
  const currentPlayer = table.seats[table.currentSeatIndex];
  const turnTimerKey = `${table.turnNumber}:${currentPlayer.isConnected}`;
  if (turnTimerKey === room.turnTimerKey) {
    return;
  }
  clearTimeout(room.turnTimer);
  room.turnTimerKey = turnTimerKey;
  const turnSeconds = currentPlayer.isConnected ? TURN_SECONDS : DISCONNECTED_TURN_SECONDS;
  room.turnDeadline = Date.now() + turnSeconds * 1000;
  room.turnTimer = setTimeout(() => {
    // Out of time: check when that is free, otherwise fold.
    const options = table.getActionOptions(currentPlayer);
    table.applyAction(currentPlayer.playerId, options.canCheck ? 'check' : 'fold');
    afterRoomChange(room);
  }, turnSeconds * 1000);
}

function broadcastState(room) {
  const turnSecondsRemaining =
    room.turnDeadline === null ? null : Math.max(0, (room.turnDeadline - Date.now()) / 1000);
  for (const [playerId, socket] of room.socketByPlayerId) {
    send(socket, {
      type: 'state',
      state: {
        ...room.table.getStateFor(playerId),
        roomCode: room.roomCode,
        hostPlayerId: room.hostPlayerId,
        canStartHand: room.table.canStartHand(),
        turnSecondsRemaining,
        turnSecondsTotal: TURN_SECONDS,
      },
    });
  }
}

function send(socket, message) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

// ---------- Messages from the browser ----------

function handleMessage(socket, message) {
  const isJoining = message.type === 'create' || message.type === 'join';
  if (isJoining && socket.session) {
    throw new Error('You are already at a table.');
  }

  if (message.type === 'create') {
    const name = cleanName(message.name);
    const room = createRoom(message.startingChips, message.bigBlind);
    joinRoom(room, socket, name, null);
    afterRoomChange(room);
    return;
  }

  if (message.type === 'join') {
    const roomCode = typeof message.roomCode === 'string' ? message.roomCode.toUpperCase() : '';
    const room = roomByCode.get(roomCode);
    if (!room) {
      throw new Error('This table does not exist any more. Please create a new one.');
    }
    joinRoom(room, socket, message.name, message.playerToken);
    afterRoomChange(room);
    return;
  }

  if (!socket.session) {
    throw new Error('Please join a table first.');
  }
  const { room, playerId } = socket.session;

  if (message.type === 'start') {
    if (playerId !== room.hostPlayerId) {
      throw new Error('Only the host can start the game.');
    }
    room.table.startHand();
  } else if (message.type === 'action') {
    room.table.applyAction(playerId, message.action, message.amount);
  } else if (message.type === 'rebuy') {
    room.table.rebuy(playerId);
  } else if (message.type === 'leave') {
    socket.session = null;
    removePlayerFromRoom(room, playerId);
  } else {
    throw new Error('Unknown message.');
  }
  afterRoomChange(room);
}

function handleDisconnect(socket) {
  if (!socket.session) {
    return;
  }
  const { room, playerId } = socket.session;
  const player = room.table.findPlayer(playerId);
  if (!player) {
    return;
  }
  // The player keeps their seat for a while so they can come back with the same link.
  player.isConnected = false;
  room.socketByPlayerId.delete(playerId);
  room.removalTimerByPlayerId.set(
    playerId,
    setTimeout(() => {
      removePlayerFromRoom(room, playerId);
      afterRoomChange(room);
    }, DISCONNECTED_REMOVAL_MILLISECONDS),
  );
  afterRoomChange(room);
}

// ---------- Web server ----------

const httpServer = http.createServer((request, response) => {
  const requestPath = new URL(request.url, 'http://localhost').pathname;
  const staticFile = STATIC_FILES[requestPath];
  if (!staticFile) {
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('Not found');
    return;
  }
  fs.readFile(path.join(PUBLIC_DIRECTORY, staticFile.fileName), (error, content) => {
    if (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain' });
      response.end('Server error');
      return;
    }
    response.writeHead(200, { 'Content-Type': staticFile.contentType, 'Cache-Control': 'no-cache' });
    response.end(content);
  });
});

const webSocketServer = new WebSocketServer({
  server: httpServer,
  maxPayload: MAXIMUM_MESSAGE_BYTES,
});

webSocketServer.on('connection', (socket) => {
  socket.session = null;
  socket.on('message', (rawMessage) => {
    try {
      handleMessage(socket, JSON.parse(rawMessage));
    } catch (error) {
      send(socket, { type: 'error', message: error.message });
    }
  });
  socket.on('close', () => handleDisconnect(socket));
  socket.on('error', () => socket.close());
});

// Regular pings stop hosting providers from closing quiet connections.
setInterval(() => {
  for (const socket of webSocketServer.clients) {
    socket.ping();
  }
}, KEEP_ALIVE_MILLISECONDS);

httpServer.listen(PORT, () => {
  console.log(`Poker server is running on http://localhost:${PORT}`);
});
