// qa-ux-suite2.mjs - C06/C07/C08/P01/P02 with CDP reconnect after global-state changes.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const ADB = "G:\\Android\\Sdk\\platform-tools\\adb.exe";
const URL = process.argv[2];
const OUTDIR = process.argv[3] || "G:\\Android\\qa-ux2";
const PORT = "9229";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUTDIR, { recursive: true });
function adb(args) { return execFileSync(ADB, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 60000 }); }
function whoami() { try { return String(adb(["shell", "whoami"]) || "").trim(); } catch (e) { return "ERR"; } }
function pidofApp() { try { return String(adb(["shell", "pidof", "xyz.cpyh.dshpush"]) || "").trim(); } catch (e) { const s = String((e && (e.stdout || e.message)) || ""); if (/^\s*\d/.test(s)) return s.trim(); return ""; } }
async function requireRoot(tag) { let w = whoami(); if (w === "root") { console.log("ADB_ROOT " + tag + " already=root"); return; } try { adb(["root"]); } catch (e) {} await sleep(3000); for (let i = 0; i < 20; i++) { w = whoami(); if (w === "root") { console.log("ADB_ROOT " + tag + " root"); return; } await sleep(1500); } throw new Error("BLOCKED: not root"); }
function shot(name) { try { adb(["shell", "screencap", "-p", `/sdcard/${name}.png`]); adb(["pull", `/sdcard/${name}.png`, `${OUTDIR}\\${name}.png`]); const st = fs.statSync(`${OUTDIR}\\${name}.png`); console.log("SHOT " + name + " bytes=" + st.size + " ok=" + (st.size > 100000)); return st.size > 100000; } catch (e) { console.log("SHOT " + name + " FAILED"); return false; } }

let ws = null, id = 0, pending = new Map();
function send(method, params = {}) { const i = ++id; return new Promise((res, rej) => { pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.delete(i)) rej(new Error("timeout " + method)); }, 20000); }); }
async function ev(expr) { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true }); if (r && r.exceptionDetails) throw new Error("JS: " + JSON.stringify(r.exceptionDetails).slice(0, 200)); return r && r.result ? r.result.value : undefined; }
async function connect() {
  await requireRoot("connect");
  const pid = adb(["shell", "pidof", "xyz.cpyh.dshpush"]).trim().split(/\s+/)[0];
  if (!/^\d+$/.test(pid)) throw new Error("app not running");
  try { adb(["forward", "--remove-all"]); } catch {}
  adb(["forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`]);
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.filter((t) => t.type === "page").pop();
  if (!page) throw new Error("no page target");
  if (ws) { try { ws.close(); } catch {} }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  id = 0; pending = new Map();
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } });
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", () => rej(new Error("ws error"))); });
  await send("Page.enable"); await send("Runtime.enable");
  return pid;
}
async function reconnect() { try { if (ws) ws.close(); } catch {} await sleep(2000); return connect(); }
function log(k, v) { console.log(k + " " + (typeof v === "object" ? JSON.stringify(v) : v)); }

async function main() {
  await requireRoot("main");
  adb(["shell", "am", "force-stop", "xyz.cpyh.dshpush"]);
  adb(["shell", "am", "start", "-n", "xyz.cpyh.dshpush/.WebActivity", "--es", "url", URL]);
  await sleep(9000);
  let pid = await connect();
  log("APP_PID", pid);
  // wait for shell
  for (let i = 0; i < 30; i++) { try { if (await ev("!!document.querySelector('[class*=\"BynINW_frame\"]')")) break; } catch {} await sleep(1000); }
  log("SHELL_READY", await ev("!!document.querySelector('[class*=\"BynINW_frame\"]')"));
  await sleep(2000);

  // expand sidebar via JS dispatchEvent
  await ev("(function(){const b=document.querySelector('[class*=\"_2H3hWW_toggle\"]')||document.querySelector('[aria-label=\"Open sidebar\"]');if(b){b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));return true;}return false;})()");
  await sleep(2500);
  shot("qa-ux2-sidebar");

  // P01 spacing + P02 type within sidebar
  const p01 = await ev("(function(){const list=document.querySelector('[class*=\"_9lTDKa_list\"]');if(!list)return null;const rows=Array.from(list.children).filter(e=>e.getBoundingClientRect().height>0).slice(0,6);return rows.map(el=>{const r=el.getBoundingClientRect();const icon=el.querySelector('svg,img');const title=el.querySelector('[class*=\"_9lTDKa_title\"], span');const time=el.querySelector('[class*=\"_9lTDKa_time\"]');return {rowX:r.x,rowW:r.width,iconX:icon?Math.round(icon.getBoundingClientRect().x):null,titleX:title?Math.round(title.getBoundingClientRect().x):null,timeRight:time?Math.round(time.getBoundingClientRect().right):null};});})()");
  log("P01_SPACING", p01);
  const p02 = await ev("(function(){const h=document.querySelector('h1, [class*=\"BynINW_header\"] h1');const t=document.querySelector('[class*=\"_9lTDKa_title\"]');const hc=h?getComputedStyle(h):null;const tc=t?getComputedStyle(t):null;return {headerFont:hc?hc.fontSize:null,headerLH:hc?hc.lineHeight:null,titleFont:tc?tc.fontSize:null,titleLH:tc?tc.lineHeight:null};})()");
  log("P02_TYPE", p02);

  // C06 session switch: tap 2nd visible sidebar item
  const c06before = await ev("(function(){const h=document.querySelector('h1, [class*=\"BynINW_header\"] h1');return h?h.textContent.slice(0,50):null;})()");
  const c06tapped = await ev("(function(){const list=document.querySelector('[class*=\"_9lTDKa_list\"]');if(!list)return false;const items=Array.from(list.children).filter(e=>e.getBoundingClientRect().height>0);if(items.length>=2){items[1].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));return true;}return false;})()");
  await sleep(3500);
  const c06after = await ev("(function(){const h=document.querySelector('h1, [class*=\"BynINW_header\"] h1');return h?h.textContent.slice(0,50):null;})()");
  log("C06_SWITCH", { before: c06before, after: c06after, tapped: c06tapped });
  shot("qa-ux2-session2");

  // C07 light/dark theme (uimode) - reconnect CDP after
  adb(["shell", "cmd", "uimode", "night", "yes"]);
  await sleep(4000);
  try { await reconnect(); } catch (e) { log("C07_RECONNECT_ERR", String(e.message).slice(0, 80)); }
  for (let i = 0; i < 20; i++) { try { if (await ev("!!document.querySelector('[class*=\"BynINW_frame\"]')")) break; } catch {} await sleep(1000); }
  const darkFrame = await ev("(function(){const f=document.querySelector('[class*=\"BynINW_frame\"]');const cs=f?getComputedStyle(f):null;return cs?cs.backgroundColor:null;})()");
  const darkText = await ev("(function(){const t=document.querySelector('[class*=\"_9lTDKa_title\"]');const cs=t?getComputedStyle(t):null;return cs?cs.color:null;})()");
  shot("qa-ux2-dark");
  adb(["shell", "cmd", "uimode", "night", "no"]);
  await sleep(3000);
  log("C07_DARK", { frameBg: darkFrame, textColor: darkText });

  // C08 offline/reconnect
  adb(["shell", "cmd", "connectivity", "airplane-mode", "enable"]);
  await sleep(8000);
  const offShell = await ev("!!document.querySelector('[class*=\"BynINW_frame\"]')");
  shot("qa-ux2-offline");
  adb(["shell", "cmd", "connectivity", "airplane-mode", "disable"]);
  await sleep(12000);
  const onShell = await ev("!!document.querySelector('[class*=\"BynINW_frame\"]')");
  const onFrame = await ev("(function(){const f=document.querySelector('[class*=\"BynINW_frame\"]');const cs=f?getComputedStyle(f):null;return cs?cs.backgroundColor:null;})()");
  log("C08_OFFLINE", { offlineShell: offShell, onlineShell: onShell, onlineFrame: onFrame });

  console.log("DEVICE_CLEAN whoami=" + whoami() + " pidof=" + pidofApp());
  try { if (ws) ws.close(); } catch {}
  process.exit(0);
}
main().catch((e) => { console.error("FATAL " + String(e && e.message).slice(0, 200)); process.exit(1); });
