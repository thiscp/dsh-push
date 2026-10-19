// qa-codeblock-purechat.mjs - task-13 gap-fix: measure the code block in the PURE CHAT state.
// The main probe found the doc reading panel ALREADY OPEN during its "chat" rounds (tabHost=1 in all
// 5 rounds; the app restores the previously-open tab), so it only ever measured the panel-open state.
// The task requires BOTH states. This probe closes the panel first, proves tabHost is gone, then
// measures the big/small code blocks again.
// usage: node qa-codeblock-purechat.mjs <url> <outdir> <expectedSha>
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const ADB = "G:\\Android\\Sdk\\platform-tools\\adb.exe";
const URL = process.argv[2];
const OUTDIR = process.argv[3] || "G:\\Android\\qa-cb";
const EXPECTED = (process.argv[4] || "").trim().toLowerCase();
const PORT = "9236";
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
const TABS = `(()=>{const out=[];
  for(const e of document.querySelectorAll("[class*='_tabClose'],[class*='_tab_']")){
    const r=e.getBoundingClientRect(); if(r.width<=0||r.height<=0)continue;
    out.push({cls:(e.className||'').toString().slice(0,60),text:(e.textContent||'').trim().slice(0,30),
      x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});}
  return JSON.stringify(out.slice(0,12));})()`;
const PANELSTATE = `(()=>{const live=[...document.querySelectorAll("[class*='_tabHost']")].filter(e=>e.offsetWidth>0&&e.offsetHeight>0);
  return JSON.stringify({liveTabHosts:live.length,
    maxArea:live.length?Math.max(...live.map(e=>e.offsetWidth*e.offsetHeight)):0});})()`;
const CB = `(()=>{const RGXS=${RGX};
  const out=[];
  for(const e of document.querySelectorAll("[class*='md-code-block']")){
    if(e.offsetWidth<=0)continue;
    const cs=getComputedStyle(e);const m=RGXS.exec(cs.backgroundColor);const r=e.getBoundingClientRect();
    const inlineBefore=e.style.backgroundColor; let native=null,restoreOk=null;
    try{e.style.removeProperty('background-color');const nm=RGXS.exec(getComputedStyle(e).backgroundColor);
      native=nm?{bg:getComputedStyle(e).backgroundColor,alpha:(nm[4]===undefined?1:parseFloat(nm[4]))}:null;
      if(inlineBefore)e.style.setProperty('background-color',inlineBefore,(e.style.getPropertyPriority('background-color')||'important'));
      restoreOk=((e.style.backgroundColor||'')===inlineBefore);}catch(err){restoreOk=false;}
    out.push({alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,bg:cs.backgroundColor,w:Math.round(r.width),h:Math.round(r.height),
      overHalf:(r.width>window.innerWidth*0.5&&r.height>window.innerHeight*0.5),inline:inlineBefore||'',native,restoreOk});}
  out.sort((a,b)=>(b.w*b.h)-(a.w*a.h));
  const big=out.filter(b=>b.overHalf),small=out.filter(b=>!b.overHalf);
  return JSON.stringify({total:out.length,big,small,bigAlphas:[...new Set(big.map(b=>b.alpha))],smallAlphas:[...new Set(small.map(b=>b.alpha))]});})()`;
const REDLINES = `(()=>{const RGXS=${RGX};
  const g=(sel)=>{const e=document.querySelector(sel);if(!e)return null;const cs=getComputedStyle(e);const m=RGXS.exec(cs.backgroundColor);
    return {bg:cs.backgroundColor,alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null};};
  return JSON.stringify({frame:g("[class*='BynINW_frame']"),centerCol:g("[class*='BynINW_centerCol']"),
    dcRoot:g("[class*='Dc7zOa_root']"),html:g("html"),body:g("body"),veil:g("#dsh-theme-veil"),card:g("[class*='RlGAzG_card']")});})()`;
(async () => {
  const out = { startedAt: new Date().toISOString() };
  try {
    out.apkShaBefore = apkSha();
    console.log("APK_SHA_BEFORE " + out.apkShaBefore);
    if (EXPECTED && out.apkShaBefore.toLowerCase() !== EXPECTED) throw new Error("BLOCKED: sha mismatch");
    console.log("APK_SHA_MATCH ok");
    try { adb(["shell", "am", "force-stop", "xyz.cpyh.dshpush"]); } catch { }
    await sleep(1500);
    adb(["shell", "am", "start", "-n", "xyz.cpyh.dshpush/.WebActivity", "--es", "url", URL]);
    await connect();
    for (let i = 0; i < 20; i++) { if (await ev("(!!document.querySelector(\"[class*='BynINW_frame']\"))")) break; await sleep(2500); }
    await sleep(4500);
    out.beforeClose = { panel: await evJ(PANELSTATE), cb: await evJ(CB) };
    console.log("BEFORE_CLOSE liveTabHosts=" + out.beforeClose.panel.liveTabHosts + " bigAlphas=" + JSON.stringify(out.beforeClose.cb.bigAlphas));
    out.tabs = await evJ(TABS);
    console.log("TABS " + JSON.stringify(out.tabs).slice(0, 400));
    // close every tab cell (the doc tab) to reach the pure-chat state
    for (let pass = 0; pass < 4; pass++) {
      const st = await evJ(PANELSTATE);
      if (st.liveTabHosts === 0) break;
      const c = await evJ(`(()=>{const e=[...document.querySelectorAll("[class*='_tabClose']")].filter(x=>x.offsetWidth>0)[0];
        if(!e)return JSON.stringify({ok:false});const r=e.getBoundingClientRect();
        return JSON.stringify({ok:true,x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`);
      if (!c.ok) {
        await ev(`(()=>{const b=[...document.querySelectorAll("[class*='_tabClose']")][0];if(b)b.dispatchEvent(new MouseEvent('click',{bubbles:true}));})()`);
      } else { await clickAt(c.x, c.y); }
      await sleep(1500);
    }
    await sleep(4500);   // let apply() settle in the new state
    out.pureChat = { panel: await evJ(PANELSTATE), cb: await evJ(CB), redlines: await evJ(REDLINES) };
    console.log("PURE_CHAT liveTabHosts=" + out.pureChat.panel.liveTabHosts +
      " bigAlphas=" + JSON.stringify(out.pureChat.cb.bigAlphas) + " smallAlphas=" + JSON.stringify(out.pureChat.cb.smallAlphas));
    console.log("PURE_CHAT redlines frame=" + out.pureChat.redlines.frame.bg + " veil=" + out.pureChat.redlines.veil.alpha);
    out.shot = shot("qa-C14-purechat-codeblock");
    out.shellAlive = !!(await ev("(!!document.querySelector(\"[class*='BynINW_frame']\"))"));
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
    fs.writeFileSync(`${OUTDIR}\\purechat-report.json`, JSON.stringify(out, null, 2), "utf8");
    console.log("REPORT " + OUTDIR + "\\purechat-report.json");
    process.exit(0);
  }
})();
