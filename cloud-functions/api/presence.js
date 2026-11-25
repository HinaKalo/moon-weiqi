// Modified for Moon GameHub. See ../../README.md.
import { store } from "../../store.js";
const DISCONNECT_GRACE_MS = 60_000;


export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const clientId = normalizeClientId(url.searchParams.get("clientId"));

  if (clientId) {
    await touchPresence(store, clientId);
  }

  return jsonResponse({
    onlineCount: await countOnlinePlayers(store)
  });
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders()
  });
}

async function touchPresence(store, clientId) {
  const key = playerKey(clientId);
  const player = await store.get(key, { type: "json", consistency: "strong" }).catch(() => null) || {
    id: clientId,
    roomId: null,
    color: null,
    queued: false,
    queueKey: null,
    queueGameType: null
  };

  player.lastSeen = Date.now();
  await store.setJSON(key, player, { cacheControl: null });
}

async function countOnlinePlayers(store) {
  const now = Date.now();
  const result = await store.list({ prefix: "players/", consistency: "strong" });
  let count = 0;

  for (const blob of result.blobs || []) {
    const player = await store.get(blob.key, { type: "json", consistency: "strong" }).catch(() => null);
    if (player && now - Number(player.lastSeen || 0) <= DISCONNECT_GRACE_MS) {
      count += 1;
    }
  }

  return count;
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
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
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function playerKey(playerId) {
  return `players/${safeKeyPart(playerId)}.json`;
}

function normalizeClientId(value) {
  return typeof value === "string" && value.trim().length >= 8 ? value.trim().slice(0, 80) : null;
}

function safeKeyPart(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}
