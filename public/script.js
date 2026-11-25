import { chooseAiMove, goMctsOptionsForRoom } from "./ai.js";

const CLIENT_ID_KEY = "moon.weiqi.clientId";
const ROOM_KEY = "moon.weiqi.currentRoom";
const GAME_KEY = "moon.weiqi.selectedGame";
const PRESENCE_POLL_MS = 30_000;
const locale = "zh";
const gameUrl = new URL("./", window.location.href);

const GAMES = {
  gomoku: {
    boardSize: 15,
    boardKind: "intersection",
    accent: "coral"
  },
  go: {
    boardSize: 19,
    boardKind: "intersection",
    accent: "blue"
  },
  reversi: {
    boardSize: 8,
    boardKind: "cells",
    accent: "magenta"
  },
  connect6: {
    boardSize: 19,
    boardKind: "intersection",
    accent: "purple"
  }
};

const dictionaries = {
  en: {
    "page.title": "围棋 · Moon GameHub",
    "connection.connecting": "Connecting",
    "connection.online": "Online",
    "connection.onlineCount": "Online: {count}",
    "connection.reconnecting": "Reconnecting",
    "home.eyebrow": "Real-time board games",
    "home.lead": "Choose a game, then play through public matchmaking or a private room.",
    "lobby.publicKicker": "Public Match",
    "lobby.publicTitle": "Public Match",
    "lobby.publicDesc": "Join this game's matchmaking queue. The first player takes black.",
    "lobby.privateKicker": "Private Room",
    "lobby.privateTitle": "Private Room",
    "lobby.privateDesc": "Create a room or join with a room number. The first player takes black.",
    "lobby.aiKicker": "AI Opponent",
    "lobby.aiTitle": "AI Opponent",
    "lobby.aiDesc": "Play this game against AI. Choose your color to begin.",
    "game.gomoku.name": "Gomoku",
    "game.gomoku.kicker": "Five in a row",
    "game.gomoku.desc": "15x15, black first, connect five stones.",
    "game.gomoku.lead": "Standard 15x15 board. Connect five stones horizontally, vertically, or diagonally to win.",
    "game.go.name": "Go",
    "game.go.kicker": "Territory",
    "game.go.desc": "19x19 with captures, ko, pass, and Chinese area scoring.",
    "game.go.lead": "Place stones, capture groups, pass twice to score with Chinese area rules and 7.5 komi.",
    "game.reversi.name": "Reversi",
    "game.reversi.kicker": "Flip discs",
    "game.reversi.desc": "8x8 Othello-style play with legal move highlights.",
    "game.reversi.lead": "Place a disc to bracket and flip opposing discs. The most discs at the end wins.",
    "game.connect6.name": "Connect6",
    "game.connect6.kicker": "Two-stone turns",
    "game.connect6.desc": "19x19. Black opens with one stone, then turns place two.",
    "game.connect6.lead": "Black places one opening stone. After that, each turn places two stones; six in a row wins.",
    "game.room": "Room",
    "game.statusKicker": "Status",
    "roomMode.public": "Public Match",
    "roomMode.private": "Private Room",
    "roomMode.ai": "AI Match",
    "actions.changeGame": "Change Game",
    "actions.startMatch": "Start Matching",
    "actions.cancelMatch": "Cancel Matching",
    "actions.createRoom": "Create Room",
    "actions.playAiBlack": "Play Black vs AI",
    "actions.playAiWhite": "Play White vs AI",
    "actions.join": "Join",
    "actions.copyRoom": "Copy Room Number",
    "actions.restart": "Restart",
    "actions.swapRestart": "Swap Colors and Restart",
    "actions.leave": "Leave Room",
    "actions.later": "Later",
    "actions.swapConfirm": "Swap and Restart",
    "actions.pass": "Pass",
    "actions.resign": "Resign",
    "actions.undoSelection": "Undo Selection",
    "labels.roomNumber": "Room Number",
    "labels.yourColor": "Your Color",
    "labels.currentTurn": "Current Turn",
    "labels.turnTimer": "Move Timer",
    "labels.opponentStatus": "Opponent",
    "labels.moves": "Moves",
    "labels.score": "Score",
    "labels.connect6Pending": "Stones This Turn",
    "placeholders.roomNumber": "e.g. 482913",
    "status.waitingOpponent": "Waiting for opponent",
    "status.matchReady": "Match found",
    "status.youWon": "You won",
    "status.youLost": "You lost",
    "status.draw": "Draw",
    "status.yourTurn": "Your turn",
    "status.waitingMove": "Waiting for opponent",
    "status.aiThinking": "AI is thinking",
    "details.initial": "Choose public matchmaking or create a private room.",
    "details.publicWaiting": "Both players can start once connected.",
    "details.privateWaiting": "Share the room number. The second player takes white.",
    "details.yourTurn": "Choose an empty point to move.",
    "details.goTurn": "Place a stone, pass, or resign.",
    "details.reversiTurn": "Choose a highlighted legal square.",
    "details.connect6Turn": "Select {remaining} more stone(s) to complete this turn.",
    "details.waitingMove": "The board updates after your opponent moves.",
    "details.aiThinking": "The AI is choosing its move.",
    "details.restartRequested": "Your opponent requested a restart. Confirm to reset the board.",
    "details.swapRestartRequested": "Your opponent requested a color swap restart. Confirm to swap colors and reset.",
    "winner.forfeit": "Your opponent left or timed out offline. The game is over.",
    "winner.timeout": "A player ran out of time. The game is over.",
    "winner.line": "A connection was completed. The game is over.",
    "winner.score": "Final score: {score}.",
    "winner.disc_count": "Final disc count: {score}.",
    "winner.resign": "A player resigned.",
    "winner.draw": "The game ended in a draw.",
    "opponent.waiting": "Waiting",
    "opponent.ai": "AI",
    "opponent.online": "Online",
    "opponent.offlineGrace": "Offline grace",
    "color.black": "Black",
    "color.white": "White",
    "color.none": "-",
    "timer.seconds": "{seconds}s",
    "score.go": "B {black} / W {white}",
    "score.reversi": "B {black} / W {white}",
    "score.none": "-",
    "aria.board": "Game board",
    "aria.statusPanel": "Game status",
    "aria.emptyCell": "row {row}, column {col}, empty",
    "aria.pieceCell": "row {row}, column {col}, {color}",
    "aria.legalCell": "row {row}, column {col}, legal move",
    "modal.kicker": "Restart",
    "modal.normalTitle": "Your opponent wants to restart",
    "modal.normalBody": "Confirming will clear the board and black will move first again.",
    "modal.swapTitle": "Your opponent wants to swap colors and restart",
    "modal.swapBody": "Confirming will swap black and white, clear the board, and the new black will move first.",
    "toast.searching": "Looking for an opponent.",
    "toast.cancelled": "Matching cancelled.",
    "toast.leftRoom": "You left the room.",
    "toast.returnedLobby": "Returned to the lobby.",
    "toast.roomClosed": "The room has closed.",
    "toast.restartRequested": "Restart request sent.",
    "toast.swapRestartRequested": "Color swap restart request sent.",
    "toast.inputRoom": "Enter a room number.",
    "toast.chooseGame": "Choose a game first.",
    "toast.roomCopied": "Room number copied.",
    "toast.roomNumber": "Room: {roomId}",
    "error.generic": "Operation failed.",
    "error.missing_client_id": "Missing client identity.",
    "error.invalid_json": "Invalid message format.",
    "error.unknown_message": "Unknown action.",
    "error.invalid_color": "Invalid player color.",
    "error.ai_unsupported": "AI opponent is not available for this game.",
    "error.room_not_found": "Room not found or already closed.",
    "error.invalid_room": "Invalid room number.",
    "error.invalid_game": "Invalid game type.",
    "error.lock_busy": "Room is busy. Try again shortly.",
    "error.room_finished": "This room's game has ended.",
    "error.room_full": "The room is full.",
    "error.not_in_room": "You are not in a room.",
    "error.waiting_for_opponent": "Wait for your opponent to join first.",
    "error.game_finished": "The game has ended.",
    "error.not_your_turn": "It is not your turn yet.",
    "error.invalid_move": "Invalid move.",
    "error.invalid_move_count": "Place the required number of stones.",
    "error.suicide": "That move has no liberties.",
    "error.ko": "That move repeats the previous board position.",
    "error.invalid_action": "That action is not available."
  },
  zh: {
    "page.title": "围棋 · Moon GameHub",
    "connection.connecting": "连接中",
    "connection.online": "在线",
    "connection.onlineCount": "在线人数：{count}",
    "connection.reconnecting": "重连中",
    "home.eyebrow": "实时棋类对弈",
    "home.lead": "选择棋类后，通过公开匹配或私有房间开始对局。",
    "lobby.publicKicker": "公开匹配",
    "lobby.publicTitle": "公开匹配",
    "lobby.publicDesc": "进入该棋类的匹配队列，先进入者执黑棋。",
    "lobby.privateKicker": "私有房间",
    "lobby.privateTitle": "私有房间",
    "lobby.privateDesc": "创建房间或输入房间号加入。先加入者执黑棋。",
    "lobby.aiKicker": "人机对弈",
    "lobby.aiTitle": "人机对弈",
    "lobby.aiDesc": "与 AI 对弈。选择你的棋色后开始。",
    "game.gomoku.name": "五子棋",
    "game.gomoku.kicker": "五子连线",
    "game.gomoku.desc": "15x15，黑棋先行，五子连线获胜。",
    "game.gomoku.lead": "标准 15x15 棋盘。横、竖、斜任意方向五子连线即胜。",
    "game.go.name": "围棋",
    "game.go.kicker": "围地提子",
    "game.go.desc": "19x19，支持提子、劫、停一手和中国数子法。",
    "game.go.lead": "落子、提子、禁自杀、简单劫；双方连续停一手后按中国数子法和 7.5 贴目计分。",
    "game.reversi.name": "黑白棋",
    "game.reversi.kicker": "翻转棋子",
    "game.reversi.desc": "8x8 标准黑白棋，合法落点高亮。",
    "game.reversi.lead": "落子夹住对方棋子并翻转。终局时棋子更多的一方获胜。",
    "game.connect6.name": "六子棋",
    "game.connect6.kicker": "双子回合",
    "game.connect6.desc": "19x19。黑棋第一手一子，之后每回合两子。",
    "game.connect6.lead": "黑棋第一手下一子；之后双方每回合下两子，六子或以上连线获胜。",
    "game.room": "房间",
    "game.statusKicker": "状态",
    "roomMode.public": "公开匹配",
    "roomMode.private": "私有房间",
    "roomMode.ai": "人机对弈",
    "actions.changeGame": "切换棋类",
    "actions.startMatch": "开始匹配",
    "actions.cancelMatch": "取消匹配",
    "actions.createRoom": "创建房间",
    "actions.playAiBlack": "执黑对战 AI",
    "actions.playAiWhite": "执白对战 AI",
    "actions.join": "加入",
    "actions.copyRoom": "复制邀请链接",
    "actions.restart": "重新开始",
    "actions.swapRestart": "交换棋子并重新开始",
    "actions.leave": "离开房间",
    "actions.later": "稍后",
    "actions.swapConfirm": "交换并重新开始",
    "actions.pass": "停一手",
    "actions.resign": "认输",
    "actions.undoSelection": "撤销选择",
    "labels.roomNumber": "房间号",
    "labels.yourColor": "你的棋色",
    "labels.currentTurn": "当前回合",
    "labels.turnTimer": "落子倒计时",
    "labels.opponentStatus": "对手状态",
    "labels.moves": "手数",
    "labels.score": "比分",
    "labels.connect6Pending": "本回合棋子",
    "placeholders.roomNumber": "输入 8 位房号",
    "status.waitingOpponent": "等待对手",
    "status.matchReady": "匹配成功",
    "status.youWon": "你赢了",
    "status.youLost": "你输了",
    "status.draw": "平局",
    "status.yourTurn": "轮到你了",
    "status.waitingMove": "等待对手落子",
    "status.aiThinking": "AI 正在思考",
    "details.initial": "选择公开匹配或创建私有房间。",
    "details.publicWaiting": "双方连接后即可开局。",
    "details.privateWaiting": "分享房间号给对手，第二位玩家将执白棋。",
    "details.yourTurn": "选择一个空位落子。",
    "details.goTurn": "可以落子、停一手或认输。",
    "details.reversiTurn": "选择一个高亮的合法落点。",
    "details.connect6Turn": "还需选择 {remaining} 枚棋子完成本回合。",
    "details.waitingMove": "棋盘会在对手行动后自动更新。",
    "details.aiThinking": "AI 正在选择落点。",
    "details.restartRequested": "对手请求重新开始，点击重新开始即可确认。",
    "details.swapRestartRequested": "对手请求交换棋子并重新开始，确认后双方会交换黑白。",
    "winner.forfeit": "对手超时离线或离开，对局结束。",
    "winner.timeout": "超时未落子，对局结束。",
    "winner.line": "连线完成，对局结束。",
    "winner.score": "终局比分：{score}。",
    "winner.disc_count": "终局棋子数：{score}。",
    "winner.resign": "一方认输。",
    "winner.draw": "对局平局。",
    "opponent.waiting": "等待中",
    "opponent.ai": "AI",
    "opponent.online": "在线",
    "opponent.offlineGrace": "离线保留中",
    "color.black": "黑棋",
    "color.white": "白棋",
    "color.none": "-",
    "timer.seconds": "{seconds} 秒",
    "score.go": "黑 {black} / 白 {white}",
    "score.reversi": "黑 {black} / 白 {white}",
    "score.none": "-",
    "aria.board": "棋盘",
    "aria.statusPanel": "对局状态",
    "aria.emptyCell": "{row} 行 {col} 列，空位",
    "aria.pieceCell": "{row} 行 {col} 列，{color}",
    "aria.legalCell": "{row} 行 {col} 列，合法落点",
    "modal.kicker": "重新开始",
    "modal.normalTitle": "对手想要重新开始对局",
    "modal.normalBody": "点击“重新开始”后，棋盘会清空并由黑棋重新先行。",
    "modal.swapTitle": "对手想要交换棋子并重新开始",
    "modal.swapBody": "点击“交换并重新开始”后，双方会交换黑白棋，棋盘清空并由新的黑棋先行。",
    "toast.searching": "正在寻找对手。",
    "toast.cancelled": "已取消匹配。",
    "toast.leftRoom": "已离开房间。",
    "toast.returnedLobby": "已返回大厅。",
    "toast.roomClosed": "房间已关闭。",
    "toast.restartRequested": "已发送重新开始请求。",
    "toast.swapRestartRequested": "已发送交换棋子并重新开始请求。",
    "toast.inputRoom": "请输入房间号。",
    "toast.chooseGame": "请先选择棋类。",
    "toast.roomCopied": "房间号已复制。",
    "toast.roomNumber": "房间号：{roomId}",
    "error.generic": "操作失败。",
    "error.missing_client_id": "缺少客户端标识。",
    "error.invalid_json": "消息格式无效。",
    "error.unknown_message": "未知操作。",
    "error.invalid_color": "棋色无效。",
    "error.ai_unsupported": "该棋类暂不支持人机对弈。",
    "error.room_not_found": "房间不存在或已关闭。",
    "error.invalid_room": "房间号无效。",
    "error.invalid_game": "棋类无效。",
    "error.lock_busy": "房间繁忙，请稍后再试。",
    "error.room_finished": "该房间对局已结束。",
    "error.room_full": "房间已满。",
    "error.not_in_room": "你还没有加入房间。",
    "error.waiting_for_opponent": "等待对手加入后才能操作。",
    "error.game_finished": "对局已经结束。",
    "error.not_your_turn": "还没轮到你。",
    "error.invalid_move": "无效落子。",
    "error.invalid_move_count": "请下满本回合需要的棋子数量。",
    "error.suicide": "该落子没有气。",
    "error.ko": "该落子会立即重复上一局面。",
    "error.invalid_action": "当前棋类不支持该操作。"
  }
};

const elements = {
  appShell: document.querySelector(".app-shell"),
  connectionStatus: document.querySelector("#connectionStatus"),
  brandButton: document.querySelector("#brandButton"),
  gameSelectView: document.querySelector("#gameSelectView"),
  gameGrid: document.querySelector("#gameGrid"),
  lobbyView: document.querySelector("#lobbyView"),
  backToGamesButton: document.querySelector("#backToGamesButton"),
  selectedGameKicker: document.querySelector("#selectedGameKicker"),
  selectedGameTitle: document.querySelector("#lobbyTitle"),
  selectedGameLead: document.querySelector("#selectedGameLead"),
  gameView: document.querySelector("#gameView"),
  matchButton: document.querySelector("#matchButton"),
  cancelMatchButton: document.querySelector("#cancelMatchButton"),
  aiPanel: document.querySelector("#aiPanel"),
  aiBlackButton: document.querySelector("#aiBlackButton"),
  aiWhiteButton: document.querySelector("#aiWhiteButton"),
  createRoomButton: document.querySelector("#createRoomButton"),
  joinRoomButton: document.querySelector("#joinRoomButton"),
  roomInput: document.querySelector("#roomInput"),
  roomMode: document.querySelector("#roomMode"),
  gameNameInRoom: document.querySelector("#gameNameInRoom"),
  gameTitlePrefix: document.querySelector("#gameTitlePrefix"),
  roomCode: document.querySelector("#roomCode"),
  copyRoomButton: document.querySelector("#copyRoomButton"),
  board: document.querySelector("#board"),
  gameStatus: document.querySelector("#gameStatus"),
  gameDetail: document.querySelector("#gameDetail"),
  yourColor: document.querySelector("#yourColor"),
  turnLabel: document.querySelector("#turnLabel"),
  turnTimer: document.querySelector("#turnTimer"),
  opponentStatus: document.querySelector("#opponentStatus"),
  moveCountLabel: document.querySelector("#moveCountLabel"),
  moveCount: document.querySelector("#moveCount"),
  scoreLabel: document.querySelector("#scoreLabel"),
  passButton: document.querySelector("#passButton"),
  undoConnect6Button: document.querySelector("#undoConnect6Button"),
  resignButton: document.querySelector("#resignButton"),
  restartButton: document.querySelector("#restartButton"),
  swapRestartButton: document.querySelector("#swapRestartButton"),
  leaveButton: document.querySelector("#leaveButton"),
  toast: document.querySelector("#toast"),
  restartModal: document.querySelector("#restartModal"),
  restartModalTitle: document.querySelector("#restartModalTitle"),
  restartModalBody: document.querySelector("#restartModalBody"),
  restartConfirmButton: document.querySelector("#restartConfirmButton"),
  restartDismissButton: document.querySelector("#restartDismissButton")
};

const state = {
  reconnectTimer: null,
  pollingTimer: null,
  presenceTimer: null,
  aiMoveTimer: null,
  aiMoveInFlight: false,
  aiMoveSignature: null,
  goMctsWorker: null,
  goMctsRequestId: 0,
  goMctsPending: null,
  pollInFlight: false,
  clientId: getClientId(),
  selectedGameType: null,
  room: null,
  queued: false,
  online: false,
  onlineCount: null,
  clockOffsetMs: 0,
  lastRoomId: null,
  lastRoomUpdatedAt: 0,
  renderedBoardSize: 0,
  renderedBoardKind: null,
  renderedGameType: null,
  connect6Selection: [],
  restartPromptKey: null,
  suppressedRestartPromptKey: null,
  activeRestartPrompt: null,
  pendingRestartType: "normal",
  currentView: null,
  viewTransitionTimer: null,
  reversiFlipKeys: new Set()
};

const mainViews = {
  gameSelect: elements.gameSelectView,
  lobby: elements.lobbyView,
  game: elements.gameView
};
const mainViewElements = Object.values(mainViews);
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

function t(key, values = {}) {
  const dictionary = dictionaries[locale] || dictionaries.en;
  const template = dictionary[key] || dictionaries.en[key] || key;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
}

function applyStaticI18n() {
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  document.title = t("page.title");

  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n);
  }

  for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
    element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder));
  }

  for (const element of document.querySelectorAll("[data-i18n-aria]")) {
    element.setAttribute("aria-label", t(element.dataset.i18nAria));
  }
}

function getClientId() {
  const existing = localStorage.getItem(CLIENT_ID_KEY);
  if (existing) {
    localStorage.setItem(CLIENT_ID_KEY, existing);
    return existing;
  }

  const next = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
  localStorage.setItem(CLIENT_ID_KEY, next);
  return next;
}

function initializeSelectedGame() {
  selectGame("go", false, { animate: false });
  const invitedRoom = new URL(window.location.href).searchParams.get("room");
  if (/^[A-F0-9]{8}$/.test(invitedRoom || "")) {
    elements.roomInput.value = invitedRoom;
  }
}

function normalizeGameType(value) {
  return typeof value === "string" && GAMES[value] ? value : null;
}

function visibleMainView() {
  return mainViewElements.find((view) => !view.classList.contains("hidden")) || elements.gameSelectView;
}

function setVisibleMainView(targetView) {
  for (const view of mainViewElements) {
    view.classList.toggle("hidden", view !== targetView);
    view.classList.remove("view-enter", "view-exit");
    view.style.removeProperty("--view-exit-top");
    view.style.removeProperty("--view-exit-left");
    view.style.removeProperty("--view-exit-width");
  }
}

function clearViewTransition() {
  clearTimeout(state.viewTransitionTimer);
  state.viewTransitionTimer = null;
  elements.appShell.classList.remove("is-view-transitioning");
  elements.appShell.style.removeProperty("min-height");

  if (state.currentView && mainViews[state.currentView]) {
    setVisibleMainView(mainViews[state.currentView]);
    return;
  }

  setVisibleMainView(visibleMainView());
}

function showMainView(viewName, options = {}) {
  const targetView = mainViews[viewName];
  if (!targetView) {
    return;
  }

  if (state.viewTransitionTimer) {
    clearViewTransition();
  }

  const currentView = mainViews[state.currentView] || visibleMainView();
  const shouldAnimate = options.animate !== false
    && currentView
    && currentView !== targetView
    && !reducedMotionQuery.matches;

  if (!shouldAnimate) {
    setVisibleMainView(targetView);
    state.currentView = viewName;
    return;
  }

  const previousHeight = elements.appShell.offsetHeight;
  currentView.style.setProperty("--view-exit-top", `${currentView.offsetTop}px`);
  currentView.style.setProperty("--view-exit-left", `${currentView.offsetLeft}px`);
  currentView.style.setProperty("--view-exit-width", `${currentView.offsetWidth}px`);
  elements.appShell.style.minHeight = `${previousHeight}px`;
  elements.appShell.classList.add("is-view-transitioning");

  currentView.classList.add("view-exit");
  targetView.classList.remove("hidden");
  targetView.classList.add("view-enter");
  elements.appShell.style.minHeight = `${Math.max(previousHeight, elements.appShell.offsetHeight)}px`;
  state.currentView = viewName;

  state.viewTransitionTimer = setTimeout(() => {
    setVisibleMainView(targetView);
    elements.appShell.classList.remove("is-view-transitioning");
    elements.appShell.style.removeProperty("min-height");
    state.viewTransitionTimer = null;
  }, 360);
}

function selectGame(gameType, updateUrl = true, options = {}) {
  if (!normalizeGameType(gameType)) {
    return;
  }

  state.selectedGameType = gameType;
  localStorage.setItem(GAME_KEY, gameType);
  if (updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set("game", gameType);
    window.history.replaceState({}, "", url);
  }

  updateSelectedGameCopy();
  showMainView("lobby", options);
  setControlsDisabled(!state.online);
}

function showGameSelect(options = {}) {
  if (state.room) {
    return;
  }

  if (state.queued) {
    send("room:leave");
    state.queued = false;
  }

  state.selectedGameType = null;
  localStorage.removeItem(GAME_KEY);
  const url = new URL(window.location.href);
  url.searchParams.delete("game");
  window.history.replaceState({}, "", url);
  showMainView("gameSelect", options);
  setMatchingUi(false);
  setControlsDisabled(!state.online);
}

function updateSelectedGameCopy() {
  const gameType = state.selectedGameType || "gomoku";
  elements.selectedGameKicker.textContent = t(`game.${gameType}.kicker`);
  elements.selectedGameTitle.textContent = t(`game.${gameType}.name`);
  elements.selectedGameLead.textContent = t(`game.${gameType}.lead`);
  elements.aiPanel.classList.remove("hidden");
}

function connect() {
  startHttpTransport();
}

function startHttpTransport() {
  if (state.online) {
    return;
  }

  setConnectionStatus("connecting");
  state.online = true;
  setConnectionStatus("polling");
  clearInterval(state.pollingTimer);

  const roomId = localStorage.getItem(ROOM_KEY);
  if (roomId) {
    httpAction("room:join", { roomId, reconnect: true });
  }

  pollState();
  state.pollingTimer = setInterval(pollState, 1000);
  pollPresence();
  clearInterval(state.presenceTimer);
  state.presenceTimer = setInterval(pollPresence, PRESENCE_POLL_MS);
}

function scheduleReconnect() {
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = setTimeout(() => {
    connect();
  }, 1200);
}

function setConnectionStatus(status) {
  elements.connectionStatus.classList.remove("online", "offline");

  if (status === "online" || status === "polling") {
    elements.connectionStatus.textContent = onlineConnectionLabel();
    elements.connectionStatus.classList.add("online");
    setControlsDisabled(false);
    return;
  }

  if (status === "offline") {
    elements.connectionStatus.textContent = t("connection.reconnecting");
    elements.connectionStatus.classList.add("offline");
    setControlsDisabled(true);
    return;
  }

  elements.connectionStatus.textContent = t("connection.connecting");
  setControlsDisabled(true);
}

function onlineConnectionLabel() {
  return Number.isFinite(state.onlineCount)
    ? t("connection.onlineCount", { count: state.onlineCount })
    : t("connection.online");
}

function setControlsDisabled(disabled) {
  const hasGame = Boolean(state.selectedGameType);
  const hasRoom = Boolean(state.room);
  const isPlaying = state.room?.status === "playing" && !state.room?.winner;
  elements.matchButton.disabled = disabled || !hasGame;
  elements.aiBlackButton.disabled = disabled || !hasGame;
  elements.aiWhiteButton.disabled = disabled || !hasGame;
  elements.createRoomButton.disabled = disabled || !hasGame;
  elements.joinRoomButton.disabled = disabled;
  elements.passButton.disabled = disabled || !isPlaying || !isYourTurn();
  elements.resignButton.disabled = disabled || !isPlaying;
  elements.undoConnect6Button.disabled = disabled || state.connect6Selection.length === 0;
  elements.restartButton.disabled = disabled || !hasRoom;
  elements.swapRestartButton.disabled = disabled || !hasRoom;
  elements.leaveButton.disabled = disabled || !hasRoom;
}

function setMatchingUi(isMatching) {
  elements.matchButton.classList.toggle("ghost-hidden", isMatching);
  elements.cancelMatchButton.classList.toggle("ghost-hidden", !isMatching);
  elements.matchButton.disabled = isMatching;
}

function send(type, payload = {}) {
  connect();
  httpAction(type, payload);
  return true;
}

async function httpAction(type, payload = {}) {
  try {
    const response = await fetch(new URL("api/game", gameUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type,
        payload,
        clientId: state.clientId
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    handleMessages(result.messages || []);
    return result;
  } catch {
    state.online = false;
    setConnectionStatus("offline");
    scheduleReconnect();
    return null;
  }
}

async function pollState() {
  if (state.pollInFlight || !state.online) {
    return;
  }

  state.pollInFlight = true;
  const storedRoom = localStorage.getItem(ROOM_KEY);
  const params = new URLSearchParams({ clientId: state.clientId });
  if (storedRoom) {
    params.set("roomId", storedRoom);
  }

  try {
    const response = await fetch(new URL("api/game?" + params, gameUrl));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    handleMessages(result.messages || []);
  } catch {
    state.online = false;
    setConnectionStatus("offline");
    scheduleReconnect();
  } finally {
    state.pollInFlight = false;
  }
}

async function pollPresence() {
  if (!state.online) {
    return;
  }

  try {
    const params = new URLSearchParams({ clientId: state.clientId });
    const response = await fetch(new URL("api/presence?" + params, gameUrl));
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    const onlineCount = Number(payload.onlineCount);
    if (Number.isFinite(onlineCount)) {
      state.onlineCount = onlineCount;
      setConnectionStatus("polling");
    }
  } catch {
    // Presence is decorative; keep gameplay transport independent.
  }
}

function handleMessages(messages) {
  for (const message of messages) {
    handleMessage(message);
  }
}

function handleMessage(message) {
  switch (message.type) {
    case "state:update":
      applyRoomState(message.payload);
      break;
    case "queue:update":
      if (!state.queued) {
        showToast(noticeText(message.payload, "toast.searching"));
      }
      state.queued = true;
      setMatchingUi(true);
      break;
    case "queue:left":
      state.queued = false;
      setMatchingUi(false);
      showToast(noticeText(message.payload, "toast.cancelled"));
      break;
    case "room:left":
      leaveLocalRoom(noticeText(message.payload, "toast.leftRoom"));
      break;
    case "room:closed":
      leaveLocalRoom(t("toast.roomClosed"));
      break;
    case "restart:requested":
      showToast(noticeText(message.payload, "toast.restartRequested"));
      break;
    case "pong":
      break;
    case "error":
      handleError(message.payload);
      break;
    default:
      break;
  }
}

function handleError(error) {
  if (error?.code === "room_not_found" || error?.code === "room_finished") {
    state.room = null;
    state.lastRoomId = null;
    state.lastRoomUpdatedAt = 0;
    localStorage.removeItem(ROOM_KEY);
      showMainView(state.selectedGameType ? "lobby" : "gameSelect");
  }

  showToast(errorText(error?.code));
}

function noticeText(payload, fallbackKey) {
  const keyByCode = {
    searching_opponent: "toast.searching",
    match_cancelled: "toast.cancelled",
    returned_lobby: "toast.returnedLobby",
    room_closed: "toast.roomClosed",
    left_room: "toast.leftRoom",
    restart_requested: "toast.restartRequested",
    swap_restart_requested: "toast.swapRestartRequested"
  };

  return t(keyByCode[payload?.code] || fallbackKey);
}

function errorText(code) {
  const key = code ? `error.${code}` : "error.generic";
  const dictionary = dictionaries[locale] || dictionaries.en;
  const hasTranslation = dictionary[key] || dictionaries.en[key];
  return hasTranslation ? t(key) : t("error.generic");
}

function applyRoomState(room) {
  const roomUpdatedAt = Number(room.updatedAt || 0);
  if (room.roomId === state.lastRoomId && roomUpdatedAt && roomUpdatedAt < state.lastRoomUpdatedAt) {
    return;
  }

  const previousRoom = state.room;
  if (room.roomId !== state.lastRoomId) {
    state.lastRoomUpdatedAt = roomUpdatedAt;
    state.connect6Selection = [];
  } else {
    state.lastRoomUpdatedAt = Math.max(state.lastRoomUpdatedAt, roomUpdatedAt);
  }
  if (previousRoom && (previousRoom.turn !== room.turn || previousRoom.moves !== room.moves)) {
    state.connect6Selection = [];
  }
  state.reversiFlipKeys = reversiFlipKeys(previousRoom, room);

  state.lastRoomId = room.roomId;
  state.room = room;
  state.queued = false;
  state.selectedGameType = normalizeGameType(room.gameType) || state.selectedGameType;
  localStorage.setItem(GAME_KEY, state.selectedGameType);
  syncGameUrl(state.selectedGameType);
  if (typeof room.serverNow === "number") {
    state.clockOffsetMs = room.serverNow - Date.now();
  }
  localStorage.setItem(ROOM_KEY, room.roomId);
  setMatchingUi(false);

  renderRoomMeta(room);
  renderBoard(room);
  handleRestartPrompt(room);
  updateTurnTimer();
  showMainView("game");
  setControlsDisabled(!state.online);
  scheduleAiMove(room);
}

function syncGameUrl(gameType) {
  if (!gameType) {
    return;
  }

  const url = new URL(window.location.href);
  if (url.searchParams.get("game") !== gameType) {
    url.searchParams.set("game", gameType);
    window.history.replaceState({}, "", url);
  }
}

function renderRoomMeta(room) {
  const youColor = room.you?.color || "-";
  const winnerColor = room.winner?.color || null;
  const isYourMove = !winnerColor && isYourTurn();
  const waiting = room.status === "waiting";
  const gameType = normalizeGameType(room.gameType) || "gomoku";

  elements.roomMode.textContent = `${gameName(gameType)} · ${roomModeLabel(room.roomType)}`;
  elements.gameNameInRoom.textContent = gameName(gameType);
  elements.gameTitlePrefix.textContent = t("game.room");
  elements.roomCode.textContent = room.roomId;
  elements.yourColor.textContent = colorLabel(youColor);
  elements.turnLabel.textContent = colorLabel(room.turn);
  elements.opponentStatus.textContent = opponentLabel(room);
  elements.moveCount.textContent = String(room.moves || 0);
  elements.scoreLabel.textContent = scoreLabel(room);
  elements.moveCountLabel.textContent = gameType === "connect6" ? t("labels.connect6Pending") : t("labels.moves");

  if (gameType === "connect6" && room.status === "playing" && !room.winner) {
    elements.moveCount.textContent = `${state.connect6Selection.length}/${room.requiredStones || 2}`;
  }

  updateGameActions(room);

  if (room.winner) {
    if (!winnerColor) {
      elements.gameStatus.textContent = t("status.draw");
    } else {
      elements.gameStatus.textContent = winnerColor === youColor ? t("status.youWon") : t("status.youLost");
    }
    elements.gameDetail.textContent = winnerDetail(room);
    if (!state.activeRestartPrompt && !room.restart?.opponentRequested) {
      hideRestartModal();
    }
    return;
  }

  if (waiting) {
    elements.gameStatus.textContent = room.roomType === "public" ? t("status.matchReady") : t("status.waitingOpponent");
    elements.gameDetail.textContent = room.roomType === "public"
      ? t("details.publicWaiting")
      : t("details.privateWaiting");
    return;
  }

  const aiThinking = room.roomType === "ai" && room.aiColor === room.turn;
  elements.gameStatus.textContent = aiThinking ? t("status.aiThinking") : isYourMove ? t("status.yourTurn") : t("status.waitingMove");
  elements.gameDetail.textContent = aiThinking ? t("details.aiThinking") : detailTextForTurn(room, isYourMove);

  if (room.restart?.opponentRequested) {
    elements.gameDetail.textContent = room.restart.type === "swap"
      ? t("details.swapRestartRequested")
      : t("details.restartRequested");
  }
}

function detailTextForTurn(room, isYourMove) {
  if (!isYourMove) {
    return t("details.waitingMove");
  }

  if (room.gameType === "go") {
    return t("details.goTurn");
  }

  if (room.gameType === "reversi") {
    return t("details.reversiTurn");
  }

  if (room.gameType === "connect6") {
    const remaining = Math.max(0, Number(room.requiredStones || 2) - state.connect6Selection.length);
    return t("details.connect6Turn", { remaining });
  }

  return t("details.yourTurn");
}

function winnerDetail(room) {
  const reason = room.winner?.reason;
  if (reason === "forfeit") {
    return t("winner.forfeit");
  }

  if (reason === "timeout") {
    return t("winner.timeout");
  }

  if (reason === "resign") {
    return t("winner.resign");
  }

  if (reason === "score") {
    return t("winner.score", { score: scoreLabel(room) });
  }

  if (reason === "disc_count") {
    return t("winner.disc_count", { score: scoreLabel(room) });
  }

  if (reason === "draw") {
    return t("winner.draw");
  }

  return t("winner.line");
}

function opponentLabel(room) {
  if (room.opponent?.isAi) {
    return t("opponent.ai");
  }

  if (room.status === "waiting") {
    return t("opponent.waiting");
  }

  if (room.opponent?.connected) {
    return t("opponent.online");
  }

  return t("opponent.offlineGrace");
}

function colorLabel(color) {
  if (color === "black") {
    return t("color.black");
  }

  if (color === "white") {
    return t("color.white");
  }

  return t("color.none");
}

function gameName(gameType) {
  return t(`game.${normalizeGameType(gameType) || "gomoku"}.name`);
}

function roomModeLabel(roomType) {
  if (roomType === "ai") {
    return t("roomMode.ai");
  }

  return roomType === "public" ? t("roomMode.public") : t("roomMode.private");
}

function scoreLabel(room) {
  if (room.gameType === "go" && room.score) {
    return t("score.go", {
      black: formatScore(room.score.black),
      white: formatScore(room.score.white)
    });
  }

  if (room.gameType === "reversi" && room.score) {
    return t("score.reversi", {
      black: room.score.black,
      white: room.score.white
    });
  }

  return t("score.none");
}

function formatScore(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value).toFixed(1));
}

function updateTurnTimer() {
  if (!state.room || state.room.status !== "playing" || state.room.winner || !state.room.turnDeadlineAt) {
    elements.turnTimer.textContent = "-";
    return;
  }

  const remainingMs = Math.max(0, state.room.turnDeadlineAt - currentServerNow());
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  elements.turnTimer.textContent = t("timer.seconds", { seconds: remainingSeconds });
}

function currentServerNow() {
  return Date.now() + state.clockOffsetMs;
}

function updateGameActions(room) {
  elements.passButton.classList.toggle("ghost-hidden", room.gameType !== "go");
  elements.resignButton.classList.toggle("ghost-hidden", room.status !== "playing" || Boolean(room.winner));
  elements.undoConnect6Button.classList.toggle("ghost-hidden", room.gameType !== "connect6" || state.connect6Selection.length === 0);
}

function isYourTurn() {
  return Boolean(state.room && state.room.status === "playing" && !state.room.winner && state.room.turn === state.room.you?.color);
}

function handleRestartPrompt(room) {
  const restart = room.restart || {};
  const restartType = restart.type || "normal";

  if (!restart.opponentRequested) {
    if (state.activeRestartPrompt?.roomId === room.roomId && room.winner?.reason !== "forfeit") {
      return;
    }

    state.activeRestartPrompt = null;
    hideRestartModal();
    return;
  }

  const promptKey = `${room.roomId}:${restartType}:${restart.requestedAt || "pending"}`;
  if (state.suppressedRestartPromptKey === promptKey) {
    return;
  }

  state.activeRestartPrompt = {
    key: promptKey,
    roomId: room.roomId,
    requestedAt: Number(restart.requestedAt || 0),
    roomUpdatedAt: Number(room.updatedAt || 0)
  };

  if (state.restartPromptKey === promptKey) {
    return;
  }

  state.restartPromptKey = promptKey;
  state.pendingRestartType = restartType;
  showRestartModal(restartType);
}

function showRestartModal(restartType) {
  if (restartType === "swap") {
    elements.restartModalTitle.textContent = t("modal.swapTitle");
    elements.restartModalBody.textContent = t("modal.swapBody");
    elements.restartConfirmButton.textContent = t("actions.swapConfirm");
  } else {
    elements.restartModalTitle.textContent = t("modal.normalTitle");
    elements.restartModalBody.textContent = t("modal.normalBody");
    elements.restartConfirmButton.textContent = t("actions.restart");
  }

  elements.restartModal.classList.remove("hidden");
}

function hideRestartModal() {
  elements.restartModal.classList.add("hidden");
}

function renderBoard(room) {
  ensureBoard(room.boardSize || GAMES[room.gameType]?.boardSize || 15, room.boardKind || "intersection", room.gameType || "gomoku");
  const winningPoints = new Set((room.winningLine || []).map(pointKey));
  const lastMovePoints = new Set((room.lastMovePoints || []).map(pointKey));
  const legalMoves = new Set((room.legalMoves || []).map(pointKey));
  const pendingPoints = new Set(state.connect6Selection.map(pointKey));
  const flipPoints = state.reversiFlipKeys || new Set();
  const board = room.board || [];
  const canMove = isYourTurn();

  for (const point of elements.board.querySelectorAll(".point")) {
    const row = Number(point.dataset.row);
    const col = Number(point.dataset.col);
    const value = board[row]?.[col] || null;
    const key = `${row},${col}`;
    const isPending = pendingPoints.has(key);
    const isLegal = isLegalClientMove(room, row, col, value, legalMoves);

    point.querySelector(".stone")?.remove();
    point.classList.toggle("legal", canMove && isLegal);
    point.classList.toggle("pending", isPending);
    point.disabled = !canMove || !isLegal;

    if (value) {
      const stone = document.createElement("span");
      stone.className = `stone ${value}`;
      stone.setAttribute("aria-hidden", "true");
      stone.classList.toggle("win", winningPoints.has(key));
      stone.classList.toggle("last", lastMovePoints.has(key));
      stone.classList.toggle("reversi-flip", flipPoints.has(key));
      point.append(stone);
      point.setAttribute("aria-label", t("aria.pieceCell", {
        row: row + 1,
        col: col + 1,
        color: colorLabel(value)
      }));
    } else if (isPending) {
      const stone = document.createElement("span");
      stone.className = `stone ${room.you?.color || "black"} pending-stone`;
      stone.setAttribute("aria-hidden", "true");
      point.append(stone);
      point.setAttribute("aria-label", t("aria.pieceCell", {
        row: row + 1,
        col: col + 1,
        color: colorLabel(room.you?.color)
      }));
    } else if (canMove && isLegal && room.gameType === "reversi") {
      point.setAttribute("aria-label", t("aria.legalCell", { row: row + 1, col: col + 1 }));
    } else {
      point.setAttribute("aria-label", t("aria.emptyCell", { row: row + 1, col: col + 1 }));
    }
  }

  state.reversiFlipKeys = new Set();
}

function reversiFlipKeys(previousRoom, room) {
  if (!previousRoom || previousRoom.roomId !== room.roomId || previousRoom.gameType !== "reversi" || room.gameType !== "reversi") {
    return new Set();
  }

  if (previousRoom.moves === room.moves) {
    return new Set();
  }

  const keys = new Set();
  const previousBoard = previousRoom.board || [];
  const nextBoard = room.board || [];
  const lastMovePoints = new Set((room.lastMovePoints || []).map(pointKey));

  for (let row = 0; row < nextBoard.length; row += 1) {
    for (let col = 0; col < nextBoard[row].length; col += 1) {
      const key = `${row},${col}`;
      const previousValue = previousBoard[row]?.[col] || null;
      const nextValue = nextBoard[row]?.[col] || null;
      if (previousValue && nextValue && previousValue !== nextValue && !lastMovePoints.has(key)) {
        keys.add(key);
      }
    }
  }

  return keys;
}

function ensureBoard(boardSize, boardKind, gameType) {
  if (state.renderedBoardSize === boardSize && state.renderedBoardKind === boardKind && state.renderedGameType === gameType) {
    return;
  }

  state.renderedBoardSize = boardSize;
  state.renderedBoardKind = boardKind;
  state.renderedGameType = gameType;
  elements.board.innerHTML = "";
  elements.board.style.setProperty("--board-size", String(boardSize));
  elements.board.className = `board ${boardKind === "cells" ? "board-cells" : "board-intersections"} ${gameType}-board`;
  elements.board.setAttribute("aria-label", `${gameName(gameType)} ${boardSize}x${boardSize}`);

  const fragment = document.createDocumentFragment();
  const stars = starPoints(boardSize, gameType);
  for (let row = 0; row < boardSize; row += 1) {
    for (let col = 0; col < boardSize; col += 1) {
      const point = document.createElement("button");
      point.type = "button";
      point.className = "point";
      point.dataset.row = String(row);
      point.dataset.col = String(col);
      point.setAttribute("role", "gridcell");
      if (stars.has(`${row},${col}`)) {
        point.classList.add("star");
        const dot = document.createElement("span");
        dot.className = "star-dot";
        point.append(dot);
      }
      point.addEventListener("click", () => handleBoardClick(row, col));
      fragment.append(point);
    }
  }
  elements.board.append(fragment);
}

function starPoints(size, gameType) {
  if (gameType === "reversi") {
    return new Set();
  }

  if (size === 15) {
    return new Set(["3,3", "3,11", "7,7", "11,3", "11,11"]);
  }

  if (size === 19) {
    const points = [];
    for (const row of [3, 9, 15]) {
      for (const col of [3, 9, 15]) {
        points.push(`${row},${col}`);
      }
    }
    return new Set(points);
  }

  return new Set();
}

function isLegalClientMove(room, row, col, value, legalMoves) {
  if (value) {
    return false;
  }

  if (room.gameType === "reversi") {
    return legalMoves.has(`${row},${col}`);
  }

  if (room.gameType === "connect6") {
    return !state.connect6Selection.some((point) => point.row === row && point.col === col);
  }

  return true;
}

function handleBoardClick(row, col) {
  if (!state.room || !isYourTurn()) {
    return;
  }

  if (state.room.gameType === "connect6") {
    handleConnect6Selection(row, col);
    return;
  }

  send("move:place", { row, col });
}

function handleConnect6Selection(row, col) {
  const boardValue = state.room.board?.[row]?.[col];
  if (boardValue || state.connect6Selection.some((point) => point.row === row && point.col === col)) {
    return;
  }

  state.connect6Selection.push({ row, col });
  const requiredStones = Number(state.room.requiredStones || 2);
  if (state.connect6Selection.length >= requiredStones) {
    const points = [...state.connect6Selection];
    state.connect6Selection = [];
    send("move:place", { points });
  } else {
    renderRoomMeta(state.room);
    renderBoard(state.room);
  }
}

function scheduleAiMove(room) {
  if (!shouldAiMove(room)) {
    clearAiMoveSchedule();
    return;
  }

  const signature = aiMoveSignature(room);
  if (state.aiMoveInFlight || state.aiMoveSignature === signature) {
    return;
  }

  clearTimeout(state.aiMoveTimer);
  state.aiMoveSignature = signature;
  state.aiMoveTimer = setTimeout(async () => {
    if (!state.room || aiMoveSignature(state.room) !== signature || !shouldAiMove(state.room)) {
      state.aiMoveSignature = null;
      return;
    }

    const payload = state.room.gameType === "go"
      ? await chooseGoAiPayload(state.room)
      : chooseAiMove(state.room);
    if (!payload) {
      state.aiMoveSignature = null;
      return;
    }

    if (!state.room || aiMoveSignature(state.room) !== signature || !shouldAiMove(state.room)) {
      state.aiMoveSignature = null;
      return;
    }

    state.aiMoveInFlight = true;
    await httpAction(payload.pass ? "ai:pass" : "ai:move", payload.pass ? {} : payload);
    state.aiMoveInFlight = false;
    state.aiMoveSignature = null;
  }, 300 + Math.floor(Math.random() * 300));
}

async function chooseGoAiPayload(room) {
  try {
    return await requestGoMctsMove(room);
  } catch {
    return chooseAiMove(room);
  }
}

function requestGoMctsMove(room) {
  const worker = getGoMctsWorker();
  if (!worker) {
    return Promise.reject(new Error("Worker unavailable"));
  }

  state.goMctsRequestId += 1;
  const requestId = state.goMctsRequestId;
  clearGoMctsPending();
  const mctsOptions = goMctsOptionsForRoom(room);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (state.goMctsPending?.requestId === requestId) {
        state.goMctsPending = null;
      }
      reject(new Error("MCTS timed out"));
    }, Number(mctsOptions.timeLimitMs || 5000) + 1000);

    state.goMctsPending = { requestId, resolve, reject, timer };
    worker.postMessage({
      type: "go:mcts",
      requestId,
      room,
      options: {
        ...mctsOptions,
        seed: goMctsSeed(room)
      }
    });
  });
}

function getGoMctsWorker() {
  if (!("Worker" in window)) {
    return null;
  }

  if (state.goMctsWorker) {
    return state.goMctsWorker;
  }

  try {
    const worker = new Worker(new URL("./go-mcts-worker.js", import.meta.url), { type: "module" });
    worker.addEventListener("message", handleGoMctsWorkerMessage);
    worker.addEventListener("error", (event) => {
      const pending = state.goMctsPending;
      if (pending) {
        clearTimeout(pending.timer);
        state.goMctsPending = null;
        pending.reject(event.error || new Error("MCTS worker failed"));
      }
      state.goMctsWorker?.terminate();
      state.goMctsWorker = null;
    });
    state.goMctsWorker = worker;
    return worker;
  } catch {
    state.goMctsWorker = null;
    return null;
  }
}

function handleGoMctsWorkerMessage(event) {
  const message = event.data || {};
  const pending = state.goMctsPending;
  if (!pending || pending.requestId !== message.requestId) {
    return;
  }

  clearTimeout(pending.timer);
  state.goMctsPending = null;
  if (message.type === "go:mcts:result" && message.move) {
    pending.resolve(message.move);
  } else {
    pending.reject(new Error(message.message || "MCTS worker failed"));
  }
}

function clearGoMctsPending() {
  const pending = state.goMctsPending;
  if (!pending) {
    return;
  }

  clearTimeout(pending.timer);
  state.goMctsPending = null;
  pending.reject(new Error("MCTS cancelled"));
}

function goMctsSeed(room) {
  const text = `${room.roomId}:${room.updatedAt}:${room.moves}:${room.turn}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shouldAiMove(room) {
  return Boolean(
    room
    && room.roomType === "ai"
    && room.status === "playing"
    && !room.winner
    && room.aiColor
    && room.turn === room.aiColor
  );
}

function aiMoveSignature(room) {
  return `${room.roomId}:${room.updatedAt}:${room.turn}:${room.moves}`;
}

function clearAiMoveSchedule() {
  clearTimeout(state.aiMoveTimer);
  state.aiMoveTimer = null;
  clearGoMctsPending();
  if (!state.aiMoveInFlight) {
    state.aiMoveSignature = null;
  }
}

function leaveLocalRoom(message) {
  clearAiMoveSchedule();
  state.room = null;
  state.queued = false;
  state.lastRoomId = null;
  state.lastRoomUpdatedAt = 0;
  state.connect6Selection = [];
  state.activeRestartPrompt = null;
  state.restartPromptKey = null;
  state.suppressedRestartPromptKey = null;
  hideRestartModal();
  localStorage.removeItem(ROOM_KEY);
  if (state.selectedGameType) {
    updateSelectedGameCopy();
  }
  showMainView(state.selectedGameType ? "lobby" : "gameSelect");
  setMatchingUi(false);
  showToast(message);
  setControlsDisabled(!state.online);
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    elements.toast.classList.remove("visible");
  }, 2600);
}

function pointKey(point) {
  return `${point.row},${point.col}`;
}

elements.brandButton.addEventListener("click", () => window.location.assign("../?game=weiqi"));

elements.gameGrid.addEventListener("click", (event) => {
  const card = event.target.closest("[data-game]");
  if (card) {
    selectGame(card.dataset.game);
  }
});

elements.backToGamesButton.addEventListener("click", () => {
  showGameSelect();
});

elements.matchButton.addEventListener("click", () => {
  if (!state.selectedGameType) {
    showToast(t("toast.chooseGame"));
    return;
  }

  if (send("match:join", { gameType: state.selectedGameType })) {
    setMatchingUi(true);
  }
});

elements.cancelMatchButton.addEventListener("click", () => {
  send("room:leave");
});

elements.aiBlackButton.addEventListener("click", () => {
  if (!state.selectedGameType) {
    showToast(t("toast.chooseGame"));
    return;
  }

  send("ai:create", { gameType: state.selectedGameType, humanColor: "black" });
});

elements.aiWhiteButton.addEventListener("click", () => {
  if (!state.selectedGameType) {
    showToast(t("toast.chooseGame"));
    return;
  }

  send("ai:create", { gameType: state.selectedGameType, humanColor: "white" });
});

elements.createRoomButton.addEventListener("click", () => {
  if (!state.selectedGameType) {
    showToast(t("toast.chooseGame"));
    return;
  }

  send("room:create", { gameType: state.selectedGameType });
});

elements.joinRoomButton.addEventListener("click", () => {
  const roomId = elements.roomInput.value.trim();
  if (!roomId) {
    showToast(t("toast.inputRoom"));
    return;
  }

  send("room:join", { roomId });
});

elements.roomInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    elements.joinRoomButton.click();
  }
});

elements.copyRoomButton.addEventListener("click", async () => {
  if (!state.room?.roomId) return;
  const invite = new URL(gameUrl);
  invite.searchParams.set("room", state.room.roomId);
  try {
    await navigator.clipboard.writeText(invite.href);
    showToast("已复制邀请链接。");
  } catch {
    const dialog = document.getElementById("inviteDialog");
    const input = document.getElementById("inviteUrl");
    input.value = invite.href;
    dialog.showModal();
    input.select();
  }
});

elements.passButton.addEventListener("click", () => {
  send("move:pass");
});

elements.resignButton.addEventListener("click", () => {
  send("move:resign");
});

elements.undoConnect6Button.addEventListener("click", () => {
  state.connect6Selection.pop();
  if (state.room) {
    renderRoomMeta(state.room);
    renderBoard(state.room);
    setControlsDisabled(!state.online);
  }
});

elements.restartButton.addEventListener("click", () => {
  send("game:restart");
});

elements.swapRestartButton.addEventListener("click", () => {
  send("game:swap_restart");
});

elements.restartConfirmButton.addEventListener("click", () => {
  state.suppressedRestartPromptKey = state.activeRestartPrompt?.key || state.restartPromptKey;
  state.activeRestartPrompt = null;
  state.restartPromptKey = null;
  hideRestartModal();
  send(state.pendingRestartType === "swap" ? "game:swap_restart" : "game:restart");
});

elements.restartDismissButton.addEventListener("click", () => {
  state.suppressedRestartPromptKey = state.activeRestartPrompt?.key || state.restartPromptKey;
  state.activeRestartPrompt = null;
  hideRestartModal();
});

elements.leaveButton.addEventListener("click", () => {
  send("room:leave");
});

applyStaticI18n();
initializeSelectedGame();
connect();
setInterval(updateTurnTimer, 250);
