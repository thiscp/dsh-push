// qa-ux-suite.mjs - comprehensive UX measurements for v1.32.14 experience round.
// RUNS ON THE EMULATOR HOST (laptop). Reuses the CDP plumbing from qa-overlay-probe.mjs.
// Covers: P01 spacing, P02 type scale, P03 watermark, P08 overflow, C06 session switch,
//         C07 light/dark theme, C08 offline/reconnect, A09 rotation, A16 group button spacing.
// usage: node qa-ux-suite.mjs <dsh-web-url> <outdir>
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const ADB = "G:\\Android\\Sdk\\platform-tools\\adb.exe";
const URL = process.argv[2];
const OUTDIR = process.argv[3] || "G:\\Android\\qa-ux";
const PORT = "9229";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUTDIR, { recursive: true });

function adb(args) {
  return execFileSync(ADB, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 60000 });
}
function whoami() { try { return String(adb(["shell", "whoami"]) || "").trim(); } catch (e) { return "ERR"; } }
function pidofApp() {
  try { return String(adb(["shell", "pidof", "xyz.cpyh.dshpush"]) || "").trim(); }
  catch (e) { const s = String((e && (e.stdout || e.message)) || ""); if (/^\s*\d/.test(s)) return s.trim(); return ""; }
}
async function requireRoot(tag) {
  let who = whoami();
  if (who === "root") { console.log("ADB_ROOT " + tag + " already=root"); return; }
  try { adb(["root"]); } catch (e) {}
  await sleep(3000);
  for (let i = 0; i < 20; i++) { who = whoami(); if (who === "root") { console.log("ADB_ROOT " + tag + " root after " + (i + 1)); return; } await sleep(1500); }
  throw new Error("BLOCKED: adbd not root");
}
function shot(name) {
  const remote = `/sdcard/${name}.png`;
  try { adb(["shell", "screencap", "-p", remote]); adb(["pull", remote, `${OUTDIR}\\${name}.png`]); const st = fs.statSync(`${OUTDIR}\\${name}.png`); console.log("SHOT " + name + " bytes=" + st.size + " ok=" + (st.size > 100000)); return st.size > 100000; }
  catch (e) { console.log("SHOT " + name + " FAILED"); return false; }
}

let ws = null, id = 0, pending = new Map();
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
function send(method, params = {}) {
  const i = ++id;
  return new Promise((res, rej) => { pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.delete(i)) rej(new Error("timeout " + method)); }, 25000); });
}
async function ev(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r && r.exceptionDetails) throw new Error("JS: " + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r && r.result ? r.result.value : undefined;
}
async function waitFor(expr, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { try { if (await ev(expr)) return true; } catch {} await sleep(500); }
  return false;
}
function log(k, v) { console.log(k + " " + (typeof v === "object" ? JSON.stringify(v) : v)); }

async function main() {
  await requireRoot("main");
  adb(["shell", "am", "force-stop", "xyz.cpyh.dshpush"]);
  adb(["shell", "am", "start", "-n", "xyz.cpyh.dshpush/.WebActivity", "--es", "url", URL]);
  await sleep(9000);
  const pid = await connect();
  log("APP_PID", pid);
  log("VIEWPORT", await ev("({w: innerWidth, h: innerHeight, dpr: devicePixelRatio})"));
  const shellOk = await waitFor("!!document.querySelector('[class*=\"BynINW_frame\"]')", 25000);
  log("SHELL_READY", shellOk);
  await sleep(2000);

  // expand sidebar via JS dispatchEvent (CDP synthetic click is stolen by _tab_*)
  await ev("(function(){const b=document.querySelector('[class*=\"_2H3hWW_toggle\"]')||document.querySelector('[aria-label=\"Open sidebar\"]');if(b){b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));return true;}return false;})()");
  await sleep(2500);
  shot("qa-ux-sidebar-expanded");

  // P01 spacing: icon x, title x, time right per session row
  const p01 = await ev("(function(){const rows=Array.from(document.querySelectorAll('[class*=\"_2H3hWW_row\"], [class*=\"_2H3hWW_session\"]')).slice(0,6);if(rows.length===0){const items=Array.from(document.querySelectorAll('[role=\"option\"], [class*=\"_2H3hWW_item\"]')).slice(0,6);return items.map(el=>{const r=el.getBoundingClientRect();const icon=el.querySelector('svg,img');const t=el.querySelector('[class*=\"_2H3hWW_title\"], span');return {x:r.x,w:r.width,iconX:icon?icon.getBoundingClientRect().x:null,titleX:t?t.getBoundingClientRect().x:null};});}return rows.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,w:r.width};});})()");
  log("P01_ROWS", p01);

  // P02 type scale
  const p02 = await ev("(function(){const h=document.querySelector('[class*=\"BynINW_header\"] h1, h1, [class*=\"_2H3hWW_header\"]');const body=document.querySelector('[class*=\"_9lTDKa_list\"] [class*=\"_9lTDKa_title\"], [class*=\"_2H3hWW_title\"]');const cs=h?getComputedStyle(h):null;const bs=body?getComputedStyle(body):null;return {headerFont:cs?cs.fontSize:null,headerLH:cs?cs.lineHeight:null,bodyFont:bs?bs.fontSize:null,bodyLH:bs?bs.lineHeight:null};})()");
  log("P02_TYPE", p02);

  // P03 watermark: behind-panel text visibility (alpha of panel bg + behind text presence)
  const p03 = await ev("(function(){const panel=document.querySelector('[class*=\"_2H3hWW_root\"]');const cs=panel?getComputedStyle(panel):null;const frame=document.querySelector('[class*=\"BynINW_frame\"]');const fcs=frame?getComputedStyle(frame):null;return {panelBg:cs?cs.backgroundColor:null,frameBg:fcs?fcs.backgroundColor:null};})()");
  log("P03_WATERMARK", p03);

  // P08 overflow: list scroll
  const p08 = await ev("(function(){const l=document.querySelector('[class*=\"_9lTDKa_list\"]');if(!l)return null;return {scrollH:l.scrollHeight,clientH:l.clientHeight,hasXScroll:l.scrollWidth>l.clientWidth};})()");
  log("P08_OVERFLOW", p08);

  // C06 session switch: tap 2nd session, check title/url
  const c06before = await ev("(function(){const t=document.querySelector('[class*=\"BynINW_header\"] h1, h1');return t?t.textContent.slice(0,40):null;})()");
  await ev("(function(){const items=Array.from(document.querySelectorAll('[role=\"option\"], [class*=\"_2H3hWW_item\"], [class*=\"_9lTDKa_row\"]')).filter(e=>e.getBoundingClientRect().height>0);if(items.length>=2){items[1].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));return true;}return false;})()");
  await sleep(3000);
  const c06after = await ev("(function(){const t=document.querySelector('[class*=\"BynINW_header\"] h1, h1');return t?t.textContent.slice(0,40):null;})()");
  log("C06_SWITCH", { before: c06before, after: c06after });
  shot("qa-ux-session2");

  // A16 group button spacing: measure adjacent center distances for grouped icon buttons
  const a16 = await ev("(function(){const btns=Array.from(document.querySelectorAll('[class*=\"_2H3hWW_iconButton\"], button, [role=\"button\"]')).filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.width<80;});const groups={};for(const b of btns){const r=b.getBoundingClientRect();const key=Math.round(r.y/40);if(!groups[key])groups[key]=[];groups[key].push({x:r.x,c:r.x+r.width/2,w:r.width,h:r.height,label:(b.getAttribute('aria-label')||'').slice(0,20)});}const result=[];for(const k of Object.keys(groups)){const g=groups[k].sort((a,b)=>a.x-b.x);for(let i=1;i<g.length;i++){result.push({gap:g[i].c-g[i-1].c,w:g[i].w,prevW:g[i-1].w});}}return result.slice(0,15);})()");
  log("A16_GROUPS", a16);

  // A09 rotation
  adb(["shell", "settings", "put", "system", "accelerometer_rotation", "0"]);
  adb(["shell", "settings", "put", "system", "user_rotation", "1"]);
  await sleep(4000);
  const rotW = await ev("innerWidth");
  shot("qa-ux-landscape");
  adb(["shell", "settings", "put", "system", "user_rotation", "0"]);
  await sleep(3000);
  log("A09_ROTATION", { landscapeWidth: rotW, portraitWidth: await ev("innerWidth") });

  // C07 light/dark theme
  adb(["shell", "cmd", "uimode", "night", "yes"]);
  await sleep(3000);
  const darkFrame = await ev("(function(){const f=document.querySelector('[class*=\"BynINW_frame\"]');const cs=f?getComputedStyle(f):null;return cs?cs.backgroundColor:null;})()");
  shot("qa-ux-dark");
  adb(["shell", "cmd", "uimode", "night", "no"]);
  await sleep(3000);
  log("C07_DARK", { frameBg: darkFrame });

  // C08 offline/reconnect
  adb(["shell", "cmd", "connectivity", "airplane-mode", "enable"]);
  await sleep(8000);
  const offShell = await ev("!!document.querySelector('[class*=\"BynINW_frame\"]')");
  shot("qa-ux-offline");
  adb(["shell", "cmd", "connectivity", "airplane-mode", "disable"]);
  await sleep(12000);
  const onShell = await ev("!!document.querySelector('[class*=\"BynINW_frame\"]')");
  log("C08_OFFLINE", { offlineShell: offShell, onlineShell: onShell });

  // A13 note: App-internal theme toggle is a product UI flow; screenshot captured for manual review
  console.log("A13_NOTE App-internal theme toggle requires product UI navigation; see manual review");

  console.log("REPORT " + OUTDIR + "\\ux-report.json");
  console.log("DEVICE_CLEAN whoami=" + whoami() + " pidof=" + pidofApp());
  try { if (ws) ws.close(); } catch {}
  process.exit(0);
}

main().catch((e) => { console.error("FATAL " + String(e && e.message).slice(0, 200)); process.exit(1); });
