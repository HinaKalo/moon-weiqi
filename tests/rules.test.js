import assert from "node:assert/strict";
import test from "node:test";
import * as ai from "../public/ai.js";
import * as game from "../cloud-functions/api/game.js";
import * as presence from "../cloud-functions/api/presence.js";
import { openStore } from "../store.js";

openStore(":memory:");

async function post(clientId, type, payload = {}) {
  const request = new Request("http://local/api/game", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientId, type, payload })
  });
  const response = await game.onRequestPost({ request });
  return response.json();
}

async function get(clientId, roomId) {
  const url = new URL("http://local/api/game");
  url.searchParams.set("clientId", clientId);
  if (roomId) {
    url.searchParams.set("roomId", roomId);
  }
  const response = await game.onRequestGet({ request: new Request(url) });
  return response.json();
}

function stateMessage(result) {
  const state = result.messages.find((message) => message.type === "state:update");
  assert.ok(state, `expected state:update in ${JSON.stringify(result.messages)}`);
  return state.payload;
}

function errorCode(result) {
  return result.messages.find((message) => message.type === "error")?.payload.code;
}

function client(label) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function hashBoard(board) {
  return board.map((row) => row.map((value) => value ? value[0] : "-").join("")).join("/");
}

test("presence update reports active online clients", async () => {
  const firstResponse = await presence.onRequestGet({
    request: new Request(`http://local/api/presence?clientId=${client("presence-a")}`)
  });
  const secondResponse = await presence.onRequestGet({
    request: new Request(`http://local/api/presence?clientId=${client("presence-b")}`)
  });
  const first = await firstResponse.json();
  const second = await secondResponse.json();

  assert.ok(Number.isInteger(first.onlineCount));
  assert.ok(second.onlineCount >= first.onlineCount + 1);
});

test("public matchmaking is isolated by game type", async () => {
  const gomokuA = client("match-gomoku-a");
  const gomokuB = client("match-gomoku-b");
  const reversiA = client("match-reversi-a");
  const reversiB = client("match-reversi-b");

  let result = await post(gomokuA, "match:join", { gameType: "gomoku" });
  assert.equal(result.messages[0].type, "queue:update");
  result = await post(reversiA, "match:join", { gameType: "reversi" });
  assert.equal(result.messages[0].type, "queue:update");

  const gomokuRoom = stateMessage(await post(gomokuB, "match:join", { gameType: "gomoku" }));
  assert.equal(gomokuRoom.gameType, "gomoku");
  assert.equal(gomokuRoom.you.color, "white");

  const reversiRoom = stateMessage(await post(reversiB, "match:join", { gameType: "reversi" }));
  assert.equal(reversiRoom.gameType, "reversi");
  assert.equal(reversiRoom.boardSize, 8);
});

test("public matching uses one deterministic room per queued player pair", async () => {
  const firstTicket = {
    key: "queue/gomoku/1000-player-a.json",
    playerId: "player-a",
    gameType: "gomoku",
    createdAt: 1000
  };
  const secondTicket = {
    key: "queue/gomoku/1001-player-b.json",
    playerId: "player-b",
    gameType: "gomoku",
    createdAt: 1001
  };

  assert.equal(
    game.__test.matchRoomId("gomoku", firstTicket, secondTicket),
    game.__test.matchRoomId("gomoku", firstTicket, secondTicket)
  );
  assert.notEqual(
    game.__test.matchRoomId("gomoku", firstTicket, secondTicket),
    game.__test.matchRoomId("reversi", firstTicket, secondTicket)
  );
});

test("the same client cannot public-match with itself", async () => {
  const sameClient = client("same-client");
  let result = await post(sameClient, "match:join", { gameType: "gomoku" });
  assert.equal(result.messages[0].type, "queue:update");
  result = await post(sameClient, "match:join", { gameType: "gomoku" });
  assert.equal(result.messages[0].type, "queue:update");
  assert.equal(result.messages[0].payload.gameType, "gomoku");
});

test("gomoku wins on five or more connected stones", async () => {
  const black = client("gomoku-black");
  const white = client("gomoku-white");
  const room = stateMessage(await post(black, "room:create", { gameType: "gomoku" }));
  await post(white, "room:join", { roomId: room.roomId });

  const blackMoves = [[7, 0], [7, 1], [7, 2], [7, 3], [7, 4]];
  const whiteMoves = [[8, 0], [8, 1], [8, 2], [8, 3]];
  let latest;
  for (let index = 0; index < blackMoves.length; index += 1) {
    latest = stateMessage(await post(black, "move:place", { row: blackMoves[index][0], col: blackMoves[index][1] }));
    if (index < whiteMoves.length) {
      await post(white, "move:place", { row: whiteMoves[index][0], col: whiteMoves[index][1] });
    }
  }

  assert.equal(latest.winner.color, "black");
  assert.equal(latest.winner.reason, "line");
  assert.equal(latest.winningLine.length, 5);
});

test("reversi starts with four legal black moves and flips discs", async () => {
  const black = client("reversi-black");
  const white = client("reversi-white");
  const room = stateMessage(await post(black, "room:create", { gameType: "reversi" }));
  await post(white, "room:join", { roomId: room.roomId });
  const blackState = stateMessage(await get(black, room.roomId));

  assert.equal(blackState.legalMoves.length, 4);
  const afterMove = stateMessage(await post(black, "move:place", { row: 2, col: 3 }));
  assert.equal(afterMove.board[2][3], "black");
  assert.equal(afterMove.board[3][3], "black");
  assert.equal(afterMove.turn, "white");
  assert.equal(afterMove.score.black, 4);
  assert.equal(afterMove.score.white, 1);
});

test("connect6 requires one opening stone and two stones afterward", async () => {
  const black = client("connect6-black");
  const white = client("connect6-white");
  const room = stateMessage(await post(black, "room:create", { gameType: "connect6" }));
  await post(white, "room:join", { roomId: room.roomId });

  const afterOpening = stateMessage(await post(black, "move:place", { points: [{ row: 9, col: 9 }] }));
  assert.equal(afterOpening.turn, "white");
  assert.equal(afterOpening.requiredStones, 2);

  const invalid = await post(white, "move:place", { points: [{ row: 9, col: 10 }] });
  assert.equal(errorCode(invalid), "invalid_move_count");

  const afterWhite = stateMessage(await post(white, "move:place", {
    points: [{ row: 9, col: 10 }, { row: 10, col: 9 }]
  }));
  assert.equal(afterWhite.turn, "black");
  assert.equal(afterWhite.lastMovePoints.length, 2);
});

test("go captures, rejects suicide and prevents immediate board repetition", () => {
  const captureRoom = game.__test.createRoom("private", "go");
  captureRoom.status = "playing";
  assert.equal(game.__test.applyGoMove(captureRoom, "black", { row: 0, col: 1 }), null);
  assert.equal(game.__test.applyGoMove(captureRoom, "white", { row: 0, col: 0 }), null);
  assert.equal(game.__test.applyGoMove(captureRoom, "black", { row: 1, col: 0 }), null);
  assert.equal(captureRoom.board[0][0], null);
  assert.equal(captureRoom.captures.black, 1);

  const suicideRoom = game.__test.createRoom("private", "go");
  suicideRoom.status = "playing";
  suicideRoom.board[0][1] = "black";
  suicideRoom.board[1][0] = "black";
  suicideRoom.boardHash = hashBoard(suicideRoom.board);
  assert.equal(game.__test.applyGoMove(suicideRoom, "white", { row: 0, col: 0 }), "suicide");

  const koRoom = game.__test.createRoom("private", "go");
  koRoom.status = "playing";
  const repeated = koRoom.board.map((row) => [...row]);
  repeated[0][0] = "black";
  koRoom.previousBoardHash = hashBoard(repeated);
  assert.equal(game.__test.applyGoMove(koRoom, "black", { row: 0, col: 0 }), "ko");
});

test("go ends and scores after two consecutive passes", async () => {
  const black = client("go-black");
  const white = client("go-white");
  const room = stateMessage(await post(black, "room:create", { gameType: "go" }));
  await post(white, "room:join", { roomId: room.roomId });

  const afterOpening = stateMessage(await post(black, "move:place", { row: 3, col: 3 }));
  assert.equal(afterOpening.score, null);

  await post(white, "move:pass");
  const finalState = stateMessage(await post(black, "move:pass"));
  assert.equal(finalState.status, "finished");
  assert.equal(finalState.winner.reason, "score");
  assert.equal(finalState.winner.color, "black");
  assert.equal(finalState.score.black, 361);
  assert.equal(finalState.score.white, 7.5);
});

test("restart, swap restart and resign work across game types", async () => {
  for (const gameType of ["gomoku", "go", "reversi", "connect6"]) {
    const black = client(`${gameType}-restart-black`);
    const white = client(`${gameType}-restart-white`);
    const room = stateMessage(await post(black, "room:create", { gameType }));
    await post(white, "room:join", { roomId: room.roomId });

    await post(black, "game:restart");
    const whitePrompt = stateMessage(await get(white, room.roomId));
    assert.equal(whitePrompt.restart.opponentRequested, true);
    const restarted = stateMessage(await post(white, "game:restart"));
    assert.equal(restarted.restart.opponentRequested, false);
    assert.equal(restarted.gameType, gameType);

    await post(black, "game:swap_restart");
    const swapped = stateMessage(await post(white, "game:swap_restart"));
    assert.equal(swapped.you.color, "black");

    const resigned = stateMessage(await post(white, "move:resign"));
    assert.equal(resigned.winner.reason, "resign");
    assert.equal(resigned.winner.color, "white");
  }
});

test("ai rooms support all games including go", async () => {
  const human = client("ai-gomoku-human");
  let room = stateMessage(await post(human, "ai:create", { gameType: "gomoku", humanColor: "black" }));
  assert.equal(room.roomType, "ai");
  assert.equal(room.you.color, "black");
  assert.equal(room.aiColor, "white");
  assert.equal(room.opponent.isAi, true);

  let result = await post(human, "ai:move", { row: 7, col: 7 });
  assert.equal(errorCode(result), "not_your_turn");

  room = stateMessage(await post(human, "move:place", { row: 7, col: 7 }));
  assert.equal(room.turn, "white");
  room = stateMessage(await post(human, "ai:move", { row: 7, col: 8 }));
  assert.equal(room.board[7][8], "white");
  assert.equal(room.turn, "black");

  const whiteHuman = client("ai-reversi-white");
  room = stateMessage(await post(whiteHuman, "ai:create", { gameType: "reversi", humanColor: "white" }));
  assert.equal(room.you.color, "white");
  assert.equal(room.aiColor, "black");
  assert.equal(room.turn, "black");
  room = stateMessage(await post(whiteHuman, "ai:move", { row: 2, col: 3 }));
  assert.equal(room.board[2][3], "black");
  assert.equal(room.turn, "white");

  const goHuman = client("ai-go-white");
  room = stateMessage(await post(goHuman, "ai:create", { gameType: "go", humanColor: "white" }));
  assert.equal(room.roomType, "ai");
  assert.equal(room.you.color, "white");
  assert.equal(room.aiColor, "black");
  assert.equal(room.turn, "black");
  room = stateMessage(await post(goHuman, "ai:move", { row: 3, col: 3 }));
  assert.equal(room.board[3][3], "black");
  assert.equal(room.turn, "white");
  await post(goHuman, "move:pass");
  const invalidOccupied = await post(goHuman, "ai:move", { row: 3, col: 3 });
  assert.equal(errorCode(invalidOccupied), "invalid_move");
  const finalGo = stateMessage(await post(goHuman, "ai:pass"));
  assert.equal(finalGo.status, "finished");
  assert.equal(finalGo.winner.reason, "score");
});

test("ai rooms restart, swap colors, validate moves and close on leave", async () => {
  const human = client("ai-connect6-human");
  let room = stateMessage(await post(human, "ai:create", { gameType: "connect6", humanColor: "black" }));
  assert.equal(room.roomType, "ai");

  const invalid = await post(human, "ai:move", { points: [{ row: 9, col: 9 }] });
  assert.equal(errorCode(invalid), "not_your_turn");

  room = stateMessage(await post(human, "game:swap_restart"));
  assert.equal(room.you.color, "white");
  assert.equal(room.aiColor, "black");
  assert.equal(room.turn, "black");

  room = stateMessage(await post(human, "ai:move", { points: [{ row: 9, col: 9 }] }));
  assert.equal(room.board[9][9], "black");
  assert.equal(room.turn, "white");

  room = stateMessage(await post(human, "game:restart"));
  assert.equal(room.you.color, "white");
  assert.equal(room.aiColor, "black");
  assert.equal(room.moves, 0);

  const roomId = room.roomId;
  await post(human, "room:leave");
  const afterLeave = await get(human, roomId);
  assert.equal(errorCode(afterLeave), "room_not_found");
});

test("browser ai chooses legal and tactical moves", () => {
  const reversiBoard = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => null));
  reversiBoard[3][3] = "white";
  reversiBoard[3][4] = "black";
  reversiBoard[4][3] = "black";
  reversiBoard[4][4] = "white";
  const reversiMove = ai.chooseAiMove({
    gameType: "reversi",
    board: reversiBoard,
    aiColor: "black",
    turn: "black"
  });
  assert.ok(["2,3", "3,2", "4,5", "5,4"].includes(`${reversiMove.row},${reversiMove.col}`));

  const gomokuBoard = Array.from({ length: 15 }, () => Array.from({ length: 15 }, () => null));
  for (const col of [3, 4, 5, 6]) {
    gomokuBoard[7][col] = "black";
  }
  const winningMove = ai.chooseAiMove({
    gameType: "gomoku",
    board: gomokuBoard,
    aiColor: "black",
    turn: "black"
  });
  assert.equal(winningMove.row, 7);
  assert.ok([2, 7].includes(winningMove.col));

  const blockBoard = Array.from({ length: 15 }, () => Array.from({ length: 15 }, () => null));
  for (const col of [5, 6, 7, 8]) {
    blockBoard[6][col] = "white";
  }
  const blockingMove = ai.chooseAiMove({
    gameType: "gomoku",
    board: blockBoard,
    aiColor: "black",
    turn: "black"
  });
  assert.equal(blockingMove.row, 6);
  assert.ok([4, 9].includes(blockingMove.col));

  const connect6Board = Array.from({ length: 19 }, () => Array.from({ length: 19 }, () => null));
  const opening = ai.chooseAiMove({
    gameType: "connect6",
    board: connect6Board,
    aiColor: "black",
    turn: "black",
    requiredStones: 1
  });
  assert.deepEqual(opening.points, [{ row: 9, col: 9 }]);

  for (const col of [5, 6, 7, 8, 9]) {
    connect6Board[9][col] = "black";
  }
  const connect6Move = ai.chooseAiMove({
    gameType: "connect6",
    board: connect6Board,
    aiColor: "black",
    turn: "black",
    requiredStones: 2
  });
  assert.equal(connect6Move.points.length, 2);
  assert.notDeepEqual(connect6Move.points[0], connect6Move.points[1]);
  assert.ok(connect6Move.points.some((point) => point.row === 9 && (point.col === 4 || point.col === 10)));
});

test("browser go ai captures, rescues, avoids illegal points and passes", () => {
  const emptyGo = Array.from({ length: 19 }, () => Array.from({ length: 19 }, () => null));
  const opening = ai.chooseAiMove({
    gameType: "go",
    board: emptyGo,
    aiColor: "black",
    turn: "black",
    moves: 0,
    passCount: 0
  });
  assert.deepEqual(opening, { row: 3, col: 3 });

  const captureBoard = Array.from({ length: 19 }, () => Array.from({ length: 19 }, () => null));
  captureBoard[0][0] = "white";
  captureBoard[0][1] = "black";
  const capture = ai.chooseAiMove({
    gameType: "go",
    board: captureBoard,
    aiColor: "black",
    turn: "black",
    moves: 2,
    passCount: 0
  });
  assert.deepEqual(capture, { row: 1, col: 0 });

  const rescueBoard = Array.from({ length: 19 }, () => Array.from({ length: 19 }, () => null));
  rescueBoard[0][0] = "black";
  rescueBoard[0][1] = "white";
  const rescue = ai.chooseAiMove({
    gameType: "go",
    board: rescueBoard,
    aiColor: "black",
    turn: "black",
    moves: 2,
    passCount: 0
  });
  assert.deepEqual(rescue, { row: 1, col: 0 });

  const suicideBoard = Array.from({ length: 19 }, () => Array.from({ length: 19 }, () => null));
  suicideBoard[0][1] = "black";
  suicideBoard[1][0] = "black";
  const legalWhite = ai.goLegalMoves(suicideBoard, "white");
  assert.equal(legalWhite.some((point) => point.row === 0 && point.col === 0), false);

  const koBoard = Array.from({ length: 19 }, () => Array.from({ length: 19 }, () => null));
  const repeated = Array.from({ length: 19 }, () => Array.from({ length: 19 }, () => null));
  repeated[3][3] = "black";
  const legalKo = ai.goLegalMoves(koBoard, "black", hashBoard(repeated));
  assert.equal(legalKo.some((point) => point.row === 3 && point.col === 3), false);

  const passBoard = Array.from({ length: 19 }, () => Array.from({ length: 19 }, () => "black"));
  passBoard[0][0] = null;
  const pass = ai.chooseAiMove({
    gameType: "go",
    board: passBoard,
    aiColor: "black",
    turn: "black",
    moves: 120,
    passCount: 1
  });
  assert.deepEqual(pass, { pass: true });
});

test("go mcts ai chooses tactical and legal moves", () => {
  const options = { timeLimitMs: 25, maxIterations: 96, maxRolloutMoves: 24, seed: 7 };

  const emptyGo = Array.from({ length: 19 }, () => Array.from({ length: 19 }, () => null));
  const opening = ai.chooseGoMctsMove({
    gameType: "go",
    board: emptyGo,
    aiColor: "black",
    turn: "black",
    moves: 0,
    passCount: 0
  }, options);
  assert.ok(["3,3", "3,15", "15,3", "15,15", "9,9"].includes(`${opening.row},${opening.col}`));

  const captureBoard = Array.from({ length: 19 }, () => Array.from({ length: 19 }, () => null));
  captureBoard[0][0] = "white";
  captureBoard[0][1] = "black";
  const capture = ai.chooseGoMctsMove({
    gameType: "go",
    board: captureBoard,
    aiColor: "black",
    turn: "black",
    moves: 2,
    passCount: 0
  }, options);
  assert.deepEqual(capture, { row: 1, col: 0 });

  const rescueBoard = Array.from({ length: 19 }, () => Array.from({ length: 19 }, () => null));
  rescueBoard[0][0] = "black";
  rescueBoard[0][1] = "white";
  const rescue = ai.chooseGoMctsMove({
    gameType: "go",
    board: rescueBoard,
    aiColor: "black",
    turn: "black",
    moves: 2,
    passCount: 0
  }, options);
  assert.deepEqual(rescue, { row: 1, col: 0 });

  const suicideBoard = Array.from({ length: 19 }, () => Array.from({ length: 19 }, () => null));
  suicideBoard[0][1] = "black";
  suicideBoard[1][0] = "black";
  const whiteMove = ai.chooseGoMctsMove({
    gameType: "go",
    board: suicideBoard,
    aiColor: "white",
    turn: "white",
    moves: 2,
    passCount: 0
  }, options);
  assert.notDeepEqual(whiteMove, { row: 0, col: 0 });

  const passBoard = Array.from({ length: 19 }, () => Array.from({ length: 19 }, () => "black"));
  passBoard[0][0] = null;
  const pass = ai.chooseGoMctsMove({
    gameType: "go",
    board: passBoard,
    aiColor: "black",
    turn: "black",
    moves: 120,
    passCount: 1
  }, options);
  assert.deepEqual(pass, { pass: true });
});

test("go mcts uses fighting and ownership priors", () => {
  const options = { timeLimitMs: 25, maxIterations: 96, maxRolloutMoves: 24, seed: 11 };

  const twoLibertyBoard = Array.from({ length: 19 }, () => Array.from({ length: 19 }, () => null));
  twoLibertyBoard[5][5] = "white";
  twoLibertyBoard[5][6] = "white";
  twoLibertyBoard[4][5] = "black";
  twoLibertyBoard[4][6] = "black";
  twoLibertyBoard[5][4] = "black";
  twoLibertyBoard[5][7] = "black";
  const atari = ai.chooseGoMctsMove({
    gameType: "go",
    board: twoLibertyBoard,
    aiColor: "black",
    turn: "black",
    moves: 6,
    passCount: 0
  }, options);
  assert.ok(["6,5", "6,6"].includes(`${atari.row},${atari.col}`));

  const connectBoard = Array.from({ length: 19 }, () => Array.from({ length: 19 }, () => null));
  connectBoard[5][5] = "black";
  connectBoard[5][7] = "black";
  connectBoard[4][6] = "white";
  connectBoard[6][6] = "white";
  const connection = ai.chooseGoMctsMove({
    gameType: "go",
    board: connectBoard,
    aiColor: "black",
    turn: "black",
    moves: 4,
    passCount: 0
  }, options);
  assert.deepEqual(connection, { row: 5, col: 6 });

  const territoryBoard = Array.from({ length: 19 }, () => Array.from({ length: 19 }, () => null));
  territoryBoard[0][1] = "black";
  territoryBoard[1][0] = "black";
  territoryBoard[1][1] = "black";
  territoryBoard[10][10] = "white";
  const ownership = ai.buildGoOwnershipMap(territoryBoard, ai.analyzeGoBoard(territoryBoard));
  assert.equal(ownership.points[0][0].owner, "black");
  assert.ok(ownership.points[0][0].confidence > 0.9);
  const territoryMove = ai.chooseGoMctsMove({
    gameType: "go",
    board: territoryBoard,
    aiColor: "black",
    turn: "black",
    moves: 80,
    passCount: 0
  }, options);
  assert.notDeepEqual(territoryMove, { row: 0, col: 0 });

  const captureAfterPassBoard = Array.from({ length: 19 }, () => Array.from({ length: 19 }, () => null));
  captureAfterPassBoard[0][0] = "white";
  captureAfterPassBoard[0][1] = "black";
  const captureAfterPass = ai.chooseGoMctsMove({
    gameType: "go",
    board: captureAfterPassBoard,
    aiColor: "black",
    turn: "black",
    moves: 80,
    passCount: 1
  }, options);
  assert.deepEqual(captureAfterPass, { row: 1, col: 0 });
});

test("go mcts dynamic budget scales with fighting complexity", () => {
  const quietBoard = Array.from({ length: 19 }, () => Array.from({ length: 19 }, () => null));
  const quiet = ai.goMctsOptionsForRoom({ gameType: "go", board: quietBoard, aiColor: "black", turn: "black" });
  assert.equal(quiet.timeLimitMs, 3000);

  const fightBoard = Array.from({ length: 19 }, () => Array.from({ length: 19 }, () => null));
  fightBoard[0][0] = "white";
  fightBoard[0][1] = "black";
  fightBoard[3][3] = "black";
  fightBoard[3][4] = "white";
  fightBoard[4][3] = "white";
  fightBoard[10][10] = "black";
  fightBoard[10][11] = "white";
  fightBoard[11][10] = "white";
  const complex = ai.goMctsOptionsForRoom({ gameType: "go", board: fightBoard, aiColor: "black", turn: "black" });
  assert.ok(complex.timeLimitMs >= 8500 && complex.timeLimitMs <= 10000);
  assert.ok(complex.maxRolloutMoves >= quiet.maxRolloutMoves);
});

test("go ai fallback remains legal when mcts worker is unavailable", () => {
  const board = Array.from({ length: 19 }, () => Array.from({ length: 19 }, () => null));
  board[0][0] = "white";
  board[0][1] = "black";
  const fallback = ai.chooseAiMove({
    gameType: "go",
    board,
    aiColor: "black",
    turn: "black",
    moves: 2,
    passCount: 0
  });
  assert.deepEqual(fallback, { row: 1, col: 0 });
});
