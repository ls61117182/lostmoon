/**
 * 简单 WebSocket 游戏通讯服务器
 * 启动:
 *   1) cd server
 *   2) npm init -y
 *   3) npm i ws
 *   4) node server.js
 */

const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, time: Date.now() }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "Not Found" }));
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

  safeSend(ws, {
    type: "welcome",
    clientId,
    now: Date.now(),
  });

  broadcast(
    {
      type: "player_join",
      clientId,
      onlineCount: clients.size,
      now: Date.now(),
    },
    clientId
  );

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      safeSend(ws, {
        type: "error",
        code: "BAD_JSON",
        message: "消息必须是 JSON",
      });
      return;
    }

    // 协议示例:
    // { "type": "chat", "text": "hello" }
    // { "type": "broadcast", "payload": { ... } }
    // { "type": "direct", "to": "player_2", "payload": { ... } }
    switch (msg.type) {
      case "ping":
        safeSend(ws, { type: "pong", now: Date.now() });
        break;

      case "chat":
        broadcast({
          type: "chat",
          from: clientId,
          text: String(msg.text || ""),
          now: Date.now(),
        });
        break;

      case "broadcast":
        broadcast({
          type: "broadcast",
          from: clientId,
          payload: msg.payload ?? null,
          now: Date.now(),
        });
        break;

      case "direct": {
        const to = String(msg.to || "");
        const target = clients.get(to);
        if (!target) {
          safeSend(ws, {
            type: "error",
            code: "PLAYER_NOT_FOUND",
            message: `目标玩家不存在: ${to}`,
          });
          return;
        }
        safeSend(target, {
          type: "direct",
          from: clientId,
          payload: msg.payload ?? null,
          now: Date.now(),
        });
        break;
      }

      default:
        safeSend(ws, {
          type: "error",
          code: "UNKNOWN_TYPE",
          message: `不支持的消息类型: ${msg.type}`,
        });
    }
  });

  ws.on("close", () => {
    clients.delete(clientId);
    console.log(`[disconnect] ${clientId}`);
    broadcast({
      type: "player_leave",
      clientId,
      onlineCount: clients.size,
      now: Date.now(),
    });
  });

  ws.on("error", (err) => {
    console.error(`[ws_error] ${clientId}`, err.message);
  });
});

// 心跳: 清理断线连接
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
  console.log(`WebSocket server listening on ws://127.0.0.1:${PORT}`);
  console.log(`Health check: http://127.0.0.1:${PORT}/health`);
});

function shutdown() {
  clearInterval(heartbeatTimer);
  console.log("Shutting down server...");
  for (const ws of clients.values()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  }
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
