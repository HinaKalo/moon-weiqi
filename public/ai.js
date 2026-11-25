const COLORS = {
  black: "black",
  white: "white"
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

const REVERSI_WEIGHTS = [
  [120, -28, 20, 8, 8, 20, -28, 120],
  [-28, -44, -5, -5, -5, -5, -44, -28],
  [20, -5, 15, 3, 3, 15, -5, 20],
  [8, -5, 3, 3, 3, 3, -5, 8],
  [8, -5, 3, 3, 3, 3, -5, 8],
  [20, -5, 15, 3, 3, 15, -5, 20],
  [-28, -44, -5, -5, -5, -5, -44, -28],
  [120, -28, 20, 8, 8, 20, -28, 120]
];

const GO_KOMI = 7.5;
const GO_MCTS_DEFAULTS = {
  timeLimitMs: 5000,
  maxRolloutMoves: 80,
  exploration: 1.4,
  seed: 1
};
const GO_OPENING_KEYS = ["3,3", "3,15", "15,3", "15,15", "9,9", "3,9", "9,3", "9,15", "15,9"];
const GO_STAR_POINTS = new Set(GO_OPENING_KEYS);

export function chooseAiMove(room) {
  if (!room || !room.board || !room.aiColor || room.turn !== room.aiColor) {
    return null;
  }

  if (room.gameType === "gomoku") {
    const point = chooseLineGameMove(room.board, room.aiColor, 5);
    return point ? { row: point.row, col: point.col } : null;
  }

  if (room.gameType === "reversi") {
    const point = chooseReversiMove(room.board, room.aiColor);
    return point ? { row: point.row, col: point.col } : null;
  }

  if (room.gameType === "go") {
    return chooseGoMove(room);
  }

  if (room.gameType === "connect6") {
    const points = chooseConnect6Points(room.board, room.aiColor, Number(room.requiredStones || 2));
    return points.length > 0 ? { points } : null;
  }

  return null;
}

export function chooseGoMove(room) {
  const board = room.board || [];
  const color = room.aiColor;
  const previousBoardHash = room.previousBoardHash || null;
  const legalMoves = goLegalMoves(board, color, previousBoardHash);
  if (legalMoves.length === 0) {
    return { pass: true };
  }

  if (isBoardEmpty(board)) {
    const opening = firstLegalOpening(legalMoves) || legalMoves[0];
    return opening ? { row: opening.row, col: opening.col } : { pass: true };
  }

  const analysis = analyzeGoBoard(board);
  const ownership = buildGoOwnershipMap(board, analysis);
  const candidates = goCandidateMoves(board, legalMoves, color, analysis, ownership);
  let bestMove = null;
  let bestScore = -Infinity;
  for (const move of candidates) {
    const score = scoreGoMove(board, color, move, analysis, ownership);
    if (score > bestScore) {
      bestMove = move;
      bestScore = score;
    }
  }

  const moveCount = Number(room.moves || 0);
  const opponentJustPassed = Number(room.passCount || 0) > 0;
  if (opponentJustPassed && bestScore < 125) {
    return { pass: true };
  }
  if (moveCount > 90 && bestScore < 45) {
    return { pass: true };
  }

  return bestMove ? { row: bestMove.row, col: bestMove.col } : { pass: true };
}

export function goLegalMoves(board, color, previousBoardHash = null) {
  const moves = [];
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board.length; col += 1) {
      if (board[row][col]) {
        continue;
      }

      const simulation = simulateGoMove(board, color, { row, col }, previousBoardHash);
      if (simulation.legal) {
        moves.push({ row, col, simulation });
      }
    }
  }
  return moves;
}

export function chooseGoMctsMove(room, options = {}) {
  const board = room.board || [];
  const color = room.aiColor;
  const previousBoardHash = room.previousBoardHash || null;
  const legalMoves = goLegalMoves(board, color, previousBoardHash);
  if (legalMoves.length === 0) {
    return { pass: true };
  }

  if (isBoardEmpty(board)) {
    const opening = firstLegalOpening(legalMoves) || legalMoves[0];
    return opening ? { row: opening.row, col: opening.col } : { pass: true };
  }

  const dynamicSettings = goMctsOptionsForRoom(room);
  const settings = {
    ...GO_MCTS_DEFAULTS,
    ...dynamicSettings,
    ...options
  };
  const analysis = analyzeGoBoard(board);
  const ownership = buildGoOwnershipMap(board, analysis);
  const rankedMoves = rankGoMoves(board, color, legalMoves, { analysis, ownership });
  const bestScore = rankedMoves[0]?.score ?? -Infinity;
  if (shouldGoPass(room, bestScore)) {
    return { pass: true };
  }

  const rng = createRng(settings.seed);
  const rootState = createGoMctsState(board, color, previousBoardHash, Number(room.passCount || 0), Number(room.moves || 0));
  const rootMoves = goMctsRootMoves(board, color, rankedMoves, room, settings);
  if (rootMoves.length === 0) {
    return chooseGoMove(room);
  }

  const root = createMctsNode(null, null, rootState);
  root.untriedMoves = rootMoves.map((move) => moveToAction(move));
  const start = Date.now();
  const end = start + Number(settings.timeLimitMs || 0);
  const maxIterations = Number.isFinite(settings.maxIterations) ? Number(settings.maxIterations) : Infinity;
  let iterations = 0;

  while (iterations < maxIterations && (iterations === 0 || Date.now() < end)) {
    const node = treePolicy(root, settings, rng, color);
    const winner = rolloutGo(node.state, color, settings, rng);
    backpropagate(node, winner, color);
    iterations += 1;
  }

  const bestChild = root.children
    .filter((child) => child.move && child.visits > 0)
    .sort((a, b) => goMctsFinalScore(b) - goMctsFinalScore(a))[0];

  if (!bestChild) {
    return chooseGoMove(room);
  }

  return actionToPayload(bestChild.move);
}

export function chooseLineGameMove(board, color, winLength) {
  const candidates = lineCandidates(board, 2);
  if (candidates.length === 0) {
    return centerPoint(board);
  }

  const opponent = oppositeColor(color);
  const ownWin = candidates.find((point) => wouldWin(board, point, color, winLength));
  if (ownWin) {
    return ownWin;
  }

  const blockWin = candidates.find((point) => wouldWin(board, point, opponent, winLength));
  if (blockWin) {
    return blockWin;
  }

  return maxBy(candidates, (point) => {
    const ownScore = scoreLinePoint(board, point, color, winLength);
    const blockScore = scoreLinePoint(board, point, opponent, winLength) * 0.9;
    return ownScore + blockScore + centerBias(board, point) + neighborBias(board, point);
  });
}

export function chooseConnect6Points(board, color, requiredStones = 2) {
  const required = Math.max(1, Math.min(2, Number(requiredStones || 2)));
  if (isBoardEmpty(board)) {
    return [centerPoint(board)].slice(0, required);
  }

  if (required === 1) {
    return [chooseLineGameMove(board, color, 6)].filter(Boolean);
  }

  const candidates = lineCandidates(board, 3)
    .sort((a, b) => scoreConnect6Single(board, b, color) - scoreConnect6Single(board, a, color))
    .slice(0, 26);
  const opponent = oppositeColor(color);

  const ownWins = candidates.filter((point) => wouldWin(board, point, color, 6));
  if (ownWins.length > 0) {
    return fillConnect6Points(board, ownWins.slice(0, 2), color, required);
  }

  const urgentBlocks = candidates.filter((point) => wouldWin(board, point, opponent, 6));
  if (urgentBlocks.length >= required) {
    return urgentBlocks.slice(0, required);
  }
  if (urgentBlocks.length > 0) {
    return fillConnect6Points(board, urgentBlocks, color, required);
  }

  let bestPair = null;
  let bestScore = -Infinity;
  for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex += 1) {
      const first = candidates[firstIndex];
      const second = candidates[secondIndex];
      const score = scoreConnect6Pair(board, first, second, color);
      if (score > bestScore) {
        bestScore = score;
        bestPair = [first, second];
      }
    }
  }

  return fillConnect6Points(board, bestPair || candidates.slice(0, 2), color, required);
}

export function chooseReversiMove(board, color) {
  const legalMoves = reversiLegalMoves(board, color);
  if (legalMoves.length === 0) {
    return null;
  }

  let bestMove = legalMoves[0];
  let bestScore = -Infinity;
  for (const move of legalMoves) {
    const nextBoard = applyReversiMove(board, color, move);
    const nextTurn = nextReversiTurn(nextBoard, oppositeColor(color));
    const score = reversiSearch(nextBoard, nextTurn, color, 2, -Infinity, Infinity);
    const rootScore = score + move.flips.length * 2 + REVERSI_WEIGHTS[move.row][move.col];
    if (rootScore > bestScore) {
      bestScore = rootScore;
      bestMove = move;
    }
  }

  return { row: bestMove.row, col: bestMove.col };
}

export function reversiLegalMoves(board, color) {
  const moves = [];
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board.length; col += 1) {
      if (board[row][col]) {
        continue;
      }

      const flips = reversiFlips(board, color, row, col);
      if (flips.length > 0) {
        moves.push({ row, col, flips });
      }
    }
  }
  return moves;
}

function reversiSearch(board, turn, aiColor, depth, alpha, beta) {
  if (!turn || depth === 0) {
    return evaluateReversi(board, aiColor);
  }

  const legalMoves = reversiLegalMoves(board, turn);
  if (legalMoves.length === 0) {
    return evaluateReversi(board, aiColor);
  }

  const maximizing = turn === aiColor;
  let best = maximizing ? -Infinity : Infinity;
  for (const move of legalMoves) {
    const nextBoard = applyReversiMove(board, turn, move);
    const nextTurn = nextReversiTurn(nextBoard, oppositeColor(turn));
    const score = reversiSearch(nextBoard, nextTurn, aiColor, depth - 1, alpha, beta);

    if (maximizing) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, best);
    }

    if (beta <= alpha) {
      break;
    }
  }
  return best;
}

function evaluateReversi(board, aiColor) {
  const opponent = oppositeColor(aiColor);
  let score = 0;
  let aiDiscs = 0;
  let opponentDiscs = 0;

  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board.length; col += 1) {
      if (board[row][col] === aiColor) {
        aiDiscs += 1;
        score += REVERSI_WEIGHTS[row][col];
      } else if (board[row][col] === opponent) {
        opponentDiscs += 1;
        score -= REVERSI_WEIGHTS[row][col];
      }
    }
  }

  const aiMobility = reversiLegalMoves(board, aiColor).length;
  const opponentMobility = reversiLegalMoves(board, opponent).length;
  score += (aiMobility - opponentMobility) * 12;
  score += (aiDiscs - opponentDiscs) * 2;
  score += cornerScore(board, aiColor) * 80;
  score -= cornerScore(board, opponent) * 80;
  return score;
}

function cornerScore(board, color) {
  const last = board.length - 1;
  return [[0, 0], [0, last], [last, 0], [last, last]]
    .filter(([row, col]) => board[row][col] === color)
    .length;
}

function nextReversiTurn(board, preferredColor) {
  if (reversiLegalMoves(board, preferredColor).length > 0) {
    return preferredColor;
  }

  const other = oppositeColor(preferredColor);
  return reversiLegalMoves(board, other).length > 0 ? other : null;
}

function applyReversiMove(board, color, move) {
  const nextBoard = cloneBoard(board);
  const flips = move.flips || reversiFlips(board, color, move.row, move.col);
  nextBoard[move.row][move.col] = color;
  for (const flip of flips) {
    nextBoard[flip.row][flip.col] = color;
  }
  return nextBoard;
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

export function analyzeGoBoard(board) {
  const groups = [];
  const pointToGroup = new Map();
  const visited = new Set();

  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board.length; col += 1) {
      if (!board[row][col] || visited.has(`${row},${col}`)) {
        continue;
      }

      const group = collectGoGroup(board, row, col);
      group.id = groups.length;
      group.color = board[row][col];
      group.neighborGroupIds = new Set();
      group.libertyPoints = [...group.liberties].map(keyToPoint);
      groups.push(group);

      for (const stone of group.stones) {
        const key = pointKey(stone);
        visited.add(key);
        pointToGroup.set(key, group);
      }
    }
  }

  for (const group of groups) {
    for (const stone of group.stones) {
      for (const neighbor of neighbors(stone.row, stone.col, board.length)) {
        const neighborGroup = pointToGroup.get(pointKey(neighbor));
        if (neighborGroup && neighborGroup.id !== group.id) {
          group.neighborGroupIds.add(neighborGroup.id);
        }
      }
    }
  }

  return {
    groups,
    pointToGroup,
    oneLibertyGroups: groups.filter((group) => group.liberties.size === 1),
    twoLibertyGroups: groups.filter((group) => group.liberties.size === 2),
    weakGroups: groups.filter((group) => group.liberties.size <= 2)
  };
}

export function buildGoOwnershipMap(board, analysis = analyzeGoBoard(board)) {
  const size = board.length;
  const points = Array.from({ length: size }, () => Array.from({ length: size }, () => null));
  const regionOwners = new Map();
  const visited = new Set();

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (board[row][col] || visited.has(`${row},${col}`)) {
        continue;
      }

      const region = floodEmptyRegion(board, row, col, visited);
      if (region.borderColors.size === 1) {
        const owner = [...region.borderColors][0];
        for (const point of region.points) {
          regionOwners.set(pointKey(point), owner);
        }
      }
    }
  }

  const totals = { black: 0, white: 0, neutral: 0 };
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (board[row][col]) {
        continue;
      }

      const point = { row, col };
      const influence = goPointInfluence(board, point, analysis);
      const regionOwner = regionOwners.get(pointKey(point));
      if (regionOwner) {
        influence[regionOwner] += 2.6 + goEdgeOwnershipWeight(board, point);
      }

      const total = influence.black + influence.white;
      const diff = influence.black - influence.white;
      const confidence = total > 0 ? Math.min(1, Math.abs(diff) / total) : 0;
      const owner = confidence >= 0.18 ? (diff > 0 ? COLORS.black : COLORS.white) : null;
      if (owner) {
        totals[owner] += 0.45 + confidence * 0.55;
      } else {
        totals.neutral += 1;
      }
      points[row][col] = {
        row,
        col,
        black: influence.black,
        white: influence.white,
        owner,
        confidence
      };
    }
  }

  return { points, totals };
}

export function goMctsOptionsForRoom(room = {}) {
  const board = room.board || [];
  if (!board.length) {
    return { timeLimitMs: 3000, maxRolloutMoves: 70, exploration: 1.4 };
  }

  const color = room.aiColor || room.turn || COLORS.black;
  const analysis = analyzeGoBoard(board);
  const stones = boardStoneCount(board);
  const complexity = goFightComplexity(board, color, analysis);
  let timeLimitMs = 5000;
  if (stones <= 12 && complexity < 3) {
    timeLimitMs = 3000;
  } else if (complexity >= 10) {
    timeLimitMs = 10000;
  } else if (complexity >= 6) {
    timeLimitMs = 8500;
  } else if (complexity >= 3) {
    timeLimitMs = 6500;
  } else if (stones < 60) {
    timeLimitMs = 4500;
  } else if (stones > 180) {
    timeLimitMs = 3500;
  }

  return {
    timeLimitMs,
    maxRolloutMoves: complexity >= 6 ? 110 : stones > 140 ? 70 : 90,
    exploration: 1.4
  };
}

function goCandidateMoves(board, legalMoves, color = null, analysis = analyzeGoBoard(board), ownership = null, useOwnership = true) {
  const stones = boardStoneCount(board);
  const legalByKey = new Map(legalMoves.map((move) => [pointKey(move), move]));
  const candidates = [];
  const addByKey = (key) => {
    const move = legalByKey.get(key);
    if (move) {
      candidates.push(move);
    }
  };

  if (stones <= 10) {
    for (const key of GO_OPENING_KEYS) {
      addByKey(key);
    }
  }

  if (color) {
    for (const key of goTacticalCandidateKeys(board, color, analysis)) {
      addByKey(key);
    }
    if (useOwnership) {
      for (const move of goOwnershipCandidateMoves(board, legalMoves, color, ownership || buildGoOwnershipMap(board, analysis))) {
        candidates.push(move);
      }
    }
  }

  return uniqueMoves([...candidates, ...nearbyGoMoves(board, legalMoves)]);
}

function nearbyGoMoves(board, legalMoves) {
  const candidateKeys = new Set();
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board.length; col += 1) {
      if (!board[row][col]) {
        continue;
      }

      for (let rowOffset = -2; rowOffset <= 2; rowOffset += 1) {
        for (let colOffset = -2; colOffset <= 2; colOffset += 1) {
          const nextRow = row + rowOffset;
          const nextCol = col + colOffset;
          if (isOnBoard(board, nextRow, nextCol) && !board[nextRow][nextCol]) {
            candidateKeys.add(`${nextRow},${nextCol}`);
          }
        }
      }
    }
  }

  const nearby = legalMoves.filter((move) => candidateKeys.has(pointKey(move)));
  return nearby.length > 0 ? nearby : legalMoves;
}

function firstLegalOpening(legalMoves) {
  const legalByKey = new Map(legalMoves.map((move) => [pointKey(move), move]));
  for (const key of GO_OPENING_KEYS) {
    const move = legalByKey.get(key);
    if (move) {
      return move;
    }
  }
  return null;
}

function uniqueMoves(moves) {
  const seen = new Set();
  const result = [];
  for (const move of moves) {
    const key = pointKey(move);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(move);
    }
  }
  return result;
}

function shouldGoPass(room, bestScore) {
  const moveCount = Number(room.moves || 0);
  const opponentJustPassed = Number(room.passCount || 0) > 0;
  if (opponentJustPassed && bestScore < 125) {
    return true;
  }
  return moveCount > 120 && bestScore < 55;
}

function rankGoMoves(board, color, legalMoves, context = {}) {
  const analysis = context.analysis || analyzeGoBoard(board);
  const ownership = context.skipOwnership ? null : context.ownership || buildGoOwnershipMap(board, analysis);
  const candidateKeys = new Set(goCandidateMoves(board, legalMoves, color, analysis, ownership, !context.skipOwnership).map(pointKey));
  return legalMoves
    .map((move) => ({
      ...move,
      score: scoreGoMove(board, color, move, analysis, ownership) + (candidateKeys.has(pointKey(move)) ? 18 : 0)
    }))
    .sort((a, b) => b.score - a.score || centerBias(board, b) - centerBias(board, a));
}

function goMctsRootMoves(board, color, rankedMoves, room, settings = {}) {
  const moveCount = Number(room.moves || 0);
  const baseLimit = moveCount < 30 ? 16 : moveCount < 120 ? 32 : 48;
  const limit = Number(settings.rootMoveLimit || baseLimit);
  const tactical = rankedMoves.filter((move) => move.score >= 145);
  const positional = rankedMoves.slice(0, limit);
  return uniqueMoves([...tactical, ...positional]).slice(0, Math.max(limit, tactical.length));
}

function goPointInfluence(board, point, analysis) {
  const influence = { black: 0, white: 0 };
  const radius = 5;
  for (let row = Math.max(0, point.row - radius); row <= Math.min(board.length - 1, point.row + radius); row += 1) {
    for (let col = Math.max(0, point.col - radius); col <= Math.min(board.length - 1, point.col + radius); col += 1) {
      const color = board[row][col];
      if (!color) {
        continue;
      }

      const distance = Math.abs(point.row - row) + Math.abs(point.col - col);
      if (distance === 0 || distance > radius + 1) {
        continue;
      }

      const group = analysis.pointToGroup.get(`${row},${col}`);
      const strength = goGroupStrength(group);
      influence[color] += strength / Math.max(1, distance);
    }
  }
  return influence;
}

function goGroupStrength(group) {
  if (!group) {
    return 1;
  }
  let strength = 1 + Math.min(group.stones.length, 12) * 0.04 + Math.min(group.liberties.size, 8) * 0.07;
  if (group.liberties.size === 1) {
    strength *= 0.35;
  } else if (group.liberties.size === 2) {
    strength *= 0.65;
  }
  return strength;
}

function goEdgeOwnershipWeight(board, point) {
  const edgeDistance = Math.min(point.row, point.col, board.length - 1 - point.row, board.length - 1 - point.col);
  if (edgeDistance === 0) {
    return 0.35;
  }
  if (edgeDistance === 1) {
    return 0.22;
  }
  return 0;
}

function goFightComplexity(board, color, analysis) {
  const opponent = oppositeColor(color);
  let complexity = 0;
  for (const group of analysis.groups) {
    if (group.liberties.size === 1) {
      complexity += 2.8 + Math.min(group.stones.length, 5) * 0.45;
    } else if (group.liberties.size === 2) {
      complexity += 1.25 + Math.min(group.stones.length, 5) * 0.25;
    }

    for (const neighborId of group.neighborGroupIds) {
      const neighbor = analysis.groups[neighborId];
      if (neighbor && neighbor.color !== group.color && group.liberties.size <= 3 && neighbor.liberties.size <= 3) {
        complexity += 0.35;
      }
    }
  }

  const ownWeak = analysis.weakGroups.filter((group) => group.color === color).length;
  const opponentWeak = analysis.weakGroups.filter((group) => group.color === opponent).length;
  complexity += Math.min(4, ownWeak + opponentWeak) * 0.6;
  return complexity;
}

function goTacticalCandidateKeys(board, color, analysis) {
  const opponent = oppositeColor(color);
  const keys = new Set();

  for (const group of analysis.groups) {
    if (group.liberties.size <= 2) {
      for (const liberty of group.liberties) {
        keys.add(liberty);
      }
    }
  }

  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board.length; col += 1) {
      if (board[row][col]) {
        continue;
      }

      const point = { row, col };
      const adjacentOwn = adjacentGoGroups(board, point, color, analysis);
      const adjacentOpponent = adjacentGoGroups(board, point, opponent, analysis);
      if (adjacentOwn.length >= 2 || adjacentOpponent.length >= 2) {
        keys.add(pointKey(point));
      }
    }
  }

  return keys;
}

function goOwnershipCandidateMoves(board, legalMoves, color, ownership) {
  if (!ownership) {
    return [];
  }

  const opponent = oppositeColor(color);
  return legalMoves
    .map((move) => {
      const info = ownership.points[move.row]?.[move.col];
      if (!info) {
        return { ...move, ownershipScore: 0 };
      }
      let score = 0;
      if (!info.owner) {
        score += 20 * (1 - info.confidence);
      } else if (info.owner === opponent) {
        score += 16 + info.confidence * 18;
      } else if (info.confidence > 0.7) {
        score -= 24 + info.confidence * 20;
      }
      score += centerBias(board, move) * 0.15;
      return { ...move, ownershipScore: score };
    })
    .filter((move) => move.ownershipScore > 10)
    .sort((a, b) => b.ownershipScore - a.ownershipScore)
    .slice(0, 12);
}

function createGoMctsState(board, turn, previousBoardHash, passCount, moves) {
  return {
    board: cloneBoard(board),
    turn,
    previousBoardHash,
    boardHash: boardHash(board),
    passCount,
    moves
  };
}

function createMctsNode(parent, move, state) {
  return {
    parent,
    move,
    state,
    children: [],
    untriedMoves: null,
    visits: 0,
    wins: 0,
    prior: move?.prior || 0
  };
}

function treePolicy(root, settings, rng, rootColor) {
  let node = root;
  while (!isGoTerminal(node.state)) {
    ensureNodeMoves(node, settings, rng);
    if (node.untriedMoves.length > 0) {
      return expandNode(node, settings, rng);
    }
    if (node.children.length === 0) {
      return node;
    }
    node = bestUctChild(node, Number(settings.exploration || 1.4), rootColor);
  }
  return node;
}

function ensureNodeMoves(node, settings, rng) {
  if (node.untriedMoves) {
    return;
  }
  node.untriedMoves = goMctsPolicyActions(node.state, settings, rng);
}

function expandNode(node, settings, rng) {
  const selectedAction = node.parent
    ? weightedAction(node.untriedMoves, rng)
    : maxBy(node.untriedMoves, (action) => Number(action.prior || 0));
  const index = Math.max(0, node.untriedMoves.indexOf(selectedAction));
  const [action] = node.untriedMoves.splice(index, 1);
  const nextState = applyGoAction(node.state, action);
  const child = createMctsNode(node, action, nextState);
  node.children.push(child);
  return child;
}

function bestUctChild(node, exploration, rootColor) {
  const parentVisits = Math.max(1, node.visits);
  return node.children.reduce((best, child) => {
    const winRate = childWinRate(child);
    const exploit = node.state.turn === rootColor ? winRate : 1 - winRate;
    const explore = exploration * Math.sqrt(Math.log(parentVisits + 1) / Math.max(1, child.visits));
    const policyBonus = Math.min(0.35, Math.max(0, child.prior || 0) * 0.002);
    const score = exploit + explore + policyBonus;
    return !best || score > best.score ? { node: child, score } : best;
  }, null).node;
}

function rolloutGo(startState, rootColor, settings, rng) {
  let state = cloneGoState(startState);
  const maxMoves = Number(settings.maxRolloutMoves || 80);
  for (let index = 0; index < maxMoves && !isGoTerminal(state); index += 1) {
    const actions = goMctsPolicyActions(state, { ...settings, rollout: true }, rng);
    const action = weightedAction(actions, rng) || { pass: true, prior: 0 };
    state = applyGoAction(state, action);
  }

  const score = scoreGoBoard(state.board);
  if (score.black === score.white) {
    return null;
  }
  return score.black > score.white ? COLORS.black : COLORS.white;
}

function backpropagate(node, winner, rootColor) {
  let current = node;
  while (current) {
    current.visits += 1;
    if (!winner) {
      current.wins += 0.5;
    } else if (winner === rootColor) {
      current.wins += 1;
    }
    current = current.parent;
  }
}

function childWinRate(child) {
  return child.visits > 0 ? child.wins / child.visits : 0.5;
}

function goMctsFinalScore(child) {
  const prior = Math.sqrt(Math.max(0, Number(child.prior || 0)));
  return child.visits + childWinRate(child) * 10 + prior * 5;
}

function goMctsPolicyActions(state, settings, rng) {
  const legalMoves = goLegalMoves(state.board, state.turn, state.previousBoardHash);
  if (legalMoves.length === 0) {
    return [{ pass: true, prior: 0 }];
  }

  const analysis = analyzeGoBoard(state.board);
  const ranked = rankGoMoves(state.board, state.turn, legalMoves, { analysis, skipOwnership: Boolean(settings.rollout) });
  const tactical = ranked.filter((move) => move.score >= 150);
  const moveLimit = settings.rollout ? 12 : state.moves < 30 ? 16 : state.moves < 120 ? 28 : 38;
  const selected = uniqueMoves([...tactical, ...ranked.slice(0, moveLimit)]);
  const actions = selected.map((move) => moveToAction(move));
  const bestScore = ranked[0]?.score ?? -Infinity;

  if ((state.passCount > 0 && bestScore < 125) || (state.moves > 140 && bestScore < 60)) {
    actions.push({ pass: true, prior: 30 });
  }
  if (settings.rollout && state.moves > 160 && bestScore < 90) {
    actions.push({ pass: true, prior: 25 });
  }

  if (settings.rollout) {
    return actions.sort((a, b) => b.prior - a.prior).slice(0, Math.min(actions.length, 12));
  }
  shuffle(actions, rng);
  return actions;
}

function applyGoAction(state, action) {
  if (action.pass) {
    return {
      ...cloneGoState(state),
      turn: oppositeColor(state.turn),
      passCount: Number(state.passCount || 0) + 1,
      moves: Number(state.moves || 0) + 1
    };
  }

  const simulation = simulateGoMove(state.board, state.turn, action, state.previousBoardHash);
  if (!simulation.legal) {
    return applyGoAction(state, { pass: true });
  }

  return {
    board: simulation.board,
    turn: oppositeColor(state.turn),
    previousBoardHash: state.boardHash || boardHash(state.board),
    boardHash: simulation.nextHash,
    passCount: 0,
    moves: Number(state.moves || 0) + 1
  };
}

function isGoTerminal(state) {
  return Number(state.passCount || 0) >= 2 || isBoardFull(state.board);
}

function cloneGoState(state) {
  return {
    board: cloneBoard(state.board),
    turn: state.turn,
    previousBoardHash: state.previousBoardHash || null,
    boardHash: state.boardHash || boardHash(state.board),
    passCount: Number(state.passCount || 0),
    moves: Number(state.moves || 0)
  };
}

function moveToAction(move) {
  return {
    row: move.row,
    col: move.col,
    prior: Math.max(0, Number(move.score || 0))
  };
}

function actionToPayload(action) {
  return action.pass ? { pass: true } : { row: action.row, col: action.col };
}

function weightedAction(actions, rng) {
  if (actions.length === 0) {
    return null;
  }

  const total = actions.reduce((sum, action) => sum + Math.max(1, action.prior || 0), 0);
  let target = rng() * total;
  for (const action of actions) {
    target -= Math.max(1, action.prior || 0);
    if (target <= 0) {
      return action;
    }
  }
  return actions[actions.length - 1];
}

function scoreGoBoard(board) {
  const stones = countColors(board);
  const analysis = analyzeGoBoard(board);
  const ownership = buildGoOwnershipMap(board, analysis);
  const weakPenalty = { black: 0, white: 0 };
  for (const group of analysis.groups) {
    if (group.liberties.size === 1) {
      weakPenalty[group.color] += 2.2 + group.stones.length * 1.25;
    } else if (group.liberties.size === 2) {
      weakPenalty[group.color] += 0.7 + group.stones.length * 0.45;
    }
  }

  return {
    black: stones.black + ownership.totals.black - weakPenalty.black,
    white: stones.white + ownership.totals.white - weakPenalty.white + GO_KOMI
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

function scoreGoMove(board, color, move, analysis = analyzeGoBoard(board), ownership = null) {
  const opponent = oppositeColor(color);
  const simulation = move.simulation || simulateGoMove(board, color, move);
  if (!simulation.legal) {
    return -Infinity;
  }
  const scoredMove = move.simulation ? move : { ...move, simulation };
  let score = 0;

  score += simulation.captured * 260;
  score += savedOwnGroupScore(board, color, scoredMove, analysis);
  score += attackedOpponentGroupScore(board, opponent, scoredMove, analysis);
  score += goConnectionCutScore(board, color, scoredMove, analysis);
  score += goShapeScore(board, color, scoredMove);
  score += goOwnershipMoveScore(board, color, scoredMove, ownership);
  score += goLocalFightReadScore(board, color, scoredMove, analysis, simulation);
  score += goOpeningBias(board, scoredMove);

  if (isOwnEye(board, scoredMove, color) && simulation.captured === 0) {
    score -= 260;
  }
  if (simulation.ownGroup.liberties.size <= 1 && simulation.captured === 0) {
    score -= 240;
  } else if (simulation.ownGroup.liberties.size === 2 && simulation.captured === 0 && adjacentGoGroups(board, scoredMove, opponent, analysis).length > 0) {
    score -= 70;
  }

  return score;
}

function savedOwnGroupScore(board, color, move, analysis = analyzeGoBoard(board)) {
  let score = 0;
  const seen = new Set();
  for (const group of adjacentGoGroups(board, move, color, analysis)) {
    if (seen.has(group.id)) {
      continue;
    }
    seen.add(group.id);
    if (group.liberties.size === 1 && group.liberties.has(pointKey(move))) {
      score += 260 + group.stones.length * 28;
      score += goEscapeQuality(board, color, move, group) * 35;
    } else if (group.liberties.has(pointKey(move))) {
      score += 28 + Math.min(group.stones.length, 8) * 5;
    }
  }
  return score;
}

function attackedOpponentGroupScore(board, opponent, move, analysis = analyzeGoBoard(board)) {
  let score = 0;
  const seen = new Set();
  for (const group of adjacentGoGroups(board, move, opponent, analysis)) {
    if (seen.has(group.id)) {
      continue;
    }
    seen.add(group.id);
    if (group.liberties.size === 1 && group.liberties.has(pointKey(move))) {
      score += 320 + group.stones.length * 36;
    } else if (group.liberties.size === 2 && group.liberties.has(pointKey(move))) {
      score += 185 + group.stones.length * 18;
    }
  }
  return score;
}

function goConnectionCutScore(board, color, move, analysis) {
  const opponent = oppositeColor(color);
  const ownGroups = adjacentGoGroups(board, move, color, analysis);
  const opponentGroups = adjacentGoGroups(board, move, opponent, analysis);
  let score = 0;

  if (ownGroups.length >= 2) {
    score += 75;
    for (const group of ownGroups) {
      score += Math.max(0, 4 - Math.min(group.liberties.size, 4)) * 20;
      score += Math.min(group.stones.length, 6) * 4;
    }
  }

  if (opponentGroups.length >= 2) {
    score += 48;
    for (const group of opponentGroups) {
      score += Math.max(0, 4 - Math.min(group.liberties.size, 4)) * 16;
    }
  }

  let diagonalOwn = 0;
  let diagonalOpponent = 0;
  for (const [rowStep, colStep] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const row = move.row + rowStep;
    const col = move.col + colStep;
    if (!isOnBoard(board, row, col)) {
      continue;
    }
    if (board[row][col] === color) {
      diagonalOwn += 1;
    } else if (board[row][col] === opponent) {
      diagonalOpponent += 1;
    }
  }
  score += diagonalOwn * 12 + diagonalOpponent * 8;
  return score;
}

function goOwnershipMoveScore(board, color, move, ownership) {
  if (!ownership) {
    return 0;
  }

  const opponent = oppositeColor(color);
  const info = ownership.points[move.row]?.[move.col];
  if (!info) {
    return 0;
  }

  let score = 0;
  if (!info.owner) {
    score += 34 * (1 - info.confidence);
  } else if (info.owner === opponent) {
    score += 20 + info.confidence * 22;
  } else if (info.confidence > 0.72) {
    score -= 50 + info.confidence * 30;
  } else {
    score += 8;
  }

  for (let row = Math.max(0, move.row - 2); row <= Math.min(board.length - 1, move.row + 2); row += 1) {
    for (let col = Math.max(0, move.col - 2); col <= Math.min(board.length - 1, move.col + 2); col += 1) {
      const nearby = ownership.points[row]?.[col];
      if (!nearby || board[row][col]) {
        continue;
      }
      const distance = Math.max(1, Math.abs(move.row - row) + Math.abs(move.col - col));
      if (nearby.owner === opponent) {
        score += nearby.confidence * (8 / distance);
      } else if (!nearby.owner) {
        score += (1 - nearby.confidence) * (5 / distance);
      }
    }
  }

  return score;
}

function goLocalFightReadScore(board, color, move, analysis, simulation) {
  const opponent = oppositeColor(color);
  const adjacentOwn = adjacentGoGroups(board, move, color, analysis);
  const adjacentOpponent = adjacentGoGroups(board, move, opponent, analysis);
  if (adjacentOwn.length === 0 && adjacentOpponent.length === 0 && simulation.captured === 0) {
    return 0;
  }

  let score = 0;
  const nextAnalysis = analyzeGoBoard(simulation.board);
  const ownGroup = nextAnalysis.pointToGroup.get(pointKey(move));
  if (ownGroup?.liberties.size === 1 && simulation.captured === 0) {
    const capturePoint = keyToPoint([...ownGroup.liberties][0]);
    const reply = simulateGoMove(simulation.board, opponent, capturePoint);
    if (reply.legal) {
      score -= 190 + ownGroup.stones.length * 18;
    }
  }

  for (const group of adjacentOpponent) {
    if (!group.liberties.has(pointKey(move))) {
      continue;
    }
    if (group.liberties.size === 1) {
      score += 120 + group.stones.length * 22;
    } else if (group.liberties.size === 2) {
      const remaining = [...group.liberties].filter((key) => key !== pointKey(move)).map(keyToPoint)[0];
      if (remaining) {
        const defenderReply = simulateGoMove(simulation.board, opponent, remaining);
        score += defenderReply.legal ? 65 : 120;
      }
    }
  }

  if (adjacentOpponent.length > 0 && adjacentOwn.length === 0 && ownGroup?.liberties.size <= 2 && simulation.captured === 0) {
    score -= 120;
  }

  return score;
}

function goEscapeQuality(board, color, move, group) {
  const simulation = simulateGoMove(board, color, move);
  if (!simulation.legal) {
    return -2;
  }
  const liberties = simulation.ownGroup.liberties.size;
  if (liberties >= 3) {
    return 2;
  }
  if (liberties === 2) {
    return 0.8;
  }
  return -1.2;
}

function adjacentGoGroups(board, point, color, analysis) {
  const groups = [];
  const seen = new Set();
  for (const neighbor of neighbors(point.row, point.col, board.length)) {
    if (board[neighbor.row][neighbor.col] !== color) {
      continue;
    }
    const group = analysis.pointToGroup.get(pointKey(neighbor));
    if (group && !seen.has(group.id)) {
      seen.add(group.id);
      groups.push(group);
    }
  }
  return groups;
}

function goShapeScore(board, color, move) {
  const opponent = oppositeColor(color);
  let ownNeighbors = 0;
  let opponentNeighbors = 0;
  let diagonalOwn = 0;

  for (const [rowStep, colStep] of DIRECTIONS_4) {
    const row = move.row + rowStep;
    const col = move.col + colStep;
    if (!isOnBoard(board, row, col)) {
      continue;
    }
    if (board[row][col] === color) {
      ownNeighbors += 1;
    } else if (board[row][col] === opponent) {
      opponentNeighbors += 1;
    }
  }

  for (const [rowStep, colStep] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const row = move.row + rowStep;
    const col = move.col + colStep;
    if (isOnBoard(board, row, col) && board[row][col] === color) {
      diagonalOwn += 1;
    }
  }

  const liberties = move.simulation.ownGroup.liberties.size;
  return ownNeighbors * 28 + opponentNeighbors * 18 + diagonalOwn * 10 + Math.min(liberties, 6) * 12;
}

function goOpeningBias(board, move) {
  const stones = boardStoneCount(board);
  let score = 0;
  if (stones <= 24 && GO_STAR_POINTS.has(pointKey(move))) {
    score += 90;
  }

  const edgeDistance = Math.min(move.row, move.col, board.length - 1 - move.row, board.length - 1 - move.col);
  if (edgeDistance >= 2 && edgeDistance <= 5) {
    score += 28;
  } else if (edgeDistance <= 1) {
    score -= 35;
  }

  score += centerBias(board, move) * (stones <= 30 ? 0.8 : 0.25);
  return score;
}

function simulateGoMove(board, color, point, previousBoardHash = null) {
  const nextBoard = cloneBoard(board);
  const opponent = oppositeColor(color);
  let captured = 0;

  nextBoard[point.row][point.col] = color;
  for (const neighbor of neighbors(point.row, point.col, nextBoard.length)) {
    if (nextBoard[neighbor.row][neighbor.col] !== opponent) {
      continue;
    }

    const group = collectGoGroup(nextBoard, neighbor.row, neighbor.col);
    if (group.liberties.size === 0) {
      captured += group.stones.length;
      for (const stone of group.stones) {
        nextBoard[stone.row][stone.col] = null;
      }
    }
  }

  const ownGroup = collectGoGroup(nextBoard, point.row, point.col);
  if (ownGroup.liberties.size === 0) {
    return { legal: false, reason: "suicide" };
  }

  const nextHash = boardHash(nextBoard);
  if (previousBoardHash && nextHash === previousBoardHash) {
    return { legal: false, reason: "ko" };
  }

  return { legal: true, board: nextBoard, captured, ownGroup, nextHash };
}

function isOwnEye(board, point, color) {
  for (const neighbor of neighbors(point.row, point.col, board.length)) {
    if (board[neighbor.row][neighbor.col] !== color) {
      return false;
    }
  }

  const opponent = oppositeColor(color);
  let opponentDiagonals = 0;
  for (const [rowStep, colStep] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const row = point.row + rowStep;
    const col = point.col + colStep;
    if (isOnBoard(board, row, col) && board[row][col] === opponent) {
      opponentDiagonals += 1;
    }
  }

  return opponentDiagonals <= 1;
}

function collectGoGroup(board, startRow, startCol) {
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

function scoreConnect6Single(board, point, color) {
  const opponent = oppositeColor(color);
  return scoreLinePoint(board, point, color, 6)
    + scoreLinePoint(board, point, opponent, 6) * 0.95
    + centerBias(board, point)
    + neighborBias(board, point);
}

function scoreConnect6Pair(board, first, second, color) {
  const boardCopy = cloneBoard(board);
  boardCopy[first.row][first.col] = color;
  boardCopy[second.row][second.col] = color;

  if (hasWinningLineFromPoints(boardCopy, [first, second], color, 6)) {
    return 1_000_000 + centerBias(board, first) + centerBias(board, second);
  }

  const opponent = oppositeColor(color);
  const blockScore = scoreLinePoint(board, first, opponent, 6) + scoreLinePoint(board, second, opponent, 6);
  const attackScore = scoreLinePoint(boardCopy, first, color, 6) + scoreLinePoint(boardCopy, second, color, 6);
  return attackScore + blockScore * 0.8 + centerBias(board, first) + centerBias(board, second);
}

function fillConnect6Points(board, seedPoints, color, required) {
  const result = [];
  for (const point of seedPoints || []) {
    if (point && !board[point.row]?.[point.col] && !result.some((item) => samePoint(item, point))) {
      result.push({ row: point.row, col: point.col });
    }
  }

  while (result.length < required) {
    const boardCopy = cloneBoard(board);
    for (const point of result) {
      boardCopy[point.row][point.col] = color;
    }

    const next = lineCandidates(boardCopy, 3)
      .filter((point) => !result.some((item) => samePoint(item, point)))
      .sort((a, b) => scoreConnect6Single(boardCopy, b, color) - scoreConnect6Single(boardCopy, a, color))[0];
    if (!next) {
      break;
    }
    result.push({ row: next.row, col: next.col });
  }

  return result.slice(0, required);
}

function scoreLinePoint(board, point, color, winLength) {
  let score = 0;
  for (const [rowStep, colStep] of LINE_DIRECTIONS) {
    const forward = countDirection(board, point.row, point.col, color, rowStep, colStep);
    const backward = countDirection(board, point.row, point.col, color, -rowStep, -colStep);
    const length = 1 + forward.count + backward.count;
    const openEnds = Number(forward.open) + Number(backward.open);
    score += lineShapeScore(length, openEnds, winLength);
  }
  return score;
}

function lineShapeScore(length, openEnds, winLength) {
  if (length >= winLength) {
    return 500_000;
  }
  if (length === winLength - 1 && openEnds === 2) {
    return 80_000;
  }
  if (length === winLength - 1) {
    return 35_000;
  }
  if (length === winLength - 2 && openEnds === 2) {
    return 8_000;
  }
  if (length === winLength - 2) {
    return 1_800;
  }
  if (length === winLength - 3 && openEnds === 2) {
    return 650;
  }
  return Math.max(1, length * length * (openEnds + 1));
}

function countDirection(board, row, col, color, rowStep, colStep) {
  let count = 0;
  let nextRow = row + rowStep;
  let nextCol = col + colStep;

  while (isOnBoard(board, nextRow, nextCol) && board[nextRow][nextCol] === color) {
    count += 1;
    nextRow += rowStep;
    nextCol += colStep;
  }

  return {
    count,
    open: isOnBoard(board, nextRow, nextCol) && !board[nextRow][nextCol]
  };
}

function hasWinningLineFromPoints(board, points, color, winLength) {
  return points.some((point) => findWinningLine(board, point.row, point.col, color, winLength));
}

function wouldWin(board, point, color, winLength) {
  board[point.row][point.col] = color;
  const wins = Boolean(findWinningLine(board, point.row, point.col, color, winLength));
  board[point.row][point.col] = null;
  return wins;
}

function findWinningLine(board, row, col, color, winLength) {
  for (const [rowStep, colStep] of LINE_DIRECTIONS) {
    let length = 1;
    for (let nextRow = row + rowStep, nextCol = col + colStep; isOnBoard(board, nextRow, nextCol) && board[nextRow][nextCol] === color; nextRow += rowStep, nextCol += colStep) {
      length += 1;
    }
    for (let nextRow = row - rowStep, nextCol = col - colStep; isOnBoard(board, nextRow, nextCol) && board[nextRow][nextCol] === color; nextRow -= rowStep, nextCol -= colStep) {
      length += 1;
    }
    if (length >= winLength) {
      return true;
    }
  }
  return false;
}

function lineCandidates(board, radius) {
  const occupied = [];
  const candidates = new Map();
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board.length; col += 1) {
      if (board[row][col]) {
        occupied.push({ row, col });
      }
    }
  }

  if (occupied.length === 0) {
    return [centerPoint(board)];
  }

  for (const stone of occupied) {
    for (let row = stone.row - radius; row <= stone.row + radius; row += 1) {
      for (let col = stone.col - radius; col <= stone.col + radius; col += 1) {
        if (isOnBoard(board, row, col) && !board[row][col]) {
          candidates.set(`${row},${col}`, { row, col });
        }
      }
    }
  }

  return [...candidates.values()]
    .sort((a, b) => centerBias(board, b) - centerBias(board, a));
}

function neighborBias(board, point) {
  let score = 0;
  for (const [rowStep, colStep] of DIRECTIONS_8) {
    const row = point.row + rowStep;
    const col = point.col + colStep;
    if (isOnBoard(board, row, col) && board[row][col]) {
      score += 6;
    }
  }
  return score;
}

function centerBias(board, point) {
  const center = (board.length - 1) / 2;
  return Math.max(0, board.length - Math.abs(point.row - center) - Math.abs(point.col - center));
}

function centerPoint(board) {
  const center = Math.floor(board.length / 2);
  return { row: center, col: center };
}

function isBoardEmpty(board) {
  return board.every((row) => row.every((value) => !value));
}

function boardStoneCount(board) {
  let count = 0;
  for (const row of board) {
    for (const value of row) {
      if (value) {
        count += 1;
      }
    }
  }
  return count;
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

function isOnBoard(board, row, col) {
  return row >= 0 && row < board.length && col >= 0 && col < board.length;
}

function pointKey(point) {
  return `${point.row},${point.col}`;
}

function keyToPoint(key) {
  const [row, col] = key.split(",").map(Number);
  return { row, col };
}

function cloneBoard(board) {
  return board.map((row) => [...row]);
}

function oppositeColor(color) {
  return color === COLORS.black ? COLORS.white : COLORS.black;
}

function samePoint(first, second) {
  return first.row === second.row && first.col === second.col;
}

function createRng(seed) {
  let value = Number(seed) >>> 0;
  if (!value) {
    value = 1;
  }
  return () => {
    value += 0x6D2B79F5;
    let next = value;
    next = Math.imul(next ^ next >>> 15, next | 1);
    next ^= next + Math.imul(next ^ next >>> 7, next | 61);
    return ((next ^ next >>> 14) >>> 0) / 4294967296;
  };
}

function shuffle(items, rng) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function maxBy(items, score) {
  let best = items[0] || null;
  let bestScore = best ? score(best) : -Infinity;
  for (const item of items.slice(1)) {
    const itemScore = score(item);
    if (itemScore > bestScore) {
      best = item;
      bestScore = itemScore;
    }
  }
  return best;
}
