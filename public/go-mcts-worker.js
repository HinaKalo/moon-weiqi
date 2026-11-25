import { chooseGoMctsMove } from "./ai.js";

self.addEventListener("message", (event) => {
  const message = event.data || {};
  if (message.type !== "go:mcts") {
    return;
  }

  try {
    const move = chooseGoMctsMove(message.room, message.options || {});
    self.postMessage({
      type: "go:mcts:result",
      requestId: message.requestId,
      move
    });
  } catch (error) {
    self.postMessage({
      type: "go:mcts:error",
      requestId: message.requestId,
      message: error instanceof Error ? error.message : "MCTS failed"
    });
  }
});
