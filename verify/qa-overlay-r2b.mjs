// qa-overlay-r2b.mjs - task-9 Part B completion (0.96 frozen build).
// The main r2 probe delivered 5/5 HIGH samples at 0.96 then stalled; this finishes the rest:
//   LOW-geometry samples (threshold's other side), P13 expanded sidebar, C12 outside-tap collapse,
//   A29 multi-overlay attempt, and the HASH BRACKET close.
// Robust connect (bounded retry): after a fresh boot the devtools socket does not exist yet.
// usage: node qa-overlay-r2b.mjs <url> <outdir> <expectedSha> [lowRounds]
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const ADB = "G:\\Android\\Sdk\\platform-tools\\adb.exe";
const URL = process.argv[2];
const OUTDIR = process.argv[3] || "G:\\Android\\qa-r2d";
const EXPECTED = (process.argv[4] || "").trim().toLowerCase();
const LOW = parseInt(process.argv[5] || "2", 10);
const PORT = "9232";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RGX = "/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/";
fs.mkdirSync(OUTDIR, { recursive: true });
function adb(a, o = {}) { return execFileSync(ADB, a, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 60000, ...o }); }
function whoami() { try { return String(adb(["shell", "whoami"]) || "").trim(); } catch { return "ERR"; } }
function apkSha() {
  try {
    const p = String(adb(["shell", "pm", "path", "xyz.cpyh.dshpush"]) || "").trim().replace(/^package:/, "").trim();
    if (!p) return "NO_PATH";
    const t = String(adb(["shell", "sha256sum", p]) || "").trim().split(/\s+/)[0];
    return /^[0-9a-f]{64}$/i.test(t) ? t : "UNPARSED";
  } catch (e) { return "ERR"; }
}
function shot(name) {
  try {
    adb(["shell", "screencap", "-p", `/sdcard/${name}.png`]);
    adb(["pull", `/sdcard/${name}.png`, `${OUTDIR}\\${name}.png`]);
    const st = fs.statSync(`${OUTDIR}\\${name}.png`);
    console.log("SHOT " + name + " bytes=" + st.size);
    return { name, bytes: st.size, ok: st.size > 100000 };
  } catch (e) { console.log("SHOT " + name + " FAILED"); return { name, bytes: 0, ok: false }; }
}
let ws = null, id = 0, pend = new Map();
function send(m, p = {}) {
  const i = ++id;
  return new Promise((res, rej) => { pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); setTimeout(() => { if (pend.delete(i)) rej(new Error("timeout " + m)); }, 20000); });
}
async function ev(x) {
  const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r && r.exceptionDetails) throw new Error("JS");
  return r && r.result ? r.result.value : undefined;
}
async function evJ(x) { const v = await ev(x); try { return JSON.parse(v); } catch { return { raw: v }; } }
async function clickAt(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
async function connect() {
  if (whoami() !== "root") { try { adb(["root"]); } catch { } await sleep(3500); }
  let last = null;
  for (let a = 1; a <= 20; a++) {
    try {
      const pid = adb(["shell", "pidof", "xyz.cpyh.dshpush"]).trim().split(/\s+/)[0];
      if (!/^\d+$/.test(pid)) { last = new Error("no pid"); await sleep(2000); continue; }
      try { adb(["forward", "--remove-all"]); } catch { }
      adb(["forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`]);
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.filter((t) => t.type === "page").pop();
      if (!page) { last = new Error("no page"); await sleep(2000); continue; }
      if (ws) { try { ws.close(); } catch { } }
      ws = new WebSocket(page.webSocketDebuggerUrl);
      id = 0; pend = new Map();
      ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error("cdp")) : p.res(m.result); } });
      await new Promise((r2, j2) => { ws.addEventListener("open", r2); ws.addEventListener("error", () => j2(new Error("ws"))); });
      await send("Runtime.enable");
      return pid;
    } catch (e) { last = e; await sleep(2500); }
  }
  throw new Error("connect failed: " + String((last && last.message) || last));
}
async function startFresh() {
  if (whoami() !== "root") { try { adb(["root"]); } catch { } await sleep(3500); }
  try { adb(["shell", "am", "force-stop", "xyz.cpyh.dshpush"]); } catch { }
  await sleep(1500);
  adb(["shell", "am", "start", "-n", "xyz.cpyh.dshpush/.WebActivity", "--es", "url", URL]);
  await connect();
  for (let i = 0; i < 20; i++) { if (await ev("(!!document.querySelector(\"[class*='BynINW_frame']\"))")) return; await sleep(2500); }
  throw new Error("shell not ready");
}
const MENU = `(()=>{const el=document.querySelector('[role=listbox]')||document.querySelector('[role=menu]');
  window.__qaOverlay=el;if(!el)return JSON.stringify({found:false});
  const cs=getComputedStyle(el);const m=${RGX}.exec(cs.backgroundColor);const R=el.getBoundingClientRect();
  return JSON.stringify({found:true,cls:(el.className||'').toString().slice(0,60),
    alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,inline:el.style.backgroundColor||'',
    w:Math.round(R.width),h:Math.round(R.height),
    items:[...el.querySelectorAll('[role=option]')].filter(b=>b.offsetHeight>0).length,
    overHalfH:(R.height>window.innerHeight*0.5)});})()`;
const SIDEBAR = `(()=>{const e=document.querySelector("[class*='_2H3hWW_root']");if(!e)return JSON.stringify({found:false});
  const cn=(e.className||'').toString();const r=e.getBoundingClientRect();const cs=getComputedStyle(e);const m=${RGX}.exec(cs.backgroundColor);
  return JSON.stringify({found:true,collapsed:cn.indexOf('_2H3hWW_collapsed')>=0,w:+r.width.toFixed(1),
    alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,pos:cs.position,z:cs.zIndex});})()`;
// A29: raise other overlays and record their alpha (bounded; unraisable => not covered)
const OTHEROV = `(()=>{const RGXS=${RGX};
  const surf=(e)=>{if(!e)return null;const cs=getComputedStyle(e);const m=RGXS.exec(cs.backgroundColor);const r=e.getBoundingClientRect();
    return {tag:e.tagName,cls:(e.className||'').toString().slice(0,70),role:e.getAttribute('role')||'',
      bg:cs.backgroundColor,alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,w:Math.round(r.width),h:Math.round(r.height),inline:e.style.backgroundColor||''};};
  const o={};
  for(const r of ['dialog','alertdialog','tooltip','menu','listbox']){const e=document.querySelector('[role="'+r+'"]');o[r]=e?{present:true,...surf(e)}:{present:false};}
  o.veil=surf(document.getElementById('dsh-theme-veil'));
  o.card=surf(document.querySelector("[class*='RlGAzG_card']"));
  o.frame=surf(document.querySelector("[class*='BynINW_frame']"));
  return JSON.stringify(o);})()`;
(async () => {
  const out = { startedAt: new Date().toISOString(), expected: EXPECTED, lowSamples: [], shots: [] };
  try {
    out.apkShaBefore = apkSha();
    console.log("APK_SHA_BEFORE " + out.apkShaBefore);
    if (EXPECTED && out.apkShaBefore.toLowerCase() !== EXPECTED) throw new Error("BLOCKED: sha mismatch (refusing to sample)");
    console.log("APK_SHA_MATCH ok");
    for (let i = 1; i <= LOW; i++) {
      await startFresh();
      await ev(`(()=>{const c=[...document.querySelectorAll('textarea,[contenteditable=true]')].filter(e=>e.offsetHeight>0);const el=c[c.length-1];if(el)el.focus();})()`);
      await sleep(350);
      await send("Input.insertText", { text: "/plan" });
      await sleep(1800);
      const m = await evJ(MENU);
      m.round = i;
      console.log("LOW_R" + i + " alpha=" + m.alpha + " h=" + m.h + " items=" + m.items + " overHalfH=" + m.overHalfH);
      m.shot = shot("qa-P11-r2-low-r" + i);
      out.shots.push(m.shot);
      out.lowSamples.push(m);
    }
    // A29 while no overlay is up
    out.a29_otherOverlays = await evJ(OTHEROV);
    console.log("A29_OTHER " + JSON.stringify(out.a29_otherOverlays).slice(0, 400));
    // P13 / C12
    await startFresh();
    out.p13_before = await evJ(SIDEBAR);
    await ev(`(()=>{const b=[...document.querySelectorAll('button,[role=button]')].find(x=>/open sidebar|expand/i.test(x.getAttribute('aria-label')||x.title||''));
      if(b)b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));})()`);
    await sleep(2500);
    out.p13_expanded = await evJ(SIDEBAR);
    out.p13_shot = shot("qa-P13-r2-sidebar-expanded");
    out.shots.push(out.p13_shot);
    await clickAt(340, 430);
    await sleep(1800);
    out.c12_afterOutsideTap = await evJ(SIDEBAR);
    out.c12_shot = shot("qa-C12-r2-after-outside-tap");
    out.shots.push(out.c12_shot);
    console.log("P13 " + JSON.stringify(out.p13_before) + " -> " + JSON.stringify(out.p13_expanded) + " -> " + JSON.stringify(out.c12_afterOutsideTap));
    out.finishedAt = new Date().toISOString();
  } catch (e) {
    out.fatal = String((e && e.message) || e).slice(0, 300);
    console.log("FATAL " + out.fatal);
  } finally {
    try { out.apkShaAfter = apkSha(); } catch (e) { out.apkShaAfter = "ERR"; }
    out.hashStable = out.apkShaBefore === out.apkShaAfter;
    console.log("APK_SHA_AFTER " + out.apkShaAfter + " stable=" + out.hashStable);
    try { adb(["shell", "am", "force-stop", "xyz.cpyh.dshpush"]); } catch { }
    try { adb(["forward", "--remove-all"]); } catch { }
    try { adb(["root"]); } catch { }
    await sleep(2000);
    out.deviceClean = { whoami: whoami(), forwards: (() => { try { return String(adb(["forward", "--list"]) || "").trim(); } catch { return "ERR"; } })() };
    fs.writeFileSync(`${OUTDIR}\\r2b-report.json`, JSON.stringify(out, null, 2), "utf8");
    console.log("REPORT " + OUTDIR + "\\r2b-report.json");
    console.log("DEVICE_CLEAN whoami=" + out.deviceClean.whoami + " forwards='" + out.deviceClean.forwards + "'");
    process.exit(0);
  }
})();
