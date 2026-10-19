// qa-dcroot-transient.mjs - task-13 follow-up #2: CAPTURE the transient native-white window of
// Dc7zOa_root (lead's question), because numbers alone cannot decide whether it covers the wallpaper.
//
// FINDING SO FAR (from qa-dcroot-settle.mjs timeline): Dc7zOa_root is NOT simply "read too early".
// It OSCILLATES:
//   t=2987ms alpha=1 inline='rgb(255, 255, 255)'   <- inline explicitly white
//   t=4191ms alpha=0 inline='transparent'          <- injected (correct)
//   t=4712ms alpha=1 inline=''                     <- inline GONE (node replaced) => NATIVE white
//   t=6773ms alpha=0 inline='transparent'          <- re-injected by MutationObserver+400ms debounce
// The "inline=''" state means a React re-render replaced the DOM node, wiping the inline style the
// glass injection had written; the node then shows its NATIVE rgb(255,255,255) until the next apply().
// Since .Dc7zOa_root is the CHAT ROOT (304x671 = 84.4%x100%), an opaque-white window there would cover
// the wallpaper in the centre column -> this is exactly the v1.32.6 class of bug, but TRANSIENT.
//
// This probe hunts that window with a fast poll (120ms) + immediate screencap, while scrolling to
// provoke re-renders, and records which layers are in the "un-injected/native" state at that instant.
// usage: node qa-dcroot-transient.mjs <url> <outdir> <expectedSha>
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const ADB = "G:\\Android\\Sdk\\platform-tools\\adb.exe";
const URL = process.argv[2];
const OUTDIR = process.argv[3] || "G:\\Android\\qa-cb";
const EXPECTED = (process.argv[4] || "").trim().toLowerCase();
const PORT = "9238";
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
let ws = null, id = 0, pend = new Map();
function send(m, p = {}) {
  const i = ++id;
  return new Promise((res, rej) => { pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); setTimeout(() => { if (pend.delete(i)) rej(new Error("timeout")); }, 20000); });
}
async function ev(x) {
  const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r && r.exceptionDetails) throw new Error("JS");
  return r && r.result ? r.result.value : undefined;
}
async function evJ(x) { const v = await ev(x); try { return JSON.parse(v); } catch { return { raw: v }; } }
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
// fast detector: is dcRoot in a "native white / un-injected" state right now, and what else is too?
const HUNT = `(()=>{const RGXS=${RGX};
  const dc=document.querySelector("[class*='Dc7zOa_root']");
  if(!dc)return JSON.stringify({found:false});
  const cs=getComputedStyle(dc);const m=RGXS.exec(cs.backgroundColor);
  const a=m?(m[4]===undefined?1:parseFloat(m[4])):null;
  const inline=dc.style.backgroundColor||'';
  const r=dc.getBoundingClientRect();
  // which injected layers currently lack an inline bg (i.e. were wiped / not yet processed)?
  const wiped=[];
  for(const e of document.querySelectorAll("[class*='BynINW_'],[class*='Dc7zOa_'],[class*='_tabHost'],[class*='md-code-block']")){
    if(e.offsetWidth<=0)continue;
    const ecs=getComputedStyle(e);const em=RGXS.exec(ecs.backgroundColor);
    const ea=em?(em[4]===undefined?1:parseFloat(em[4])):null;
    if(!e.style.backgroundColor&&ea===1&&em&&!(+em[1]===0&&+em[2]===0&&+em[3]===0)){
      wiped.push({cls:(e.className||'').toString().slice(0,44),bg:ecs.backgroundColor,w:e.offsetWidth,h:e.offsetHeight});}
  }
  return JSON.stringify({found:true,alpha:a,bg:cs.backgroundColor,inline,
    w:Math.round(r.width),h:Math.round(r.height),
    nativeWhite:(a===1&&inline===''),wipedCount:wiped.length,wiped:wiped.slice(0,8)});})()`;
function shot(name) {
  try {
    adb(["shell", "screencap", "-p", `/sdcard/${name}.png`]);
    adb(["pull", `/sdcard/${name}.png`, `${OUTDIR}\\${name}.png`]);
    const st = fs.statSync(`${OUTDIR}\\${name}.png`);
    console.log("SHOT " + name + " bytes=" + st.size);
    return { name, bytes: st.size, ok: st.size > 100000 };
  } catch (e) { return { name, bytes: 0, ok: false }; }
}
(async () => {
  const out = { startedAt: new Date().toISOString(), hunt: [], caughts: [], windows: [] };
  try {
    out.apkShaBefore = apkSha();
    console.log("APK_SHA_BEFORE " + out.apkShaBefore);
    if (EXPECTED && out.apkShaBefore.toLowerCase() !== EXPECTED) throw new Error("BLOCKED: sha mismatch");
    console.log("APK_SHA_MATCH ok");
    try { adb(["shell", "am", "force-stop", "xyz.cpyh.dshpush"]); } catch { }
    await sleep(1200);
    adb(["shell", "am", "start", "-n", "xyz.cpyh.dshpush/.WebActivity", "--es", "url", URL]);
    await connect();
    for (let i = 0; i < 20; i++) { if (await ev("(!!document.querySelector(\"[class*='BynINW_frame']\"))")) break; await sleep(2000); }

    // Hunt: poll fast while provoking re-renders by scrolling the chat, then capture on detection.
    let caught = 0, sawNativeWhite = 0;
    for (let i = 0; i < 220 && caught < 2; i++) {
      // provoke a re-render every few iterations
      if (i % 8 === 3) {
        try { await ev(`(()=>{const c=[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+8);
          const sc=c.sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight))[0];
          if(sc)sc.scrollTop=Math.max(0,sc.scrollHeight*(${0.3 + (i % 50) / 100}));})()`); } catch (e) { }
      }
      let s = null;
      try { s = await evJ(HUNT); } catch (e) { s = null; }
      if (s && s.found) {
        sawNativeWhite += s.nativeWhite ? 1 : 0;
        if (s.nativeWhite) {
          console.log("HUNT native-white alpha=" + s.alpha + " inline='' wiped=" + s.wipedCount + " size=" + s.w + "x" + s.h);
          const sh = shot("qa-C14-dcroot-nativewhite-" + (caught + 1));
          out.caughts.push({ snapshot: s, shot: sh });
          caught++;
          await sleep(600);
          continue;
        }
      }
      await sleep(120);
    }
    out.sawNativeWhiteSamples = sawNativeWhite;
    out.caughtCount = caught;
    console.log("HUNT_DONE caught=" + caught + " nativeWhiteSamples=" + sawNativeWhite);
    // final settled reading + screenshot with the app provably alive
    await sleep(4500);
    out.settled = await evJ(HUNT);
    out.shellAlive = !!(await ev("(!!document.querySelector(\"[class*='BynINW_frame']\"))"));
    out.settledShot = shot("qa-C14-dcroot-settled");
    console.log("SETTLED alpha=" + (out.settled.alpha) + " inline='" + out.settled.inline + "' wiped=" + out.settled.wipedCount + " alive=" + out.shellAlive);
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
    fs.writeFileSync(`${OUTDIR}\\transient-report.json`, JSON.stringify(out, null, 2), "utf8");
    console.log("REPORT " + OUTDIR + "\\transient-report.json");
    process.exit(0);
  }
})();
