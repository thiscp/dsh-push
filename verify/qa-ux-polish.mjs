// qa-ux-polish.mjs - A04 long-text card + P01/P02/P05 gap-filling.
// RUNS ON THE EMULATOR HOST (laptop).
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const ADB = "G:\\Android\\Sdk\\platform-tools\\adb.exe";
const URL = process.argv[2];
const OUTDIR = process.argv[3] || "G:\\Android\\qa-polish";
const PORT = "9229";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUTDIR, { recursive: true });
function adb(args) { return execFileSync(ADB, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 60000 }); }
function whoami() { try { return String(adb(["shell", "whoami"]) || "").trim(); } catch (e) { return "ERR"; } }
async function requireRoot(tag) { let w = whoami(); if (w === "root") { console.log("ADB_ROOT " + tag + " root"); return; } try { adb(["root"]); } catch (e) {} await sleep(3000); for (let i = 0; i < 20; i++) { w = whoami(); if (w === "root") return; await sleep(1500); } throw new Error("BLOCKED not root"); }
function shot(name) { try { adb(["shell", "screencap", "-p", `/sdcard/${name}.png`]); adb(["pull", `/sdcard/${name}.png`, `${OUTDIR}\\${name}.png`]); const st = fs.statSync(`${OUTDIR}\\${name}.png`); console.log("SHOT " + name + " bytes=" + st.size + " ok=" + (st.size > 100000)); } catch (e) { console.log("SHOT " + name + " FAILED"); } }
let ws = null, id = 0, pending = new Map();
function send(method, params = {}) { const i = ++id; return new Promise((res, rej) => { pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.delete(i)) rej(new Error("timeout " + method)); }, 20000); }); }
async function ev(expr) { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true }); if (r && r.exceptionDetails) throw new Error("JS: " + JSON.stringify(r.exceptionDetails).slice(0, 200)); return r && r.result ? r.result.value : undefined; }
async function connect() {
  await requireRoot("connect");
  const pid = adb(["shell", "pidof", "xyz.cpyh.dshpush"]).trim().split(/\s+/)[0];
  if (!/^\d+$/.test(pid)) throw new Error("no app");
  try { adb(["forward", "--remove-all"]); } catch {}
  adb(["forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`]);
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.filter((t) => t.type === "page").pop();
  if (!page) throw new Error("no page");
  if (ws) { try { ws.close(); } catch {} }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  id = 0; pending = new Map();
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } });
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", () => rej(new Error("ws error"))); });
  await send("Page.enable"); await send("Runtime.enable");
  return pid;
}
function log(k, v) { console.log(k + " " + (typeof v === "object" ? JSON.stringify(v) : v)); }

async function main() {
  await requireRoot("main");
  // P05 load empty state: force-stop then start, 3 shots at 2s intervals
  adb(["shell", "am", "force-stop", "xyz.cpyh.dshpush"]);
  adb(["shell", "am", "start", "-n", "xyz.cpyh.dshpush/.WebActivity", "--es", "url", URL]);
  await sleep(2000); shot("qa-polish-load1");
  await sleep(2000); shot("qa-polish-load2");
  await sleep(2000); shot("qa-polish-load3");
  await sleep(8000);
  let pid = await connect();
  log("APP_PID", pid);
  for (let i = 0; i < 30; i++) { try { if (await ev("!!document.querySelector('[class*=\"BynINW_frame\"]')")) break; } catch {} await sleep(1000); }
  log("SHELL_READY", await ev("!!document.querySelector('[class*=\"BynINW_frame\"]')"));
  await sleep(2000);
  // expand sidebar
  await ev("(function(){const b=document.querySelector('[class*=\"_2H3hWW_toggle\"]')||document.querySelector('[aria-label=\"Open sidebar\"]');if(b){b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));return true;}return false;})()");
  await sleep(2500);
  shot("qa-polish-sidebar");
  // P01 spacing: sidebar rows icon/title/time alignment
  const p01 = await ev("(function(){const list=document.querySelector('[class*=\"_9lTDKa_list\"]');if(!list)return null;const rows=Array.from(list.querySelectorAll('[class*=\"_9lTDKa_row\"], [class*=\"_9lTDKa_item\"], li, [role=\"option\"]')).filter(e=>{const r=e.getBoundingClientRect();return r.height>0&&r.width>0;}).slice(0,8);return rows.map(el=>{const r=el.getBoundingClientRect();const icon=el.querySelector('svg,img');const title=el.querySelector('[class*=\"_9lTDKa_title\"], span');const time=el.querySelector('[class*=\"_9lTDKa_time\"]');return {rowX:Math.round(r.x),rowW:Math.round(r.width),iconX:icon?Math.round(icon.getBoundingClientRect().x):null,titleX:title?Math.round(title.getBoundingClientRect().x):null,timeRight:time?Math.round(time.getBoundingClientRect().right):null};});})()");
  log("P01_SPACING", p01);
  // P02 type scale: header + body font sizes
  const p02 = await ev("(function(){const h=document.querySelector('h1, [class*=\"BynINW_header\"] h1');const t=document.querySelector('[class*=\"_9lTDKa_title\"]');const body=document.querySelector('[class*=\"BynINW_frame\"]');const hc=h?getComputedStyle(h):null;const tc=t?getComputedStyle(t):null;const bc=body?getComputedStyle(body):null;return {headerFont:hc?hc.fontSize:null,headerLH:hc?hc.lineHeight:null,titleFont:tc?tc.fontSize:null,titleLH:tc?tc.lineHeight:null,bodyFont:bc?bc.fontSize:null};})()");
  log("P02_TYPE", p02);
  // A04 long-text card: inject a 200+ char Chinese + emoji + code + English long word card
  const a04 = await ev("(function(){const card=document.createElement('div');card.style.cssText='position:fixed;top:200px;left:20px;width:320px;background:#fff;border:1px solid #ccc;border-radius:12px;padding:16px;z-index:99999;font-family:sans-serif;';const longText='这是一段超过两百字的连续中文问题描述用来测试提问卡在极端文本下的排版表现确保文字换行正常不竖排不横向溢出同时混合🚀✅🧪等emoji表情符号以及一个反引号代码片段const x=42再加上英文长单词AskUserQuestionOptionsListSuperLongWord来验证卡片的滚动宽度不超过客户宽度标题行数合理选项按钮宽度大于两百像素';card.innerHTML='<div style=\"font-size:15px;font-weight:600;margin-bottom:12px;\">'+longText+'</div><div style=\"display:flex;gap:8px;margin-top:12px;\"><button style=\"padding:8px 20px;font-size:14px;\">选项 A</button><button style=\"padding:8px 20px;font-size:14px;\">选项 B</button></div>';document.body.appendChild(card);const r=card.getBoundingClientRect();const title=card.querySelector('div');const tr=title.getBoundingClientRect();const btns=card.querySelectorAll('button');const b0=btns[0].getBoundingClientRect();return {cardW:Math.round(r.width),scrollW:card.scrollWidth,clientW:card.clientWidth,hOverflow:card.scrollWidth>card.clientWidth,titleLines:Math.round(tr.height/22),btnW:Math.round(b0.width),titleFont:getComputedStyle(title).fontSize};})()");
  log("A04_LONGTEXT", a04);
  shot("qa-polish-a04-card");
  console.log("DEVICE_CLEAN whoami=" + whoami());
  try { if (ws) ws.close(); } catch {}
  process.exit(0);
}
main().catch((e) => { console.error("FATAL " + String(e && e.message).slice(0, 200)); process.exit(1); });
