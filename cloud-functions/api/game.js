import { randomBytes } from "node:crypto";
// Modified for Moon GameHub. See ../../README.md.
import { store } from "../../store.js";
const DISCONNECT_GRACE_MS = 60_000;
const TURN_LIMIT_MS = 60_000;
const LOCK_TTL_MS = 4_000;
const DEFAULT_GAME_TYPE = "gomoku";
const GO_KOMI = 7.5;
const AI_GAME_TYPES = new Set(["gomoku", "go", "reversi", "connect6"]);
const COLORS = {
  black: "black",
  white: "white"
};

const GAME_CONFIGS = {
  gomoku: {
    boardSize: 15,
    boardKind: "intersection",
    winLength: 5
  },
  go: {
    boardSize: 19,
    boardKind: "intersection"
  },
  reversi: {
    boardSize: 8,
    boardKind: "cells"
  },
  connect6: {
    boardSize: 19,
    boardKind: "intersection",
    winLength: 6
  }
};

const DIRECTIONS_8 = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1]
];

const DIRECTIONS_4 = [
  [-1, 0],
  [0, 1],
  [1, 0],
  [0, -1]
];

const LINE_DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1]
];


export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const clientId = normalizeClientId(url.searchParams.get("clientId"));
  const requestedRoomId = normalizeRoomId(url.searchParams.get("roomId"));

  if (!clientId) {
    return jsonResponse([errorMessage("missing_client_id", "Missing client identity.")], 400);
  }

  const player = await touchPlayer(store, clientId);
  return jsonResponse(await currentMessages(store, player, requestedRoomId));
}

export async function onRequestPost(context) {
  let message;

  try {
    message = await context.request.json();
  } catch {
    return jsonResponse([errorMessage("invalid_json", "Invalid message format.")], 400);
  }

  const clientId = normalizeClientId(message?.clientId);
  if (!clientId) {
    return jsonResponse([errorMessage("missing_client_id", "Missing client identity.")], 400);
  }

  const player = await touchPlayer(store, clientId);
  return jsonResponse(await routeMessage(store, player, message));
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders()
  });
}

async function routeMessage(store, player, message) {
  const payload = message.payload || {};

  switch (message.type) {
    case "match:join":
      return joinPublicMatch(store, player, payload.gameType);
    case "room:create":
      return createPrivateRoom(store, player, payload.gameType);
    case "room:join":
      return joinPrivateRoom(store, player, payload.roomId);
    case "ai:create":
      return createAiRoom(store, player, payload.gameType, payload.humanColor);
    case "ai:move":
      return placeAiMove(store, player, payload);
    case "ai:pass":
      return passAiMove(store, player);
    case "move:place":
      return placeMove(store, player, payload);
    case "move:pass":
      return passMove(store, player);
    case "move:resign":
      return resignGame(store, player);
    case "game:restart":
      return requestRestart(store, player, "normal");
    case "game:swap_restart":
      return requestRestart(store, player, "swap");
    case "room:leave":
      return leaveCurrentContext(store, player);
    case "ping":
      return [{ type: "pong", payload: { now: Date.now() } }];
    default:
      return [errorMessage("unknown_message", "Unknown action.")];
  }
}

async function currentMessages(store, player, requestedRoomId) {
  if (player.roomId) {
    const lock = await acquireLock(store, roomLockName(player.roomId));
    try {
      const room = await getRoom(store, player.roomId);
      if (room && isRoomPlayer(room, player.id)) {
        const updatedRoom = await applyRoomTimeouts(store, room);
        await setPlayer(store, player);
        return [{ type: "state:update", payload: await roomPayload(store, updatedRoom, player.id) }];
      }
    } finally {
      await releaseLock(store, lock);
    }

    player.roomId = null;
    player.color = null;
    await setPlayer(store, player);
  }

  if (player.queued) {
    const gameType = normalizeGameType(player.queueGameType) || DEFAULT_GAME_TYPE;
    const matched = await tryMatchQueuedPlayers(store, player.id, gameType);
    if (matched) {
      return [{ type: "state:update", payload: await roomPayload(store, matched, player.id) }];
    }

    return [{
      type: "queue:update",
      payload: { code: "searching_opponent", gameType, message: "Looking for an opponent." }
    }];
  }

  if (requestedRoomId && !(await getRoom(store, requestedRoomId))) {
    return [errorMessage("room_not_found", "Room not found or already closed.")];
  }

  return [];
}

async function joinPublicMatch(store, player, rawGameType) {
  const gameType = normalizeGameType(rawGameType);
  if (!gameType) {
    return [errorMessage("invalid_game", "Invalid game type.")];
  }

  if (player.roomId) {
    const room = await getRoom(store, player.roomId);
    if (room && isRoomPlayer(room, player.id)) {
      return [{ type: "state:update", payload: await roomPayload(store, room, player.id) }];
    }
  }

  await detachFromRoom(store, player);
  if (player.queued && player.queueGameType !== gameType) {
    await leaveQueue(store, player);
  }

  if (!player.queued || !player.queueKey) {
    const ticket = createQueueTicket(player.id, gameType);
    await setQueueTicket(store, ticket);
    player.queued = true;
    player.queueKey = ticket.key;
    player.queueGameType = gameType;
    player.roomId = null;
    player.color = null;
    await setPlayer(store, player);
  }

  const matched = await tryMatchQueuedPlayers(store, player.id, gameType);
  if (matched) {
    return [{ type: "state:update", payload: await roomPayload(store, matched, player.id) }];
  }

  return [{
    type: "queue:update",
    payload: { code: "searching_opponent", gameType, message: "Looking for an opponent." }
  }];
}

async function createPrivateRoom(store, player, rawGameType) {
  const gameType = normalizeGameType(rawGameType);
  if (!gameType) {
    return [errorMessage("invalid_game", "Invalid game type.")];
  }

  await leaveQueue(store, player);
  await detachFromRoom(store, player);

  const room = createRoom("private", gameType);
  room.blackPlayerId = player.id;
  player.roomId = room.id;
  player.color = COLORS.black;
  player.queued = false;
  player.queueKey = null;
  player.queueGameType = null;

  await setRoom(store, room);
  await setPlayer(store, player);

  return [{ type: "state:update", payload: await roomPayload(store, room, player.id) }];
}

async function createAiRoom(store, player, rawGameType, rawHumanColor) {
  const gameType = normalizeGameType(rawGameType);
  if (!gameType) {
    return [errorMessage("invalid_game", "Invalid game type.")];
  }

  if (!AI_GAME_TYPES.has(gameType)) {
    return [errorMessage("ai_unsupported", "AI opponent is not available for this game.")];
  }

  const humanColor = normalizeColor(rawHumanColor);
  if (!humanColor) {
    return [errorMessage("invalid_color", "Invalid player color.")];
  }

  await leaveQueue(store, player);
  await detachFromRoom(store, player);

  const room = createRoom("ai", gameType);
  const aiPlayerId = createAiPlayerId(room.id);
  const aiColor = oppositeColor(humanColor);

  room.aiPlayerId = aiPlayerId;
  room.aiColor = aiColor;
  room.blackPlayerId = humanColor === COLORS.black ? player.id : aiPlayerId;
  room.whitePlayerId = humanColor === COLORS.white ? player.id : aiPlayerId;
  room.status = "playing";
  room.turnStartedAt = Date.now();
  room.updatedAt = nextRoomUpdatedAt(room);

  player.roomId = room.id;
  player.color = humanColor;
  player.queued = false;
  player.queueKey = null;
  player.queueGameType = null;

  await setRoom(store, room);
  await setPlayer(store, player);

  return [{ type: "state:update", payload: await roomPayload(store, room, player.id) }];
}

async function joinPrivateRoom(store, player, rawRoomId) {
  const roomId = normalizeRoomId(rawRoomId);
  if (!roomId) {
    return [errorMessage("invalid_room", "Invalid room number.")];
  }

  const lock = await acquireLock(store, roomLockName(roomId));
  if (!lock) {
    return [errorMessage("lock_busy", "Room is busy. Try again shortly.")];
  }

  try {
    const room = await getRoom(store, roomId);
    if (!room) {
      return [errorMessage("room_not_found", "Room not found or already closed.")];
    }

    if (room.winner && !isRoomPlayer(room, player.id)) {
      return [errorMessage("room_finished", "This room's game has ended.")];
    }

    await leaveQueue(store, player);

    if (isRoomPlayer(room, player.id)) {
      player.roomId = room.id;
      player.color = colorForPlayer(room, player.id);
      await setPlayer(store, player);
      const updatedRoom = await applyRoomTimeouts(store, room);
      return [{ type: "state:update", payload: await roomPayload(store, updatedRoom, player.id) }];
    }

    if (room.blackPlayerId && room.whitePlayerId) {
      return [errorMessage("room_full", "The room is full.")];
    }

    await detachFromRoom(store, player);

    if (!room.blackPlayerId) {
      room.blackPlayerId = player.id;
      player.color = COLORS.black;
    } else {
      room.whitePlayerId = player.id;
      player.color = COLORS.white;
    }

    player.roomId = room.id;
    player.queued = false;
    player.queueKey = null;
    player.queueGameType = null;
    const wasWaiting = room.status === "waiting";
    room.status = room.blackPlayerId && room.whitePlayerId ? "playing" : "waiting";
    if (wasWaiting && room.status === "playing") {
      room.turnStartedAt = Date.now();
    }
    room.updatedAt = nextRoomUpdatedAt(room);

    await setRoom(store, room);
    await setPlayer(store, player);
    return [{ type: "state:update", payload: await roomPayload(store, room, player.id) }];
  } finally {
    await releaseLock(store, lock);
  }
}

async function placeMove(store, player, payload) {
  return mutatePlayerRoom(store, player, (room) => {
    const color = colorForPlayer(room, player.id);
    if (room.turn !== color) {
      return errorMessage("not_your_turn", "It is not your turn yet.");
    }

    const error = applyPlaceMove(room, color, payload || {});
    return error ? errorMessage(error, messageForError(error)) : null;
  });
}

async function placeAiMove(store, player, payload) {
  return mutateAiRoom(store, player, (room) => {
    const error = applyPlaceMove(room, room.aiColor, payload || {});
    return error ? errorMessage(error, messageForError(error)) : null;
  });
}

async function passAiMove(store, player) {
  return mutateAiRoom(store, player, (room) => {
    if (room.gameType !== "go") {
      return errorMessage("invalid_action", "This game does not support passing.");
    }

    applyGoPass(room, room.aiColor);
    return null;
  });
}

async function mutateAiRoom(store, player, mutator) {
  const roomId = player.roomId;
  if (!roomId) {
    return [errorMessage("not_in_room", "You are not in a room.")];
  }

  const lock = await acquireLock(store, roomLockName(roomId));
  if (!lock) {
    return [errorMessage("lock_busy", "Room is busy. Try again shortly.")];
  }

  try {
    let room = await getRoom(store, roomId);
    if (!room || !isRoomPlayer(room, player.id)) {
      player.roomId = null;
      player.color = null;
      await setPlayer(store, player);
      return [errorMessage("room_not_found", "Room not found or already closed.")];
    }

    room = await applyRoomTimeouts(store, room);

    if (room.type !== "ai" || !room.aiPlayerId || !room.aiColor) {
      return [errorMessage("invalid_action", "AI opponent is not available in this room.")];
    }

    if (colorForPlayer(room, player.id) === room.aiColor) {
      return [errorMessage("invalid_action", "AI moves can only be submitted by the human player.")];
    }

    if (room.winner) {
      return [errorMessage("game_finished", "The game has ended.")];
    }

    if (room.status !== "playing") {
      return [errorMessage("waiting_for_opponent", "Wait for the game to start first.")];
    }

    if (room.turn !== room.aiColor) {
      return [errorMessage("not_your_turn", "It is not the AI turn yet.")];
    }

    const maybeError = mutator(room);
    if (maybeError) {
      return [maybeError];
    }

    if (!room.winner) {
      room.turnStartedAt = Date.now();
    }
    room.updatedAt = nextRoomUpdatedAt(room);
    await setRoom(store, room);
    return [{ type: "state:update", payload: await roomPayload(store, room, player.id) }];
  } finally {
    await releaseLock(store, lock);
  }
}

async function passMove(store, player) {
  return mutatePlayerRoom(store, player, (room) => {
    if (room.gameType !== "go") {
      return errorMessage("invalid_action", "This game does not support passing.");
    }

    const color = colorForPlayer(room, player.id);
    if (room.turn !== color) {
      return errorMessage("not_your_turn", "It is not your turn yet.");
    }

    applyGoPass(room, color);
    return null;
  });
}

async function resignGame(store, player) {
  return mutatePlayerRoom(store, player, (room) => {
    const color = colorForPlayer(room, player.id);
    const opponent = oppositeColor(color);
    room.winner = { color: opponent, reason: "resign" };
    room.winningLine = [];
    room.status = "finished";
    room.updatedAt = nextRoomUpdatedAt(room);
    return null;
  });
}

async function mutatePlayerRoom(store, player, mutator) {
  const roomId = player.roomId;
  if (!roomId) {
    return [errorMessage("not_in_room", "You are not in a room.")];
  }

  const lock = await acquireLock(store, roomLockName(roomId));
  if (!lock) {
    return [errorMessage("lock_busy", "Room is busy. Try again shortly.")];
  }

  try {
    let room = await getRoom(store, roomId);
    if (!room || !isRoomPlayer(room, player.id)) {
      player.roomId = null;
      player.color = null;
      await setPlayer(store, player);
      return [errorMessage("room_not_found", "Room not found or already closed.")];
    }

    room = await applyRoomTimeouts(store, room);

    if (room.status !== "playing") {
      return [errorMessage("waiting_for_opponent", "Wait for your opponent to join first.")];
    }

    if (room.winner) {
      return [errorMessage("game_finished", "The game has ended.")];
    }

    const maybeError = mutator(room);
    if (maybeError) {
      return [maybeError];
    }

    if (!room.winner) {
      room.turnStartedAt = Date.now();
    }
    room.updatedAt = nextRoomUpdatedAt(room);
    await setRoom(store, room);
    return [{ type: "state:update", payload: await roomPayload(store, room, player.id) }];
  } finally {
    await releaseLock(store, lock);
  }
}

function applyPlaceMove(room, color, payload) {
  switch (room.gameType) {
    case "gomoku":
      return applyGomokuMove(room, color, payload);
    case "go":
      return applyGoMove(room, color, payload);
    case "reversi":
      return applyReversiMove(room, color, payload);
    case "connect6":
      return applyConnect6Move(room, color, payload);
    default:
      return "invalid_game";
  }
}

function applyGomokuMove(room, color, payload) {
  const point = normalizePoint(payload);
  const error = validateEmptyPoint(room, point);
  if (error) {
    return error;
  }

  room.board[point.row][point.col] = color;
  room.moves.push({ type: "place", points: [point], color, at: Date.now() });
  room.lastPassColor = null;
  room.passCount = 0;

  const winningLine = findWinningLine(room.board, point.row, point.col, color, GAME_CONFIGS.gomoku.winLength);
  if (winningLine) {
    room.winner = { color, reason: "line" };
    room.winningLine = winningLine;
    room.status = "finished";
  } else if (isBoardFull(room.board)) {
    room.winner = { color: null, reason: "draw" };
    room.winningLine = [];
    room.status = "finished";
  } else {
    room.turn = oppositeColor(color);
  }

  return null;
}

function applyConnect6Move(room, color, payload) {
  const expectedStones = connect6ExpectedStones(room);
  const points = normalizePoints(payload);
  if (points.length !== expectedStones) {
    return "invalid_move_count";
  }

  const seen = new Set();
  for (const point of points) {
    const key = pointKey(point);
    if (seen.has(key)) {
      return "invalid_move";
    }
    seen.add(key);

    const error = validateEmptyPoint(room, point);
    if (error) {
      return error;
    }
  }

  for (const point of points) {
    room.board[point.row][point.col] = color;
  }
  room.moves.push({ type: "place", points, color, at: Date.now() });
  room.lastPassColor = null;
  room.passCount = 0;

  const winningLine = findWinningLineForPoints(room.board, points, color, GAME_CONFIGS.connect6.winLength);
  if (winningLine) {
    room.winner = { color, reason: "line" };
    room.winningLine = winningLine;
    room.status = "finished";
  } else if (isBoardFull(room.board)) {
    room.winner = { color: null, reason: "draw" };
    room.winningLine = [];
    room.status = "finished";
  } else {
    room.turn = oppositeColor(color);
  }

  return null;
}

function applyGoMove(room, color, payload) {
  const point = normalizePoint(payload);
  const error = validateEmptyPoint(room, point);
  if (error) {
    return error;
  }

  const board = cloneBoard(room.board);
  const opponent = oppositeColor(color);
  const previousHash = room.boardHash || boardHash(room.board);
  let captured = 0;

  board[point.row][point.col] = color;

  for (const neighbor of neighbors(point.row, point.col, board.length)) {
    if (board[neighbor.row][neighbor.col] !== opponent) {
      continue;
    }

    const group = collectGroup(board, neighbor.row, neighbor.col);
    if (group.liberties.size === 0) {
      captured += group.stones.length;
      removeStones(board, group.stones);
    }
  }

  const ownGroup = collectGroup(board, point.row, point.col);
  if (ownGroup.liberties.size === 0) {
    return "suicide";
  }

  const nextHash = boardHash(board);
  if (room.previousBoardHash && nextHash === room.previousBoardHash) {
    return "ko";
  }

  room.board = board;
  room.previousBoardHash = previousHash;
  room.boardHash = nextHash;
  room.captures[color] = Number(room.captures[color] || 0) + captured;
  room.moves.push({ type: "place", points: [point], color, captured, at: Date.now() });
  room.lastPassColor = null;
  room.passCount = 0;

  if (isBoardFull(room.board)) {
    finishGoByScore(room);
  } else {
    room.turn = opponent;
  }

  return null;
}

function applyGoPass(room, color) {
  room.passCount = Number(room.passCount || 0) + 1;
  room.lastPassColor = color;
  room.moves.push({ type: "pass", points: [], color, at: Date.now() });

  if (room.passCount >= 2) {
    finishGoByScore(room);
    return;
  }

  room.turn = oppositeColor(color);
}

function applyReversiMove(room, color, payload) {
  const point = normalizePoint(payload);
  const error = validatePointInBoard(room, point);
  if (error) {
    return error;
  }

  if (room.board[point.row][point.col]) {
    return "invalid_move";
  }

  const flips = reversiFlips(room.board, color, point.row, point.col);
  if (flips.length === 0) {
    return "invalid_move";
  }

  room.board[point.row][point.col] = color;
  for (const flip of flips) {
    room.board[flip.row][flip.col] = color;
  }

  room.moves.push({ type: "place", points: [point], color, flips, at: Date.now() });
  advanceReversiTurn(room, color);
  return null;
}

function advanceReversiTurn(room, color) {
  const opponent = oppositeColor(color);
  const counts = countColors(room.board);

  if (counts.black === 0 || counts.white === 0 || isBoardFull(room.board)) {
    finishReversiByScore(room);
    return;
  }

  if (reversiLegalMoves(room.board, opponent).length > 0) {
    room.turn = opponent;
    return;
  }

  if (reversiLegalMoves(room.board, color).length > 0) {
    room.moves.push({ type: "pass", points: [], color: opponent, auto: true, at: Date.now() });
    room.turn = color;
    return;
  }

  finishReversiByScore(room);
}

function finishGoByScore(room) {
  const score = scoreGo(room);
  room.score = score;
  room.winner = {
    color: score.black > score.white ? COLORS.black : COLORS.white,
    reason: "score"
  };
  room.winningLine = [];
  room.status = "finished";
}

function finishReversiByScore(room) {
  const counts = countColors(room.board);
  let blackScore = counts.black;
  let whiteScore = counts.white;
  if (counts.black === 0 && counts.white > 0) {
    whiteScore = 64;
  }
  if (counts.white === 0 && counts.black > 0) {
    blackScore = 64;
  }

  room.score = { black: blackScore, white: whiteScore };
  if (blackScore === whiteScore) {
    room.winner = { color: null, reason: "draw" };
  } else {
    room.winner = {
      color: blackScore > whiteScore ? COLORS.black : COLORS.white,
      reason: "disc_count"
    };
  }
  room.winningLine = [];
  room.status = "finished";
}

async function requestRestart(store, player, restartType) {
  const roomId = player.roomId;
  if (!roomId) {
    return [errorMessage("not_in_room", "You are not in a room.")];
  }

  const lock = await acquireLock(store, roomLockName(roomId));
  if (!lock) {
    return [errorMessage("lock_busy", "Room is busy. Try again shortly.")];
  }

  try {
    const room = await getRoom(store, roomId);
    if (!room || !isRoomPlayer(room, player.id)) {
      return [errorMessage("room_not_found", "Room not found or already closed.")];
    }

    if (!room.blackPlayerId || !room.whitePlayerId) {
      return [errorMessage("waiting_for_opponent", "Wait for your opponent to join before restarting.")];
    }

    if (room.type === "ai") {
      resetRoom(room, { swapColors: restartType === "swap" });
      syncAiRoomMetadata(room);
      await syncRoomPlayerColors(store, room);
      await setRoom(store, room);
      return [{ type: "state:update", payload: await roomPayload(store, room, player.id) }];
    }

    const opponentId = opponentFor(room, player.id);
    const existingRequesterId = room.restartRequesterId || firstRestartVoter(room);
    const isConfirmingOpponentRequest = existingRequesterId === opponentId && room.restartType === restartType;

    if (isConfirmingOpponentRequest) {
      resetRoom(room, { swapColors: restartType === "swap" });
      await syncRoomPlayerColors(store, room);
      await setRoom(store, room);
      return [{ type: "state:update", payload: await roomPayload(store, room, player.id) }];
    }

    room.restartRequesterId = player.id;
    room.restartType = restartType;
    room.restartVotes = [player.id];
    room.restartRequestedAt = Date.now();
    room.updatedAt = nextRoomUpdatedAt(room);

    await setRoom(store, room);
    return [
      {
        type: "restart:requested",
        payload: {
          code: restartType === "swap" ? "swap_restart_requested" : "restart_requested",
          restartType,
          message: restartType === "swap" ? "Color swap restart request sent." : "Restart request sent."
        }
      },
      {
        type: "state:update",
        payload: await roomPayload(store, room, player.id)
      }
    ];
  } finally {
    await releaseLock(store, lock);
  }
}

async function leaveCurrentContext(store, player) {
  if (player.queued) {
    await leaveQueue(store, player);
    return [{
      type: "queue:left",
      payload: { code: "match_cancelled", message: "Matching cancelled." }
    }];
  }

  if (!player.roomId) {
    return [{
      type: "room:left",
      payload: { code: "returned_lobby", message: "Returned to the lobby." }
    }];
  }

  const roomId = player.roomId;
  const lock = await acquireLock(store, roomLockName(roomId));
  if (!lock) {
    return [errorMessage("lock_busy", "Room is busy. Try again shortly.")];
  }

  try {
    const room = await getRoom(store, roomId);
    if (!room) {
      player.roomId = null;
      player.color = null;
      await setPlayer(store, player);
      return [{
        type: "room:left",
        payload: { code: "returned_lobby", message: "Returned to the lobby." }
      }];
    }

    if (room.type === "ai") {
      await deleteRoom(store, room.id);
      player.roomId = null;
      player.color = null;
      await setPlayer(store, player);
      return [{
        type: "room:left",
        payload: { code: "room_closed", message: "The room has closed." }
      }];
    }

    if (!room.blackPlayerId || !room.whitePlayerId) {
      removePlayerFromRoom(room, player.id);
      await deleteRoom(store, room.id);
      player.roomId = null;
      player.color = null;
      await setPlayer(store, player);
      return [{
        type: "room:left",
        payload: { code: "room_closed", message: "The room has closed." }
      }];
    }

    const opponentId = opponentFor(room, player.id);
    if (!room.winner && opponentId) {
      room.winner = {
        color: colorForPlayer(room, opponentId),
        reason: "forfeit"
      };
      room.winningLine = [];
    }

    removePlayerFromRoom(room, player.id);
    room.status = "finished";
    room.updatedAt = nextRoomUpdatedAt(room);
    player.roomId = null;
    player.color = null;

    await setRoom(store, room);
    await setPlayer(store, player);
    return [{
      type: "room:left",
      payload: { code: "left_room", message: "You left the room." }
    }];
  } finally {
    await releaseLock(store, lock);
  }
}

async function tryMatchQueuedPlayers(store, viewerId, gameType) {
  const lock = await acquireLock(store, `match-${gameType}`);
  if (!lock) {
    return getViewerRoom(store, viewerId);
  }

  try {
    const tickets = await listActiveQueueTickets(store, gameType);
    if (tickets.length < 2) {
      return getViewerRoom(store, viewerId);
    }

    const [blackTicket, whiteTicket] = firstUniqueTicketPair(tickets);
    if (!blackTicket || !whiteTicket) {
      return getViewerRoom(store, viewerId);
    }

    if (blackTicket.playerId === whiteTicket.playerId) {
      await deleteQueueTicket(whiteTicket.key);
      return getViewerRoom(store, viewerId);
    }

    const blackPlayer = await getPlayer(store, blackTicket.playerId);
    const whitePlayer = await getPlayer(store, whiteTicket.playerId);

    if (!blackPlayer || !whitePlayer || blackPlayer.roomId || whitePlayer.roomId) {
      await deleteQueueTicket(store, blackTicket.key);
      await deleteQueueTicket(store, whiteTicket.key);
      return getViewerRoom(store, viewerId);
    }

    const roomId = matchRoomId(gameType, blackTicket, whiteTicket);
    const existingRoom = await getRoom(store, roomId);
    if (existingRoom && isSameMatchRoom(existingRoom, gameType, blackTicket.playerId, whiteTicket.playerId)) {
      await attachMatchedPlayers(store, existingRoom, blackPlayer, whitePlayer, blackTicket, whiteTicket);
      return isRoomPlayer(existingRoom, viewerId) ? existingRoom : getViewerRoom(store, viewerId);
    }

    const room = createRoom("public", gameType, roomId);
    room.blackPlayerId = blackPlayer.id;
    room.whitePlayerId = whitePlayer.id;
    room.status = "playing";
    room.turnStartedAt = Date.now();

    await setRoom(store, room);
    await attachMatchedPlayers(store, room, blackPlayer, whitePlayer, blackTicket, whiteTicket);

    return isRoomPlayer(room, viewerId) ? room : getViewerRoom(store, viewerId);
  } finally {
    await releaseLock(store, lock);
  }
}

function firstUniqueTicketPair(tickets) {
  const seen = new Set();
  const uniqueTickets = [];

  for (const ticket of tickets) {
    if (seen.has(ticket.playerId)) {
      continue;
    }

    seen.add(ticket.playerId);
    uniqueTickets.push(ticket);
    if (uniqueTickets.length === 2) {
      return uniqueTickets;
    }
  }

  return uniqueTickets;
}

async function attachMatchedPlayers(store, room, blackPlayer, whitePlayer, blackTicket, whiteTicket) {
  blackPlayer.roomId = room.id;
  blackPlayer.color = COLORS.black;
  blackPlayer.queued = false;
  blackPlayer.queueKey = null;
  blackPlayer.queueGameType = null;
  whitePlayer.roomId = room.id;
  whitePlayer.color = COLORS.white;
  whitePlayer.queued = false;
  whitePlayer.queueKey = null;
  whitePlayer.queueGameType = null;

  await setPlayer(store, blackPlayer);
  await setPlayer(store, whitePlayer);
  await deleteQueueTicket(store, blackTicket.key);
  await deleteQueueTicket(store, whiteTicket.key);
}

function isSameMatchRoom(room, gameType, blackPlayerId, whitePlayerId) {
  return room.type === "public"
    && room.gameType === gameType
    && room.blackPlayerId === blackPlayerId
    && room.whitePlayerId === whitePlayerId;
}

async function getViewerRoom(store, viewerId) {
  const viewer = await getPlayer(store, viewerId);
  if (!viewer?.roomId) {
    return null;
  }

  const room = await getRoom(store, viewer.roomId);
  return room && isRoomPlayer(room, viewerId) ? room : null;
}

async function applyDisconnectTimeouts(store, room) {
  if (room.winner || room.status === "finished") {
    return room;
  }

  const black = room.blackPlayerId ? await getPlayer(store, room.blackPlayerId) : null;
  const white = room.whitePlayerId ? await getPlayer(store, room.whitePlayerId) : null;
  const now = Date.now();
  let changed = false;

  if (room.status === "waiting") {
    const waitingPlayer = black || white;
    if (waitingPlayer && now - waitingPlayer.lastSeen > DISCONNECT_GRACE_MS) {
      await deleteRoom(store, room.id);
      waitingPlayer.roomId = null;
      waitingPlayer.color = null;
      await setPlayer(store, waitingPlayer);
    }

    return room;
  }

  const staleBlack = black && now - black.lastSeen > DISCONNECT_GRACE_MS;
  const staleWhite = white && now - white.lastSeen > DISCONNECT_GRACE_MS;

  if (staleBlack && room.whitePlayerId) {
    room.winner = { color: COLORS.white, reason: "forfeit" };
    room.winningLine = [];
    room.blackPlayerId = null;
    room.status = "finished";
    black.roomId = null;
    black.color = null;
    await setPlayer(store, black);
    changed = true;
  } else if (staleWhite && room.blackPlayerId) {
    room.winner = { color: COLORS.black, reason: "forfeit" };
    room.winningLine = [];
    room.whitePlayerId = null;
    room.status = "finished";
    white.roomId = null;
    white.color = null;
    await setPlayer(store, white);
    changed = true;
  }

  if (changed) {
    room.updatedAt = nextRoomUpdatedAt(room);
    await setRoom(store, room);
  }

  return room;
}

async function applyRoomTimeouts(store, room) {
  let lastUpdatedAt = room.updatedAt;
  let nextRoom = applyTurnTimeout(room);
  if (nextRoom.winner || nextRoom.status === "finished") {
    if (nextRoom.updatedAt !== lastUpdatedAt) {
      await setRoom(store, nextRoom);
    }
    return nextRoom;
  }

  nextRoom = await applyDisconnectTimeouts(store, nextRoom);
  lastUpdatedAt = nextRoom.updatedAt;
  nextRoom = applyTurnTimeout(nextRoom);
  if (nextRoom.updatedAt !== lastUpdatedAt) {
    await setRoom(store, nextRoom);
  }
  return nextRoom;
}

function applyTurnTimeout(room) {
  if (room.winner || room.status !== "playing" || !room.turnStartedAt) {
    return room;
  }

  if (Date.now() - room.turnStartedAt <= TURN_LIMIT_MS) {
    return room;
  }

  const loser = room.turn;
  room.winner = {
    color: oppositeColor(loser),
    reason: "timeout"
  };
  room.winningLine = [];
  room.status = "finished";
  room.updatedAt = nextRoomUpdatedAt(room);
  return room;
}

async function detachFromRoom(store, player) {
  if (!player.roomId) {
    return;
  }

  const lock = await acquireLock(store, roomLockName(player.roomId));
  try {
    const room = await getRoom(store, player.roomId);
    if (!room) {
      player.roomId = null;
      player.color = null;
      await setPlayer(store, player);
      return;
    }

    removePlayerFromRoom(room, player.id);
    player.roomId = null;
    player.color = null;

    if (!room.blackPlayerId && !room.whitePlayerId) {
      await deleteRoom(store, room.id);
    } else {
      room.status = room.blackPlayerId && room.whitePlayerId ? "playing" : "waiting";
      room.updatedAt = nextRoomUpdatedAt(room);
      await setRoom(store, room);
    }

    await setPlayer(store, player);
  } finally {
    await releaseLock(store, lock);
  }
}

async function leaveQueue(store, player) {
  if (player.queueKey) {
    await deleteQueueTicket(store, player.queueKey);
  }

  player.queued = false;
  player.queueKey = null;
  player.queueGameType = null;
  await setPlayer(store, player);
}

async function listActiveQueueTickets(store, gameType) {
  const now = Date.now();
  const result = await store.list({ prefix: `queue/${gameType}/`, consistency: "strong" });
  const tickets = [];

  for (const blob of result.blobs || []) {
    const ticket = await store.get(blob.key, { type: "json", consistency: "strong" });
    if (!ticket || ticket.gameType !== gameType || now - ticket.createdAt > DISCONNECT_GRACE_MS) {
      await deleteQueueTicket(store, blob.key);
      continue;
    }

    const player = await getPlayer(store, ticket.playerId);
    if (!player || player.roomId || now - player.lastSeen > DISCONNECT_GRACE_MS) {
      await deleteQueueTicket(store, blob.key);
      if (player?.queued) {
        player.queued = false;
        player.queueKey = null;
        player.queueGameType = null;
        await setPlayer(store, player);
      }
      continue;
    }

    tickets.push(ticket);
  }

  tickets.sort((a, b) => a.createdAt - b.createdAt || a.key.localeCompare(b.key));
  return tickets;
}

function createQueueTicket(playerId, gameType) {
  const createdAt = Date.now();
  const key = `queue/${gameType}/${createdAt}-${safeKeyPart(playerId)}.json`;
  return { key, playerId, gameType, createdAt };
}

function matchRoomId(gameType, blackTicket, whiteTicket) {
  return `M${hashBase36(`${gameType}:${blackTicket.key}:${whiteTicket.key}`).slice(0, 7)}`.toUpperCase();
}

function hashBase36(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36).padStart(7, "0");
}

async function acquireLock(store, name) {
  const key = `locks/${name}.json`;
  const token = randomToken();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const lock = { token, expiresAt: Date.now() + LOCK_TTL_MS };

    try {
      await store.setJSON(key, lock, { onlyIfNew: true, cacheControl: null });
      return { key, token };
    } catch {
      const existing = await store.get(key, { type: "json", consistency: "strong" }).catch(() => null);
      if (!existing || existing.expiresAt < Date.now()) {
        await store.delete(key).catch(() => {});
      }
      await delay(30 + attempt * 30);
    }
  }

  return null;
}

async function releaseLock(store, lock) {
  if (!lock) {
    return;
  }

  const existing = await store.get(lock.key, { type: "json", consistency: "strong" }).catch(() => null);
  if (existing?.token === lock.token) {
    await store.delete(lock.key).catch(() => {});
  }
}

function createRoom(type, gameType = DEFAULT_GAME_TYPE, roomId = null) {
  const normalizedGameType = normalizeGameType(gameType) || DEFAULT_GAME_TYPE;
  const board = createInitialBoard(normalizedGameType);
  return {
    id: roomId || generateRoomId(),
    type,
    gameType: normalizedGameType,
    status: "waiting",
    board,
    blackPlayerId: null,
    whitePlayerId: null,
    aiPlayerId: null,
    aiColor: null,
    turn: COLORS.black,
    turnStartedAt: null,
    winner: null,
    winningLine: [],
    moves: [],
    captures: { black: 0, white: 0 },
    passCount: 0,
    lastPassColor: null,
    previousBoardHash: null,
    boardHash: boardHash(board),
    score: null,
    restartVotes: [],
    restartRequesterId: null,
    restartRequestedAt: null,
    restartType: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function resetRoom(room, options = {}) {
  if (options.swapColors) {
    const blackPlayerId = room.blackPlayerId;
    room.blackPlayerId = room.whitePlayerId;
    room.whitePlayerId = blackPlayerId;
  }

  const gameType = normalizeGameType(room.gameType) || DEFAULT_GAME_TYPE;
  const board = createInitialBoard(gameType);
  room.gameType = gameType;
  room.status = room.blackPlayerId && room.whitePlayerId ? "playing" : "waiting";
  room.board = board;
  room.turn = COLORS.black;
  room.turnStartedAt = room.status === "playing" ? Date.now() : null;
  room.winner = null;
  room.winningLine = [];
  room.moves = [];
  room.captures = { black: 0, white: 0 };
  room.passCount = 0;
  room.lastPassColor = null;
  room.previousBoardHash = null;
  room.boardHash = boardHash(board);
  room.score = null;
  room.restartVotes = [];
  room.restartRequesterId = null;
  room.restartRequestedAt = null;
  room.restartType = null;
  room.updatedAt = nextRoomUpdatedAt(room);
}

function syncAiRoomMetadata(room) {
  if (room.type !== "ai" || !room.aiPlayerId) {
    room.aiColor = null;
    return;
  }

  room.aiColor = colorForPlayer(room, room.aiPlayerId);
}

function createInitialBoard(gameType) {
  const size = gameConfig(gameType).boardSize;
  const board = Array.from({ length: size }, () => Array.from({ length: size }, () => null));
  if (gameType === "reversi") {
    board[3][3] = COLORS.white;
    board[3][4] = COLORS.black;
    board[4][3] = COLORS.black;
    board[4][4] = COLORS.white;
  }
  return board;
}

function nextRoomUpdatedAt(room) {
  return Math.max(Date.now(), Number(room.updatedAt || 0) + 1);
}

function findWinningLineForPoints(board, points, color, winLength) {
  for (const point of points) {
    const line = findWinningLine(board, point.row, point.col, color, winLength);
    if (line) {
      return line;
    }
  }
  return null;
}

function findWinningLine(board, row, col, color, winLength) {
  for (const [rowStep, colStep] of LINE_DIRECTIONS) {
    const line = [{ row, col }];

    for (let nextRow = row + rowStep, nextCol = col + colStep; isSameColor(board, nextRow, nextCol, color); nextRow += rowStep, nextCol += colStep) {
      line.push({ row: nextRow, col: nextCol });
    }

    for (let nextRow = row - rowStep, nextCol = col - colStep; isSameColor(board, nextRow, nextCol, color); nextRow -= rowStep, nextCol -= colStep) {
      line.unshift({ row: nextRow, col: nextCol });
    }

    if (line.length >= winLength) {
      return line;
    }
  }

  return null;
}

function isSameColor(board, row, col, color) {
  return row >= 0 && row < board.length && col >= 0 && col < board.length && board[row][col] === color;
}

function reversiLegalMoves(board, color) {
  const moves = [];
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board.length; col += 1) {
      if (!board[row][col] && reversiFlips(board, color, row, col).length > 0) {
        moves.push({ row, col });
      }
    }
  }
  return moves;
}

function reversiFlips(board, color, row, col) {
  const opponent = oppositeColor(color);
  const flips = [];

  for (const [rowStep, colStep] of DIRECTIONS_8) {
    const line = [];
    let nextRow = row + rowStep;
    let nextCol = col + colStep;

    while (isOnBoard(board, nextRow, nextCol) && board[nextRow][nextCol] === opponent) {
      line.push({ row: nextRow, col: nextCol });
      nextRow += rowStep;
      nextCol += colStep;
    }

    if (line.length > 0 && isOnBoard(board, nextRow, nextCol) && board[nextRow][nextCol] === color) {
      flips.push(...line);
    }
  }

  return flips;
}

function scoreGo(room) {
  const board = room.board;
  const size = board.length;
  const visited = new Set();
  const stones = countColors(board);
  const territory = { black: 0, white: 0 };

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (board[row][col] || visited.has(`${row},${col}`)) {
        continue;
      }

      const region = floodEmptyRegion(board, row, col, visited);
      if (region.borderColors.size === 1) {
        const owner = [...region.borderColors][0];
        territory[owner] += region.points.length;
      }
    }
  }

  return {
    black: stones.black + territory.black,
    white: stones.white + territory.white + GO_KOMI,
    komi: GO_KOMI,
    stones,
    territory,
    captures: {
      black: Number(room.captures?.black || 0),
      white: Number(room.captures?.white || 0)
    }
  };
}

function floodEmptyRegion(board, startRow, startCol, visited) {
  const stack = [{ row: startRow, col: startCol }];
  const points = [];
  const borderColors = new Set();
  visited.add(`${startRow},${startCol}`);

  while (stack.length > 0) {
    const point = stack.pop();
    points.push(point);

    for (const neighbor of neighbors(point.row, point.col, board.length)) {
      const value = board[neighbor.row][neighbor.col];
      if (value) {
        borderColors.add(value);
        continue;
      }

      const key = pointKey(neighbor);
      if (!visited.has(key)) {
        visited.add(key);
        stack.push(neighbor);
      }
    }
  }

  return { points, borderColors };
}

function collectGroup(board, startRow, startCol) {
  const color = board[startRow][startCol];
  const stack = [{ row: startRow, col: startCol }];
  const visited = new Set([`${startRow},${startCol}`]);
  const stones = [];
  const liberties = new Set();

  while (stack.length > 0) {
    const point = stack.pop();
    stones.push(point);

    for (const neighbor of neighbors(point.row, point.col, board.length)) {
      const value = board[neighbor.row][neighbor.col];
      const key = pointKey(neighbor);
      if (!value) {
        liberties.add(key);
      } else if (value === color && !visited.has(key)) {
        visited.add(key);
        stack.push(neighbor);
      }
    }
  }

  return { stones, liberties };
}

function removeStones(board, stones) {
  for (const stone of stones) {
    board[stone.row][stone.col] = null;
  }
}

function neighbors(row, col, size) {
  const result = [];
  for (const [rowStep, colStep] of DIRECTIONS_4) {
    const nextRow = row + rowStep;
    const nextCol = col + colStep;
    if (nextRow >= 0 && nextRow < size && nextCol >= 0 && nextCol < size) {
      result.push({ row: nextRow, col: nextCol });
    }
  }
  return result;
}

function countColors(board) {
  const counts = { black: 0, white: 0 };
  for (const row of board) {
    for (const value of row) {
      if (value === COLORS.black) {
        counts.black += 1;
      } else if (value === COLORS.white) {
        counts.white += 1;
      }
    }
  }
  return counts;
}

function isBoardFull(board) {
  return board.every((row) => row.every(Boolean));
}

function boardHash(board) {
  return board.map((row) => row.map((value) => value ? value[0] : "-").join("")).join("/");
}

function cloneBoard(board) {
  return board.map((row) => [...row]);
}

async function roomPayload(store, room, viewerId) {
  const color = colorForPlayer(room, viewerId);
  const opponentId = opponentFor(room, viewerId);
  const opponentIsAi = room.type === "ai" && opponentId === room.aiPlayerId;
  const opponent = opponentId && !opponentIsAi ? await getPlayer(store, opponentId) : null;
  const now = Date.now();
  const config = gameConfig(room.gameType);
  const score = room.score || liveScore(room);
  const lastMove = room.moves.at(-1) || null;

  return {
    roomId: room.id,
    roomType: room.type,
    gameType: room.gameType,
    aiColor: room.type === "ai" ? room.aiColor || null : null,
    previousBoardHash: room.gameType === "go" ? room.previousBoardHash || null : null,
    boardSize: config.boardSize,
    boardKind: config.boardKind,
    status: room.status,
    updatedAt: room.updatedAt,
    board: room.board,
    turn: room.turn,
    turnStartedAt: room.turnStartedAt,
    turnLimitMs: TURN_LIMIT_MS,
    turnDeadlineAt: room.status === "playing" && !room.winner && room.turnStartedAt
      ? room.turnStartedAt + TURN_LIMIT_MS
      : null,
    serverNow: now,
    winner: room.winner,
    winningLine: room.winningLine,
    lastMove: normalizeLastMove(lastMove),
    lastMovePoints: lastMove?.points || [],
    legalMoves: legalMovesForRoom(room),
    requiredStones: room.gameType === "connect6" && room.status === "playing" && !room.winner
      ? connect6ExpectedStones(room)
      : 1,
    passCount: Number(room.passCount || 0),
    captures: room.captures || { black: 0, white: 0 },
    score,
    moves: room.moves.length,
    you: {
      color,
      connected: true
    },
    opponent: {
      connected: opponentIsAi || Boolean(opponent && now - opponent.lastSeen <= DISCONNECT_GRACE_MS && opponent.roomId === room.id),
      color: opponentId ? colorForPlayer(room, opponentId) : null,
      isAi: opponentIsAi
    },
    restart: {
      requested: room.type !== "ai" && restartRequester(room) === viewerId,
      opponentRequested: room.type !== "ai" && opponentId ? restartRequester(room) === opponentId : false,
      requestedAt: room.restartRequestedAt || null,
      type: room.restartType || "normal"
    }
  };
}

function normalizeLastMove(move) {
  if (!move) {
    return null;
  }

  const point = move.points?.[0] || null;
  return {
    ...point,
    type: move.type,
    color: move.color,
    points: move.points || []
  };
}

function liveScore(room) {
  if (room.gameType === "go") {
    return null;
  }

  if (room.gameType === "reversi") {
    return countColors(room.board);
  }

  return null;
}

function legalMovesForRoom(room) {
  if (room.status !== "playing" || room.winner) {
    return [];
  }

  if (room.gameType === "reversi") {
    return reversiLegalMoves(room.board, room.turn);
  }

  return [];
}

function connect6ExpectedStones(room) {
  return room.moves.filter((move) => move.type === "place").length === 0 ? 1 : 2;
}

function restartRequester(room) {
  return room.restartRequesterId || firstRestartVoter(room);
}

function firstRestartVoter(room) {
  return Array.isArray(room.restartVotes) && room.restartVotes.length > 0 ? room.restartVotes[0] : null;
}

async function syncRoomPlayerColors(store, room) {
  const black = room.blackPlayerId ? await getPlayer(store, room.blackPlayerId) : null;
  const white = room.whitePlayerId ? await getPlayer(store, room.whitePlayerId) : null;

  if (black) {
    black.roomId = room.id;
    black.color = COLORS.black;
    black.queued = false;
    black.queueKey = null;
    black.queueGameType = null;
    await setPlayer(store, black);
  }

  if (white) {
    white.roomId = room.id;
    white.color = COLORS.white;
    white.queued = false;
    white.queueKey = null;
    white.queueGameType = null;
    await setPlayer(store, white);
  }
}

async function getPlayer(store, playerId) {
  return store.get(playerKey(playerId), { type: "json", consistency: "strong" });
}

async function setPlayer(store, player) {
  await store.setJSON(playerKey(player.id), player, { cacheControl: null });
}

async function touchPlayer(store, playerId) {
  const existing = await getPlayer(store, playerId);
  const player = existing || {
    id: playerId,
    roomId: null,
    color: null,
    queued: false,
    queueKey: null,
    queueGameType: null,
    lastSeen: Date.now()
  };

  player.lastSeen = Date.now();
  await setPlayer(store, player);
  return player;
}

async function getRoom(store, roomId) {
  const room = await store.get(roomKey(roomId), { type: "json", consistency: "strong" });
  return room ? normalizeStoredRoom(room) : null;
}

async function setRoom(store, room) {
  await store.setJSON(roomKey(room.id), normalizeStoredRoom(room), { cacheControl: null });
}

async function deleteRoom(store, roomId) {
  await store.delete(roomKey(roomId));
}

async function setQueueTicket(store, ticket) {
  await store.setJSON(ticket.key, ticket, { cacheControl: null });
}

async function deleteQueueTicket(store, key) {
  await store.delete(key).catch(() => {});
}

function normalizeStoredRoom(room) {
  const gameType = normalizeGameType(room.gameType) || DEFAULT_GAME_TYPE;
  const config = gameConfig(gameType);
  room.gameType = gameType;
  if (!Array.isArray(room.board) || room.board.length !== config.boardSize) {
    room.board = createInitialBoard(gameType);
  }
  room.captures ||= { black: 0, white: 0 };
  room.captures.black = Number(room.captures.black || 0);
  room.captures.white = Number(room.captures.white || 0);
  room.passCount = Number(room.passCount || 0);
  room.lastPassColor ||= null;
  room.previousBoardHash ||= null;
  room.boardHash ||= boardHash(room.board);
  room.score ||= null;
  room.restartVotes ||= [];
  room.restartRequesterId ||= null;
  room.restartRequestedAt ||= null;
  room.restartType ||= null;
  room.winningLine ||= [];
  room.moves ||= [];
  room.turn ||= COLORS.black;
  room.type ||= "private";
  room.aiPlayerId ||= null;
  room.aiColor = room.type === "ai" && room.aiPlayerId ? colorForPlayer(room, room.aiPlayerId) : null;
  room.status ||= "waiting";
  return room;
}

function playerKey(playerId) {
  return `players/${safeKeyPart(playerId)}.json`;
}

function roomKey(roomId) {
  return `rooms/${roomId}.json`;
}

function roomLockName(roomId) {
  return `room-${roomId}`;
}

function colorForPlayer(room, playerId) {
  if (room.blackPlayerId === playerId) {
    return COLORS.black;
  }

  if (room.whitePlayerId === playerId) {
    return COLORS.white;
  }

  return null;
}

function opponentFor(room, playerId) {
  if (room.blackPlayerId === playerId) {
    return room.whitePlayerId;
  }

  if (room.whitePlayerId === playerId) {
    return room.blackPlayerId;
  }

  return null;
}

function isRoomPlayer(room, playerId) {
  return room.blackPlayerId === playerId || room.whitePlayerId === playerId;
}

function removePlayerFromRoom(room, playerId) {
  if (room.blackPlayerId === playerId) {
    room.blackPlayerId = null;
  }

  if (room.whitePlayerId === playerId) {
    room.whitePlayerId = null;
  }
}

function normalizePoint(value) {
  return {
    row: Number(value?.row),
    col: Number(value?.col)
  };
}

function normalizePoints(payload) {
  if (Array.isArray(payload?.points)) {
    return payload.points.map(normalizePoint);
  }

  if (payload && Object.hasOwn(payload, "row") && Object.hasOwn(payload, "col")) {
    return [normalizePoint(payload)];
  }

  return [];
}

function validateEmptyPoint(room, point) {
  const error = validatePointInBoard(room, point);
  if (error) {
    return error;
  }

  return room.board[point.row][point.col] ? "invalid_move" : null;
}

function validatePointInBoard(room, point) {
  const size = gameConfig(room.gameType).boardSize;
  if (!Number.isInteger(point.row) || !Number.isInteger(point.col) || point.row < 0 || point.row >= size || point.col < 0 || point.col >= size) {
    return "invalid_move";
  }
  return null;
}

function isOnBoard(board, row, col) {
  return row >= 0 && row < board.length && col >= 0 && col < board.length;
}

function pointKey(point) {
  return `${point.row},${point.col}`;
}

function oppositeColor(color) {
  return color === COLORS.black ? COLORS.white : COLORS.black;
}

function gameConfig(gameType) {
  return GAME_CONFIGS[normalizeGameType(gameType) || DEFAULT_GAME_TYPE];
}

function normalizeGameType(value) {
  return typeof value === "string" && GAME_CONFIGS[value] ? value : null;
}

function normalizeColor(value) {
  return value === COLORS.black || value === COLORS.white ? value : null;
}

function normalizeClientId(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length < 8 || trimmed.length > 120) {
    return null;
  }

  return trimmed;
}

function normalizeRoomId(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (normalized.length < 4 || normalized.length > 8) {
    return null;
  }

  return normalized;
}

function generateRoomId() {
  return randomBytes(5).toString("hex").slice(0, 8).toUpperCase();
}

function createAiPlayerId(roomId) {
  return `ai-${roomId}`;
}

function safeKeyPart(value) {
  return encodeURIComponent(value).replaceAll("%", "_");
}

function randomToken() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function messageForError(code) {
  const messages = {
    invalid_game: "Invalid game type.",
    invalid_color: "Invalid player color.",
    ai_unsupported: "AI opponent is not available for this game.",
    invalid_action: "That action is not available.",
    invalid_move: "Invalid move.",
    invalid_move_count: "Place the required number of stones.",
    suicide: "That move has no liberties.",
    ko: "That move repeats the previous board position."
  };
  return messages[code] || "Operation failed.";
}

function errorMessage(code, message) {
  return {
    type: "error",
    payload: { code, message }
  };
}

function jsonResponse(messages, status = 200) {
  return new Response(JSON.stringify({ messages }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      ...corsHeaders()
    }
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

export const __test = {
  applyGomokuMove,
  applyGoMove,
  applyGoPass,
  applyReversiMove,
  applyConnect6Move,
  createRoom,
  scoreGo,
  reversiLegalMoves,
  findWinningLine,
  connect6ExpectedStones,
  matchRoomId
};
