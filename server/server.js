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

wss.on("connection", (ws, req) => {
  const clientId = `player_${clientSeq++}`;
  ws.isAlive = true;
  clients.set(clientId, ws);

  console.log(`[connect] ${clientId} ${req.socket.remoteAddress}`);

  safeSend(ws, { type: "welcome", clientId, now: Date.now() });
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
