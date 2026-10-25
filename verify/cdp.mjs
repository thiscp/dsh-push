// cdp.mjs - the ONE Chrome DevTools Protocol connector for the dsh-push app WebView.
//
// Before 2026-10-25 every verify/*.mjs re-implemented this block (21 copies of adb forward +
// json/list + WebSocket). Three of them threw a bare `Error: cdp` that hid the real CDP error
// message and burned ~40 minutes of debugging, so this copy always surfaces the real error.
//
// Usage (ESM, node 22+, no npm deps):
//   import { connect, sleep, adb } from './cdp.mjs';
//   const c = await connect();          // throws with a readable reason if the app is not up
//   const v = await c.ev('location.href');
//   c.close();
//
// Env overrides: ADB (adb path), SERIAL (device serial), PKG (package), CDP_PORT.
// Returned object: { ws, ev, send, close, pid, port }
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

export const ADB = process.env.ADB || 'G:/Android/Sdk/platform-tools/adb.exe';
export const SERIAL = process.env.SERIAL || 'emulator-5554';
export const PKG = process.env.PKG || 'xyz.cpyh.dshpush';
export const CDP_PORT = Number(process.env.CDP_PORT || 9223);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Run adb synchronously. Returns stdout as utf8 text (empty string on failure is NOT swallowed:
// callers that need failures visible use adbTry).
export function adb(args) {
  return execFileSync(ADB, ['-s', SERIAL].concat(args), { encoding: 'utf8', maxBuffer: 64e6 });
}

// Same as adb() but returns { ok, out, err } instead of throwing.
export function adbTry(args) {
  try {
    return { ok: true, out: execFileSync(ADB, ['-s', SERIAL].concat(args), { encoding: 'utf8', maxBuffer: 64e6 }), err: '' };
  } catch (e) {
    return { ok: false, out: String((e && e.stdout) || ''), err: String((e && e.stderr) || (e && e.message) || e) };
  }
}

// Screenshot straight to a file. NEVER pipe `exec-out screencap -p` through a PowerShell `>`
// redirect: PS 5.1 writes UTF-16 and the PNG header gets corrupted (magic ff fe fd ff).
export function shot(path) {
  const fd = fs.openSync(path, 'w');
  try {
    execFileSync(ADB, ['-s', SERIAL, 'exec-out', 'screencap', '-p'], { stdio: ['ignore', fd, 'inherit'], maxBuffer: 64e6 });
  } finally {
    try { fs.closeSync(fd); } catch { }
  }
  const n = fs.statSync(path).size;
  if (n < 1000) throw new Error('screenshot came back tiny (' + n + ' bytes) - exec-out screencap is flaky; retry');
  return n;
}

// Wait until the app process exists and WebView devtools answers, then open the page target.
// retries: pid poll 15x1.5s, /json/list 12x1.2s.
export async function connect(opts = {}) {
  const port = opts.port || CDP_PORT;
  const pkg = opts.pkg || PKG;
  let pid = '';
  for (let a = 1; a <= 15; a++) {
    const r = adbTry(['shell', 'pidof', pkg]);
    pid = String(r.out || '').trim().split(/\s+/)[0];
    if (/^\d+$/.test(pid)) break;
    if (opts.launch !== false && a === 3) {
      adbTry(['shell', 'am', 'start', '-n', pkg + '/.MainActivity']);
    }
    await sleep(1500);
  }
  if (!/^\d+$/.test(pid)) throw new Error('app not running: pidof ' + pkg + ' returned "' + pid + '" (is the emulator up? is the package installed?)');
  adbTry(['forward', '--remove-all']);
  const fw = adbTry(['forward', 'tcp:' + port, 'localabstract:webview_devtools_remote_' + pid]);
  if (!fw.ok) throw new Error('adb forward failed: ' + fw.err);
  let list = null;
  let lastErr = '';
  for (let a = 1; a <= 12; a++) {
    try {
      const res = await fetch('http://127.0.0.1:' + port + '/json/list');
      list = await res.json();
      if (list && list.length) break;
    } catch (e) { lastErr = String((e && e.message) || e); }
    await sleep(1200);
  }
  if (!list || !list.length) throw new Error('no /json/list targets on port ' + port + ' for pid ' + pid + (lastErr ? ' (last fetch error: ' + lastErr + ')' : '') + ' -- is a WebView page open?');
  const page = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl).pop() || list.filter((t) => t.webSocketDebuggerUrl).pop();
  if (!page) throw new Error('targets exist but none has a webSocketDebuggerUrl: ' + JSON.stringify(list.map((t) => t.type + ':' + t.url)));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', (e) => rej(new Error('websocket error talking to ' + page.webSocketDebuggerUrl + ': ' + ((e && e.message) || 'unknown'))), { once: true });
  });
  let id = 0;
  const pend = new Map();
  ws.addEventListener('message', (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.id && pend.has(m.id)) {
      const p = pend.get(m.id);
      pend.delete(m.id);
      if (m.error) p.rej(new Error('CDP ' + m.method + ': ' + (m.error.message || JSON.stringify(m.error))));
      else p.res(m.result);
    }
  });
  // timeoutMs: CDP has no default budget of its own; a dead renderer would hang forever.
  const send = (method, params, timeoutMs = 40000) => new Promise((res, rej) => {
    const i = ++id;
    pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    setTimeout(() => { if (pend.delete(i)) rej(new Error('CDP timeout after ' + timeoutMs + 'ms on ' + method)); }, timeoutMs);
  });
  // ev(): evaluate an expression in the page and return its value by value.
  // On a JS exception it returns { __err: "..." } instead of throwing, so a probe can report and
  // keep going; callers that care check for __err.
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return { __err: JSON.stringify(r.exceptionDetails).slice(0, 600) };
    return r && r.result ? r.result.value : undefined;
  };
  // evOr(): like ev() but throws on page errors - use when a silent failure would mislead.
  const evOr = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) throw new Error('page JS error in [' + expr.slice(0, 80) + ']: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails).slice(0, 400));
    return r && r.result ? r.result.value : undefined;
  };
  const close = () => { try { ws.close(); } catch { } };
  return { ws, ev, evOr, send, close, pid, port };
}
