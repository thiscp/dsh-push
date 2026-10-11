#!/usr/bin/env node
// dsh-answer-bridge: keeps a $events stream to local DSH Web, maps pending
// ask_user_question events to eventIds, and answers them on behalf of the phone
// (via answer-relay forwarding). Always-on; exits non-zero only on fatal setup.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import http from "node:http";

const require = createRequire("/home/work/.npm/_npx/1e7f6d9597241db0/node_modules/");
const WebSocket = require("ws");

const BASE = "http://127.0.0.1:3081";
const WS_URL = "ws://127.0.0.1:3081/api/remote.mux";
const WEB_LOG = "/home/work/.dsh/web.log";
const BRIDGE_TOKEN_FILE = "/home/work/.config/dsh-ntfy/bridgetoken";
const LISTEN = { host: "0.0.0.0", port: 2588 }; // X-Bridge-Token required; tailscale-only network
const EVENT_TTL_MS = 3600_000;

const log = (...a) => console.log(new Date().toISOString(), ...a);
const uuid = () => crypto.randomUUID();

function lastToken() {
  const t = readFileSync(WEB_LOG, "utf8");
  const m = [...t.matchAll(/dsh web: http:\/\/[0-9.]+:[0-9]+\/\?token=([^\s]+)/g)];
  if (m.length === 0) throw new Error("no token in web.log");
  return m[m.length - 1][1];
}

let cookie = null;
async function refreshCookie() {
  const r = await fetch(BASE + "/?token=" + lastToken(), { redirect: "manual" });
  const c = (r.headers.getSetCookie?.() ?? []).map((x) => x.split(";")[0]).join("; ");
  if (!c) throw new Error("no cookie from token exchange (status " + r.status + ")");
  cookie = c;
  log("cookie refreshed");
}

async function rpc(method, args) {
  const res = await fetch(BASE + "/api/" + method, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ type: "client-request", rpcId: uuid(), method, payload: { args } }),
  });
  const text = await res.text();
  if (res.status === 401) { await refreshCookie(); return rpc(method, args); }
  let j = null; try { j = JSON.parse(text); } catch {}
  return { status: res.status, json: j, text: text.slice(0, 300) };
}

// callId/eventId registry: key = agentId + "|" + sorted question ids
const events = new Map();
let clientId = null;
let ws = null;
let reconnectDelay = 1000;

function eventKey(agentId, qids) { return agentId + "|" + [...qids].sort().join(","); }

function sweep() {
  const now = Date.now();
  for (const [k, v] of events) if (now - v.ts > EVENT_TTL_MS) events.delete(k);
}

function connectWs() {
  ws = new WebSocket(WS_URL, { headers: { cookie } });
  ws.on("open", () => {
    reconnectDelay = 1000;
    log("ws open");
    ws.send(JSON.stringify({ type: "open", streamId: "s1", endpoint: "$events", payload: { args: {} } }));
  });
  ws.on("message", (buf) => {
    let m; try { m = JSON.parse(buf.toString()); } catch { return; }
    const v = m.value ?? m;
    if (v.type === "ready" && v.clientId) { clientId = v.clientId; log("events ready clientId=" + clientId); return; }
    if (v.type === "waterfall" && v.event === "user-questions/request" && v.eventId) {
      const qids = (v.request?.questions ?? []).map((q) => q.id);
      const key = eventKey(v.agentId, qids);
      events.set(key, { eventId: v.eventId, ts: Date.now() });
      log("question event", v.agentId, JSON.stringify(qids), "eventId=" + v.eventId);
    }
  });
  ws.on("close", () => { log("ws closed, reconnect in " + reconnectDelay + "ms"); setTimeout(connectWs, reconnectDelay); reconnectDelay = Math.min(reconnectDelay * 2, 30_000); });
  ws.on("error", (e) => log("ws error:", e.message));
}

async function handleAnswer(body) {
  const { agentId, qids, callId, answers } = body ?? {};
  if (!agentId || !Array.isArray(answers)) return { ok: false, error: "bad request" };
  const key = eventKey(agentId, qids ?? []);
  const ev = events.get(key);
  if (ev && clientId) {
    const r = await rpc("$events/result", { clientId, eventId: ev.eventId, outcome: { kind: "result", value: { answers } } });
    if (r.json?.result?.ok) { events.delete(key); return { ok: true, via: "events" }; }
    log("events/result failed:", r.text);
  }
  if (callId) {
    const r = await rpc("userQuestions/answer", { agentId, callId, answer: { answers } });
    const v = r.json?.result?.value;
    if (r.json?.result?.ok && v === true) return { ok: true, via: "continued" };
    return { ok: false, error: "no pending event and continued-answer returned " + JSON.stringify(v) };
  }
  return { ok: false, error: "no pending event for " + key };
}

const server = http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  if (req.method === "GET" && req.url === "/health") return send(200, { ok: true, clientId, pending: events.size });
  if (req.method !== "POST" || req.url !== "/answer") return send(404, { ok: false, error: "not found" });
  const token = readFileSync(BRIDGE_TOKEN_FILE, "utf8").trim();
  if (req.headers["x-bridge-token"] !== token) return send(401, { ok: false, error: "bad bridge token" });
  let raw = "";
  req.on("data", (c) => { raw += c; if (raw.length > 65536) req.destroy(); });
  req.on("end", async () => {
    let body; try { body = JSON.parse(raw); } catch { return send(400, { ok: false, error: "bad json" }); }
    try { const out = await handleAnswer(body); send(out.ok ? 200 : 409, out); }
    catch (e) { log("answer error:", e.message); send(500, { ok: false, error: e.message }); }
  });
});

setInterval(sweep, 60_000);

(async () => {
  await refreshCookie();
  connectWs();
  server.listen(LISTEN.port, LISTEN.host, () => log("bridge listening on " + LISTEN.host + ":" + LISTEN.port));
})().catch((e) => { console.error("fatal:", e.message); process.exit(1); });
