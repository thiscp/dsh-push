// qa-dcroot-settle.mjs - task-13 follow-up requested by lead (2026-10-15).
// WHY: in cb-report.json, rounds R1/R2 read `Dc7zOa_root` = alpha 1 / rgb(255,255,255) / inline EMPTY,
// while R3-R5 read rgba(0,0,0,0) / inline "transparent". An EMPTY inline means the glass injection had
// not yet processed that layer -> we were reading its NATIVE value (the chat root is natively white).
// That is a MEASUREMENT-TIMING question, not necessarily a regression. But if it is still alpha 1
// AFTER the injection settles, it IS a real v1.32.6 regression (opaque chat root => wallpaper covered).
//
// This probe answers, with a timeline:
//   1. poll dcRoot (computed + inline) every 500ms from app start; detect the moment inline flips to
//      "transparent" (that is the injection settling) and report the settled value;
//   2. log an injection-progress proxy (how many elements carry an inline background-color) so we can
//      say whether R1/R2 was read BEFORE settle;
//   3. full-page screenshot in the settled state (wallpaper visibility = the FINAL v1.32.6 criterion);
//   4. re-measure the big/small code blocks in the SAME settled state;
//   5. attempt a chat scroll-to-bottom with a broader selector.
// usage: node qa-dcroot-settle.mjs <url> <outdir> <expectedSha>
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const ADB = "G:\\Android\\Sdk\\platform-tools\\adb.exe";
const URL = process.argv[2];
const OUTDIR = process.argv[3] || "G:\\Android\\qa-cb";
const EXPECTED = (process.argv[4] || "").trim().toLowerCase();
const PORT = "9237";
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
// one snapshot: dcRoot + the three other channels + an injection-progress proxy
const SNAP = `(()=>{const RGXS=${RGX};
  const g=(sel)=>{const e=document.querySelector(sel);if(!e)return null;const cs=getComputedStyle(e);const m=RGXS.exec(cs.backgroundColor);
    return {bg:cs.backgroundColor,alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,inline:e.style.backgroundColor||'',
      prio:e.style.getPropertyPriority('background-color')||''};};
  // injection progress: how many elements carry ANY inline background-color
  let touched=0, trans=0;
  for(const e of document.querySelectorAll('div,main,section,header,aside,nav,button,textarea,input,ul,li')){
    if(e.style.backgroundColor){touched++; if(/transparent/.test(e.style.backgroundColor))trans++;}
  }
  return JSON.stringify({dcRoot:g("[class*='Dc7zOa_root']"),frame:g("[class*='BynINW_frame']"),
    centerCol:g("[class*='BynINW_centerCol']"),body:g("body"),veil:g("#dsh-theme-veil"),
    touched:touched,transparentCount:trans,shell:!!document.querySelector("[class*='BynINW_frame']")});})()`;
const CB = `(()=>{const RGXS=${RGX};const out=[];
  for(const e of document.querySelectorAll("[class*='md-code-block']")){
    if(e.offsetWidth<=0)continue;
    const cs=getComputedStyle(e);const m=RGXS.exec(cs.backgroundColor);const r=e.getBoundingClientRect();
    out.push({alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,bg:cs.backgroundColor,w:Math.round(r.width),h:Math.round(r.height),
      overHalf:(r.width>window.innerWidth*0.5&&r.height>window.innerHeight*0.5),inline:e.style.backgroundColor||''});}
  out.sort((a,b)=>(b.w*b.h)-(a.w*a.h));
  const big=out.filter(b=>b.overHalf),small=out.filter(b=>!b.overHalf);
  return JSON.stringify({total:out.length,big,small,bigAlphas:[...new Set(big.map(b=>b.alpha))],smallAlphas:[...new Set(small.map(b=>b.alpha))]});})()`;
const SCROLL = `(()=>{const cands=[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+8);
  const sc=cands.sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight))[0];
  if(!sc)return JSON.stringify({ok:false,candCount:cands.length});
  const before=sc.scrollTop; sc.scrollTop=sc.scrollHeight;
  return JSON.stringify({ok:true,moved:sc.scrollTop>before,before,after:sc.scrollTop,
    scrollHeight:sc.scrollHeight,clientHeight:sc.clientHeight,cls:(sc.className||'').toString().slice(0,50)});})()`;
(async () => {
  const out = { startedAt: new Date().toISOString(), timeline: [] };
  try {
    out.apkShaBefore = apkSha();
    console.log("APK_SHA_BEFORE " + out.apkShaBefore);
    if (EXPECTED && out.apkShaBefore.toLowerCase() !== EXPECTED) throw new Error("BLOCKED: sha mismatch");
    console.log("APK_SHA_MATCH ok");
    try { adb(["shell", "am", "force-stop", "xyz.cpyh.dshpush"]); } catch { }
    await sleep(1200);
    const t0 = Date.now();
    adb(["shell", "am", "start", "-n", "xyz.cpyh.dshpush/.WebActivity", "--es", "url", URL]);
    await connect();
    // ---- poll until the injection settles (dcRoot inline becomes "transparent") or 45s elapse
    let settledAt = null, prev = null;
    for (let i = 0; i < 90; i++) {
      let s = null;
      try { s = await evJ(SNAP); } catch (e) { s = null; }
      if (s && s.shell) {
        const ms = Date.now() - t0;
        const inline = s.dcRoot ? s.dcRoot.inline : "";
        out.timeline.push({ ms, dcRoot: s.dcRoot ? { bg: s.dcRoot.bg, alpha: s.dcRoot.alpha, inline } : null,
          frame: s.frame ? s.frame.bg : null, veil: s.veil ? s.veil.alpha : null,
          touched: s.touched, transparentCount: s.transparentCount });
        if (i < 6 || i % 6 === 0 || (inline === "transparent" && prev !== "transparent")) {
          console.log("t=" + ms + "ms dcRoot alpha=" + (s.dcRoot ? s.dcRoot.alpha : "n/a") +
            " inline='" + inline + "' frame=" + (s.frame ? s.frame.bg : "n/a") +
            " veil=" + (s.veil ? s.veil.alpha : "n/a") + " touched=" + s.touched + " transp=" + s.transparentCount);
        }
        if (inline === "transparent" && settledAt === null) { settledAt = ms; }
        prev = inline;
        // once settled, keep polling a couple more times to prove stability, then stop
        if (settledAt !== null && i > 0 && ms - settledAt > 3000) break;
      }
      await sleep(500);
    }
    out.settledAtMs = settledAt;
    console.log("SETTLED_AT " + settledAt + "ms");
    // ---- settled-state measurements
    await sleep(4500);  // past apply()'s 4s re-run
    out.settled = await evJ(SNAP);
    out.settledCB = await evJ(CB);
    out.scroll = await evJ(SCROLL);
    console.log("SETTLED dcRoot=" + (out.settled.dcRoot ? out.settled.dcRoot.bg + "/a" + out.settled.dcRoot.alpha + " inline='" + out.settled.dcRoot.inline + "'" : "n/a") +
      " frame=" + (out.settled.frame ? out.settled.frame.bg : "n/a") +
      " centerCol=" + (out.settled.centerCol ? out.settled.centerCol.bg : "n/a") +
      " body=" + (out.settled.body ? out.settled.body.bg : "n/a") +
      " veil=" + (out.settled.veil ? out.settled.veil.alpha : "n/a") +
      " | bigAlphas=" + JSON.stringify(out.settledCB.bigAlphas) + " smallAlphas=" + JSON.stringify(out.settledCB.smallAlphas));
    console.log("SCROLL " + JSON.stringify(out.scroll));
    // ---- several more settled reads to prove stability (this is the "after settle" answer)
    out.settledRepeats = [];
    for (let i = 0; i < 5; i++) {
      await sleep(1000);
      const s = await evJ(SNAP);
      out.settledRepeats.push(s.dcRoot ? { bg: s.dcRoot.bg, alpha: s.dcRoot.alpha, inline: s.dcRoot.inline } : null);
    }
    console.log("SETTLED_REPEATS " + JSON.stringify(out.settledRepeats));
    out.shot = shot("qa-C14-settled-chat");
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
    fs.writeFileSync(`${OUTDIR}\\settle-report.json`, JSON.stringify(out, null, 2), "utf8");
    console.log("REPORT " + OUTDIR + "\\settle-report.json");
    process.exit(0);
  }
})();
