/**
 * Lone Sherman local game server.
 *
 * HTTP API:
 *   GET  /health
 *   POST /api/auth/login       { username, password }
 *   POST /api/auth/register    { username, password, profile? }
 *   GET  /api/player/profile   Authorization: Bearer <token>
 *   PUT  /api/player/profile   Authorization: Bearer <token>, { profile }
 *
 * WebSocket demo protocol is kept for compatibility with earlier tests.
 */

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "auth-db.json");
const DATA_DIR = path.dirname(DB_PATH);
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7;

const sessions = new Map(); // token -> { username, expiresAt }
const pvpQueue = [];
const pvpRooms = new Map(); // roomCode -> room
const pvpMatches = new Map(); // matchId -> match

function defaultDb() {
  return { version: 1, users: {} };
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readDb() {
  ensureDataDir();
  try {
    if (!fs.existsSync(DB_PATH)) return defaultDb();
    const parsed = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object" || !parsed.users) return defaultDb();
    return parsed;
  } catch (err) {
    console.warn("[db] read failed, using empty db:", err.message);
    return defaultDb();
  }
}

function writeDb(db) {
  ensureDataDir();
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tmpPath, DB_PATH);
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function publicUsername(username) {
  return String(username || "").trim();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password || ""), salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, account) {
  if (!account || !account.salt || !account.passwordHash) return false;
  const { hash } = hashPassword(password, account.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(account.passwordHash, "hex"));
}

function createToken(username) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { username, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

function getTokenUser(req) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  const token = match[1];
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + TOKEN_TTL_MS;
  return session.username;
}

function getUserFromToken(token) {
  const session = sessions.get(String(token || ""));
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(String(token || ""));
    return null;
  }
  session.expiresAt = Date.now() + TOKEN_TTL_MS;
  return session.username;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(Object.assign(new Error("Body too large"), { code: "BODY_TOO_LARGE" }));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error("Invalid JSON"), { code: "BAD_JSON" }));
      }
    });
    req.on("error", reject);
  });
}

function makeDefaultProfile(profile) {
  const p = profile && typeof profile === "object" ? profile : {};
  return {
    menuState: p.menuState ?? null,
    settings: p.settings ?? null,
    updatedAt: Date.now(),
  };
}

async function handleHttp(req, res) {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true, time: Date.now() });
    return;
  }

  try {
    if (req.method === "POST" && req.url === "/api/auth/register") {
      const body = await readJsonBody(req);
      const username = publicUsername(body.username);
      const key = normalizeUsername(username);
      const password = String(body.password || "");
      if (!key) return sendJson(res, 400, { ok: false, code: "BAD_USERNAME", message: "Username is required" });
      if (!password) return sendJson(res, 400, { ok: false, code: "BAD_PASSWORD", message: "Password is required" });

      const db = readDb();
      if (db.users[key]) return sendJson(res, 409, { ok: false, code: "ACCOUNT_EXISTS", message: "Account already exists" });

      const pass = hashPassword(password);
      db.users[key] = {
        username,
        passwordHash: pass.hash,
        salt: pass.salt,
        profile: makeDefaultProfile(body.profile),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      writeDb(db);

      sendJson(res, 201, {
        ok: true,
        token: createToken(key),
        username,
        profile: db.users[key].profile,
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/auth/login") {
      const body = await readJsonBody(req);
      const key = normalizeUsername(body.username);
      const db = readDb();
      const account = db.users[key];
      if (!account) return sendJson(res, 404, { ok: false, code: "ACCOUNT_NOT_FOUND", message: "Account not found" });
      if (!verifyPassword(body.password, account)) {
        return sendJson(res, 401, { ok: false, code: "BAD_PASSWORD", message: "Incorrect password" });
      }

      sendJson(res, 200, {
        ok: true,
        token: createToken(key),
        username: account.username,
        profile: account.profile ?? makeDefaultProfile(),
      });
      return;
    }

    if (req.url === "/api/player/profile") {
      const key = getTokenUser(req);
      if (!key) return sendJson(res, 401, { ok: false, code: "UNAUTHORIZED", message: "Login required" });
      const db = readDb();
      const account = db.users[key];
      if (!account) return sendJson(res, 404, { ok: false, code: "ACCOUNT_NOT_FOUND", message: "Account not found" });

      if (req.method === "GET") {
        sendJson(res, 200, { ok: true, username: account.username, profile: account.profile ?? makeDefaultProfile() });
        return;
      }

      if (req.method === "PUT") {
        const body = await readJsonBody(req);
        account.profile = makeDefaultProfile(body.profile);
        account.updatedAt = Date.now();
        writeDb(db);
        sendJson(res, 200, { ok: true, username: account.username, profile: account.profile });
        return;
      }
    }

    sendJson(res, 404, { ok: false, code: "NOT_FOUND", message: "Not Found" });
  } catch (err) {
    const code = err.code === "BAD_JSON" ? "BAD_JSON" : err.code === "BODY_TOO_LARGE" ? "BODY_TOO_LARGE" : "SERVER_ERROR";
    sendJson(res, code === "SERVER_ERROR" ? 500 : 400, { ok: false, code, message: err.message });
  }
}

const server = http.createServer((req, res) => {
  void handleHttp(req, res);
});

const wss = new WebSocket.Server({ server });
const clients = new Map(); // clientId -> ws
let clientSeq = 1;
let pvpMatchSeq = 1;

function safeSend(ws, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function broadcast(payload, excludeClientId = null) {
  for (const [clientId, ws] of clients.entries()) {
    if (excludeClientId && clientId === excludeClientId) continue;
    safeSend(ws, payload);
  }
}

function publicPvpPlayer(player) {
  if (!player) return null;
  return {
    clientId: player.clientId,
    name: player.name,
    factionId: player.factionId,
    parity: player.parity,
    ready: !!player.ready,
  };
}

function sendPvpRoomUpdate(room) {
  const payload = {
    type: "pvp_room_update",
    roomCode: room.code,
    owner: publicPvpPlayer(room.owner),
    guest: publicPvpPlayer(room.guest),
    canStart: !!room.guest?.ready,
    now: Date.now(),
  };
  safeSend(clients.get(room.owner.clientId), { ...payload, you: "owner" });
  if (room.guest) safeSend(clients.get(room.guest.clientId), { ...payload, you: "guest" });
}

function pvpProtagonistKind(factionId) {
  if (factionId === "germany") return "panzer4";
  if (factionId === "japan") return "type97";
  return "sherman";
}

function pvpSupportKind(factionId) {
  if (factionId === "japan") return "japanese_infantry";
  return "infantry";
}

function pvpUnit(id, ownerParity, ownerFactionId, role, kind, q, r, facing) {
  return {
    id,
    ownerParity,
    ownerFactionId,
    role,
    kind,
    pos: { q, r },
    facing,
    turretFacing: facing,
    destroyed: false,
    damaged: false,
    loaded: role === "protagonist" ? false : undefined,
    hatchOpen: role === "protagonist" ? false : undefined,
    fireLevel: 0,
    turretDamaged: false,
    paralyzed: false,
    crew: role === "protagonist"
      ? { commander: true, loader: true, gunner: true, driver: true, coDriver: true }
      : undefined,
  };
}

function createInitialPvpBattleState(match) {
  const odd = match.players.find(player => player.parity === "odd");
  const even = match.players.find(player => player.parity === "even");
  const oddSupport = pvpSupportKind(odd.factionId);
  const evenSupport = pvpSupportKind(even.factionId);
  return {
    version: 1,
    turn: 1,
    currentParity: match.firstParity,
    firstParity: match.firstParity,
    openingDie: match.openingDie,
    units: [
      pvpUnit("pvp_odd_protagonist", "odd", odd.factionId, "protagonist", pvpProtagonistKind(odd.factionId), -1, 5, 5),
      pvpUnit("pvp_odd_support_1", "odd", odd.factionId, "support", oddSupport, 0, 4, 5),
      pvpUnit("pvp_odd_support_2", "odd", odd.factionId, "support", oddSupport, 1, 5, 5),
      pvpUnit("pvp_even_protagonist", "even", even.factionId, "protagonist", pvpProtagonistKind(even.factionId), 6, 2, 3),
      pvpUnit("pvp_even_support_1", "even", even.factionId, "support", evenSupport, 5, 1, 3),
      pvpUnit("pvp_even_support_2", "even", even.factionId, "support", evenSupport, 4, 0, 3),
    ],
    winnerParity: null,
    updatedAt: Date.now(),
  };
}

function sanitizePvpBattleUnit(raw, fallback) {
  const src = raw && typeof raw === "object" ? raw : {};
  const base = fallback || {};
  const pos = src.pos && typeof src.pos === "object" ? src.pos : base.pos;
  const n = (value, fallbackValue) => Number.isFinite(Number(value)) ? Number(value) : fallbackValue;
  return {
    ...base,
    pos: {
      q: n(pos?.q, base.pos?.q ?? 0),
      r: n(pos?.r, base.pos?.r ?? 0),
    },
    facing: src.facing === null ? null : n(src.facing, base.facing ?? 0),
    turretFacing: src.turretFacing === undefined || src.turretFacing === null
      ? (src.facing === null ? null : n(src.facing, base.turretFacing ?? base.facing ?? 0))
      : n(src.turretFacing, base.turretFacing ?? base.facing ?? 0),
    destroyed: !!src.destroyed,
    damaged: !!src.damaged,
    loaded: !!src.loaded,
    hatchOpen: !!src.hatchOpen,
    fireLevel: Math.max(0, n(src.fireLevel, 0)),
    turretDamaged: !!src.turretDamaged,
    paralyzed: !!src.paralyzed,
    crew: src.crew && typeof src.crew === "object"
      ? {
        commander: src.crew.commander !== false,
        loader: src.crew.loader !== false,
        gunner: src.crew.gunner !== false,
        driver: src.crew.driver !== false,
        coDriver: src.crew.coDriver !== false,
      }
      : base.crew,
  };
}

function updatePvpBattleUnits(match, rawUnits) {
  if (!Array.isArray(rawUnits)) return;
  const byId = new Map(rawUnits.map(unit => [String(unit?.id || ""), unit]));
  match.battleState.units = match.battleState.units.map(unit => (
    byId.has(unit.id) ? sanitizePvpBattleUnit(byId.get(unit.id), unit) : unit
  ));
}

function updatePvpWinner(match) {
  const oddMain = match.battleState.units.find(unit => unit.id === "pvp_odd_protagonist");
  const evenMain = match.battleState.units.find(unit => unit.id === "pvp_even_protagonist");
  if (oddMain?.destroyed) match.battleState.winnerParity = "even";
  else if (evenMain?.destroyed) match.battleState.winnerParity = "odd";
  else match.battleState.winnerParity = null;
}

function publicPvpBattleState(match) {
  return {
    ...match.battleState,
    units: match.battleState.units.map(unit => ({ ...unit, pos: { ...unit.pos }, crew: unit.crew ? { ...unit.crew } : undefined })),
  };
}

function sendPvpBattleSnapshot(match, reason) {
  if (!match.battleState) match.battleState = createInitialPvpBattleState(match);
  updatePvpWinner(match);
  match.battleState.updatedAt = Date.now();
  for (const player of match.players) {
    safeSend(clients.get(player.clientId), {
      type: "pvp_battle_snapshot",
      matchId: match.id,
      reason,
      state: publicPvpBattleState(match),
      now: Date.now(),
    });
  }
}

function makeRoomCode() {
  for (let i = 0; i < 50; i++) {
    const code = String(100000 + Math.floor(Math.random() * 900000));
    if (!pvpRooms.has(code)) return code;
  }
  return String(Date.now()).slice(-6);
}

function removeFromPvpQueue(clientId) {
  const idx = pvpQueue.findIndex(item => item.clientId === clientId);
  if (idx >= 0) pvpQueue.splice(idx, 1);
}

function closePvpRoomForClient(clientId) {
  for (const [code, room] of pvpRooms.entries()) {
    if (room.owner.clientId === clientId || room.guest?.clientId === clientId) {
      const other = room.owner.clientId === clientId ? room.guest : room.owner;
      pvpRooms.delete(code);
      if (other) {
        const otherWs = clients.get(other.clientId);
        safeSend(otherWs, { type: "pvp_room_closed", roomCode: code, reason: "PLAYER_LEFT", now: Date.now() });
      }
    }
  }
}

function cleanupPvpClient(clientId) {
  removeFromPvpQueue(clientId);
  closePvpRoomForClient(clientId);
  for (const [matchId, match] of pvpMatches.entries()) {
    if (!match.players.some(player => player.clientId === clientId)) continue;
    match.closed = true;
    pvpMatches.delete(matchId);
    for (const player of match.players) {
      if (player.clientId === clientId) continue;
      safeSend(clients.get(player.clientId), {
        type: "pvp_match_closed",
        matchId,
        reason: "PLAYER_LEFT",
        now: Date.now(),
      });
    }
  }
}

function createPvpMatch(matchMode, oddPlayer, evenPlayer, roomCode) {
  const matchId = `pvp_${Date.now()}_${pvpMatchSeq++}`;
  const openingDie = 1 + Math.floor(Math.random() * 6);
  const firstParity = openingDie % 2 === 1 ? "odd" : "even";
  oddPlayer.parity = "odd";
  evenPlayer.parity = "even";
  const players = [oddPlayer, evenPlayer];
  const firstPlayer = players.find(player => player.parity === firstParity) || oddPlayer;
  const match = {
    id: matchId,
    matchMode,
    roomCode,
    players,
    openingDie,
    firstParity,
    firstPlayerName: firstPlayer.name,
    currentParity: firstParity,
    readyClientIds: new Set(),
    battleStarted: false,
    battleState: null,
    createdAt: Date.now(),
    closed: false,
  };
  pvpMatches.set(matchId, match);
  for (const player of players) {
    const opponent = player.clientId === oddPlayer.clientId ? evenPlayer : oddPlayer;
    safeSend(clients.get(player.clientId), {
      type: "pvp_match_started",
      match: {
        matchId,
        matchMode,
        roomCode,
        localPlayer: publicPvpPlayer(player),
        opponentPlayer: publicPvpPlayer(opponent),
        openingDie,
        firstParity,
        firstPlayerName: firstPlayer.name,
        missionPath: "missions/mission_01",
      },
      now: Date.now(),
    });
  }
  return match;
}

function pvpPlayerFromMessage(ws, clientId, msg, parity) {
  const factionId = String(msg.factionId || "usa");
  const allowed = new Set(["usa", "germany", "japan", "ussr"]);
  return {
    clientId,
    name: ws.publicName || clientId,
    factionId: allowed.has(factionId) && factionId !== "ussr" ? factionId : "usa",
    parity,
  };
}

function handlePvpMessage(ws, clientId, msg) {
  switch (msg.type) {
    case "pvp_matchmaking_join": {
      removeFromPvpQueue(clientId);
      closePvpRoomForClient(clientId);
      const player = pvpPlayerFromMessage(ws, clientId, msg, "even");
      const waiting = pvpQueue.shift();
      if (waiting && clients.has(waiting.clientId)) {
        createPvpMatch("matchmaking", waiting, player);
        return true;
      }
      player.parity = "odd";
      pvpQueue.push(player);
      safeSend(ws, { type: "pvp_matchmaking_waiting", parity: "odd", now: Date.now() });
      return true;
    }
    case "pvp_matchmaking_cancel": {
      removeFromPvpQueue(clientId);
      safeSend(ws, { type: "pvp_matchmaking_cancelled", now: Date.now() });
      return true;
    }
    case "pvp_room_create": {
      removeFromPvpQueue(clientId);
      closePvpRoomForClient(clientId);
      const roomCode = makeRoomCode();
      const owner = pvpPlayerFromMessage(ws, clientId, msg, "odd");
      owner.ready = true;
      const room = { code: roomCode, owner, guest: null, createdAt: Date.now() };
      pvpRooms.set(roomCode, room);
      safeSend(ws, {
        type: "pvp_room_created",
        roomCode,
        owner: publicPvpPlayer(owner),
        now: Date.now(),
      });
      sendPvpRoomUpdate(room);
      return true;
    }
    case "pvp_room_join": {
      removeFromPvpQueue(clientId);
      const roomCode = String(msg.roomCode || "").trim();
      const room = pvpRooms.get(roomCode);
      if (!room) {
        safeSend(ws, { type: "pvp_error", code: "ROOM_NOT_FOUND", message: "Room not found", now: Date.now() });
        return true;
      }
      if (room.owner.clientId === clientId) {
        safeSend(ws, { type: "pvp_error", code: "ROOM_SELF_JOIN", message: "Cannot join your own room", now: Date.now() });
        return true;
      }
      const guest = pvpPlayerFromMessage(ws, clientId, msg, "even");
      guest.ready = false;
      room.guest = guest;
      sendPvpRoomUpdate(room);
      return true;
    }
    case "pvp_room_ready": {
      const roomCode = String(msg.roomCode || "").trim();
      const room = pvpRooms.get(roomCode);
      if (!room) {
        safeSend(ws, { type: "pvp_error", code: "ROOM_NOT_FOUND", message: "Room not found", now: Date.now() });
        return true;
      }
      if (room.owner.clientId === clientId) room.owner.ready = true;
      else if (room.guest?.clientId === clientId) room.guest.ready = !!msg.ready;
      else {
        safeSend(ws, { type: "pvp_error", code: "NOT_IN_ROOM", message: "Not in this room", now: Date.now() });
        return true;
      }
      sendPvpRoomUpdate(room);
      return true;
    }
    case "pvp_room_start": {
      const roomCode = String(msg.roomCode || "").trim();
      const room = pvpRooms.get(roomCode);
      if (!room) {
        safeSend(ws, { type: "pvp_error", code: "ROOM_NOT_FOUND", message: "Room not found", now: Date.now() });
        return true;
      }
      if (room.owner.clientId !== clientId) {
        safeSend(ws, { type: "pvp_error", code: "ONLY_OWNER_CAN_START", message: "Only room owner can start", now: Date.now() });
        return true;
      }
      if (!room.guest || !room.guest.ready) {
        safeSend(ws, { type: "pvp_error", code: "GUEST_NOT_READY", message: "Guest is not ready", now: Date.now() });
        return true;
      }
      pvpRooms.delete(roomCode);
      createPvpMatch("room", room.owner, room.guest, roomCode);
      return true;
    }
    case "pvp_room_leave": {
      closePvpRoomForClient(clientId);
      safeSend(ws, { type: "pvp_room_left", now: Date.now() });
      return true;
    }
    case "pvp_battle_event": {
      const matchId = String(msg.matchId || "");
      const match = pvpMatches.get(matchId);
      if (!match || match.closed) {
        safeSend(ws, { type: "pvp_error", code: "MATCH_NOT_FOUND", message: "Match not found", now: Date.now() });
        return true;
      }
      const sender = match.players.find(player => player.clientId === clientId);
      if (!sender) {
        safeSend(ws, { type: "pvp_error", code: "NOT_IN_MATCH", message: "Not in this match", now: Date.now() });
        return true;
      }
      const event = msg.event ?? null;
      if (event && event.kind === "battle_ready") {
        match.readyClientIds.add(clientId);
        if (!match.battleStarted && match.readyClientIds.size >= match.players.length) {
          match.battleStarted = true;
          match.battleState = createInitialPvpBattleState(match);
          for (const player of match.players) {
            safeSend(clients.get(player.clientId), {
              type: "pvp_battle_start",
              matchId,
              firstParity: match.firstParity,
              currentParity: match.currentParity,
              now: Date.now(),
            });
          }
          sendPvpBattleSnapshot(match, "battle_start");
        }
        return true;
      }
      if (event && event.kind === "pvp_turn_end") {
        if (!match.battleStarted || !match.battleState) {
          safeSend(ws, { type: "pvp_error", code: "BATTLE_NOT_STARTED", message: "Battle has not started", now: Date.now() });
          return true;
        }
        if (sender.parity !== match.battleState.currentParity) {
          safeSend(ws, { type: "pvp_error", code: "NOT_YOUR_TURN", message: "It is not your turn", now: Date.now() });
          return true;
        }
        updatePvpBattleUnits(match, event.units);
        updatePvpWinner(match);
        if (!match.battleState.winnerParity) {
          match.battleState.currentParity = sender.parity === "odd" ? "even" : "odd";
          match.battleState.turn += 1;
        }
        match.currentParity = match.battleState.currentParity;
        sendPvpBattleSnapshot(match, "turn_end");
        return true;
      }
      for (const player of match.players) {
        if (player.clientId === clientId) continue;
        safeSend(clients.get(player.clientId), {
          type: "pvp_battle_event",
          matchId,
          from: publicPvpPlayer(sender),
          event,
          seq: msg.seq ?? null,
          now: Date.now(),
        });
      }
      return true;
    }
    default:
      return false;
  }
}

wss.on("connection", (ws, req) => {
  const clientId = `player_${clientSeq++}`;
  const url = new URL(req.url || "/", "http://localhost");
  const token = url.searchParams.get("token");
  const tokenUser = getUserFromToken(token);
  ws.isAlive = true;
  ws.publicName = tokenUser || clientId;
  clients.set(clientId, ws);

  console.log(`[connect] ${clientId} ${req.socket.remoteAddress}`);

  safeSend(ws, { type: "welcome", clientId, username: ws.publicName, now: Date.now() });
  broadcast({ type: "player_join", clientId, onlineCount: clients.size, now: Date.now() }, clientId);

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", raw => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      safeSend(ws, { type: "error", code: "BAD_JSON", message: "Message must be JSON" });
      return;
    }

    if (handlePvpMessage(ws, clientId, msg)) return;

    switch (msg.type) {
      case "ping":
        safeSend(ws, { type: "pong", now: Date.now() });
        break;
      case "chat":
        broadcast({ type: "chat", from: clientId, text: String(msg.text || ""), now: Date.now() });
        break;
      case "broadcast":
        broadcast({ type: "broadcast", from: clientId, payload: msg.payload ?? null, now: Date.now() });
        break;
      case "direct": {
        const to = String(msg.to || "");
        const target = clients.get(to);
        if (!target) {
          safeSend(ws, { type: "error", code: "PLAYER_NOT_FOUND", message: `Player not found: ${to}` });
          return;
        }
        safeSend(target, { type: "direct", from: clientId, payload: msg.payload ?? null, now: Date.now() });
        break;
      }
      default:
        safeSend(ws, { type: "error", code: "UNKNOWN_TYPE", message: `Unsupported message type: ${msg.type}` });
    }
  });

  ws.on("close", () => {
    cleanupPvpClient(clientId);
    clients.delete(clientId);
    console.log(`[disconnect] ${clientId}`);
    broadcast({ type: "player_leave", clientId, onlineCount: clients.size, now: Date.now() });
  });

  ws.on("error", err => {
    console.error(`[ws_error] ${clientId}`, err.message);
  });
});

const heartbeatTimer = setInterval(() => {
  for (const [clientId, ws] of clients.entries()) {
    if (ws.isAlive === false) {
      clients.delete(clientId);
      ws.terminate();
      console.log(`[heartbeat_kill] ${clientId}`);
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, () => {
  console.log(`HTTP API listening on http://127.0.0.1:${PORT}`);
  console.log(`WebSocket server listening on ws://127.0.0.1:${PORT}`);
});

function shutdown() {
  clearInterval(heartbeatTimer);
  console.log("Shutting down server...");
  for (const ws of clients.values()) {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  }
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
