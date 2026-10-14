// qa-doc-diff.mjs - task-11 focused follow-up: exercise the DIFF view of the doc panel.
// The main probe opened a plain reading view (header had no "+N -M"). This one enumerates every
// tab cell, clicks the one that looks like a change/diff tab, and measures the panel + header so
// both required views are actually covered (not just assumed identical).
// usage: node qa-doc-diff.mjs <url> <outdir> <expectedSha>
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const ADB = "G:\\Android\\Sdk\\platform-tools\\adb.exe";
const URL = process.argv[2];
const OUTDIR = process.argv[3] || "G:\\Android\\qa-doc";
const EXPECTED = (process.argv[4] || "").trim().toLowerCase();
const PORT = "9234";
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
  } catch { return "ERR"; }
}
function shot(name) {
  try {
    adb(["shell", "screencap", "-p", `/sdcard/${name}.png`]);
    adb(["pull", `/sdcard/${name}.png`, `${OUTDIR}\\${name}.png`]);
    const st = fs.statSync(`${OUTDIR}\\${name}.png`);
    console.log("SHOT " + name + " bytes=" + st.size);
    return { name, bytes: st.size, ok: st.size > 100000 };
  } catch (e) { return { name, bytes: 0, ok: false }; }
}
let ws = null, id = 0, pend = new Map();
function send(m, p = {}) {
  const i = ++id;
  return new Promise((res, rej) => { pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); setTimeout(() => { if (pend.delete(i)) rej(new Error("timeout")); }, 25000); });
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
  for (let a = 1; a <= 20; a++) {
    try {
      const pid = adb(["shell", "pidof", "xyz.cpyh.dshpush"]).trim().split(/\s+/)[0];
      if (!/^\d+$/.test(pid)) { await sleep(2000); continue; }
      try { adb(["forward", "--remove-all"]); } catch { }
      adb(["forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`]);
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.filter((t) => t.type === "page").pop();
      if (!page) { await sleep(2000); continue; }
      if (ws) { try { ws.close(); } catch { } }
      ws = new WebSocket(page.webSocketDebuggerUrl);
      id = 0; pend = new Map();
      ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error("cdp")) : p.res(m.result); } });
      await new Promise((r2, j2) => { ws.addEventListener("open", r2); ws.addEventListener("error", () => j2(new Error("ws"))); });
      await send("Runtime.enable");
      return pid;
    } catch (e) { await sleep(2500); }
  }
  throw new Error("connect failed");
}
const PANEL = `(()=>{const RGXS=${RGX};
  const live=[...document.querySelectorAll("[class*='_tabHost']")].filter(e=>e.offsetWidth>0&&e.offsetHeight>0)
    .sort((a,b)=>(b.offsetWidth*b.offsetHeight)-(a.offsetWidth*a.offsetHeight));
  const e=live[0];if(!e)return JSON.stringify({open:false});
  const cs=getComputedStyle(e);const m=RGXS.exec(cs.backgroundColor);
  const hdr=document.querySelector("[class*='TdjKvG_header']");
  const ht=hdr?(hdr.textContent||'').trim():'';
  return JSON.stringify({open:true,alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,bg:cs.backgroundColor,
    w:e.offsetWidth,h:e.offsetHeight,headerText:ht.slice(0,90),
    diffMatch:(ht.match(/\\+\\d+\\s*-\\d+/)||[])[0]||'',isDiff:/\\+\\d+\\s*-\\d+/.test(ht),
    inline:e.style.backgroundColor||''});})()`;
// enumerate every tab cell with its label so we can pick a change/diff tab
const TABS = `(()=>{const out=[];
  for(const e of document.querySelectorAll("[class*='_tabCell'],[class*='_tab_'],[role=tab]")){
    const r=e.getBoundingClientRect(); if(r.width<=0||r.height<=0) continue;
    out.push({tag:e.tagName,cls:(e.className||'').toString().slice(0,60),
      text:(e.textContent||'').trim().slice(0,50),role:e.getAttribute('role')||'',
      x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});}
  return JSON.stringify(out.slice(0,20));})()`;
(async () => {
  const out = { startedAt: new Date().toISOString(), expected: EXPECTED };
  try {
    out.apkShaBefore = apkSha();
    console.log("APK_SHA_BEFORE " + out.apkShaBefore);
    if (EXPECTED && out.apkShaBefore.toLowerCase() !== EXPECTED) throw new Error("BLOCKED: sha mismatch");
    console.log("APK_SHA_MATCH ok");

    // fresh app, then open the SAME doc as the main run by clicking a .md link in chat
    try { adb(["shell", "am", "force-stop", "xyz.cpyh.dshpush"]); } catch { }
    await sleep(1500);
    adb(["shell", "am", "start", "-n", "xyz.cpyh.dshpush/.WebActivity", "--es", "url", URL]);
    await connect();
    for (let i = 0; i < 20; i++) { if (await ev("(!!document.querySelector(\"[class*='BynINW_frame']\"))")) break; await sleep(2500); }

    // open any doc to get the tab bar populated
    const tg = await evJ(`(()=>{const out=[];
      for(const e of document.querySelectorAll('a,button,[role=button]')){
        const t=((e.textContent||'')+' '+(e.getAttribute&&(e.getAttribute('title')||'')||'')).toLowerCase();
        if(t.indexOf('.md')>=0||t.indexOf('markdown')>=0){const r=e.getBoundingClientRect();
          if(r.width>0&&r.height>0) out.push({text:(e.textContent||'').trim().slice(0,40),x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});}}
      return JSON.stringify(out.slice(0,6));})()`);
    out.docLinks = tg;
    for (const t of (Array.isArray(tg) ? tg : []).slice(0, 3)) {
      await ev(`(()=>{const all=[...document.querySelectorAll('a,button,[role=button]')];
        const e=all.find(x=>{const r=x.getBoundingClientRect();return Math.round(r.left+r.width/2)===${t.x}&&Math.round(r.top+r.height/2)===${t.y};});
        if(e){const c=e.closest('button,a,[role=button]')||e;c.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));}})()`);
      await sleep(1800);
      const p = await evJ(PANEL);
      if (p.open && p.w > 300) break;
    }
    out.afterOpen = await evJ(PANEL);
    console.log("OPENED " + JSON.stringify(out.afterOpen));
    out.tabs = await evJ(TABS);
    console.log("TABS " + JSON.stringify(out.tabs).slice(0, 700));

    // try each tab that looks like a change/diff tab, then any remaining tab, and measure
    const cands = (Array.isArray(out.tabs) ? out.tabs : []);
    // diff tabs are labelled with CHINESE text (e.g. "\u7b2c2\u8f6e\u6539\u52a8"); match via unicode
    // escapes so this file stays PURE ASCII (scripts shipped to the laptop must survive the scp hop)
    const DIFF_RE = new RegExp("[\\u6539\\u52a8]|diff|[\\u53d8\\u66f4]|\\+\\d");
    const diffFirst = cands.filter((c) => DIFF_RE.test(c.text)).concat(cands.filter((c) => !DIFF_RE.test(c.text)));
    out.attempts = [];
    for (const c of diffFirst.slice(0, 6)) {
      await clickAt(c.x, c.y);
      await sleep(1800);
      const p = await evJ(PANEL);
      out.attempts.push({ tab: c.text, cls: c.cls, panel: p });
      console.log("TAB '" + c.text + "' -> alpha=" + p.alpha + " isDiff=" + p.isDiff + " diffMatch='" + p.diffMatch + "' header='" + (p.headerText || '').slice(0, 50) + "'");
      if (p.isDiff) { out.diffFound = true; break; }
    }
    out.diffShot = shot("qa-C13-doc-panel-diff");
    out.finalPanel = await evJ(PANEL);
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
    fs.writeFileSync(`${OUTDIR}\\doc-diff-report.json`, JSON.stringify(out, null, 2), "utf8");
    console.log("REPORT " + OUTDIR + "\\doc-diff-report.json");
    process.exit(0);
  }
})();
