// qa-wouldchange.mjs - task-15 item 1: re-run the `wouldChange` check on v1.32.14.
//
// WHY: v1.32.14 added `Dc7zOa_root` to `isAnchor` (commit 083de4f), which excludes that LAYOUT
// container from BOTH the "read native hue and write it back" path and the `isCB` content-block
// judge. The risk of an exclusion is always the same: did it also weaken the real fix?
//
// The check mirrors ANALYSIS-v1.32.12 sec 2.5 (which measured `wouldChange = 1` = exactly the
// `_tabHost` reading-panel layer, i.e. the only element whose background the panel branch changes):
//   * enumerate every big container (w>vw/2 && h>vh/2) in the PANEL-OPEN state
//   * record native bg (read by temporarily removing the inline, then restoring + asserting restore)
//   * record the CURRENT computed bg/alpha/inline
//   * classify: opaquePanel (alpha==1 and it is the reading panel), anchored (must stay transparent)
// `wouldChange` = how many big containers the panel branch actually turned opaque. Expect 1 (_tabHost).
// Dc7zOa_root MUST be transparent now (that is the FINDING-1 fix).
//
// usage: node qa-wouldchange.mjs <url> <outdir> <expectedSha>
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const ADB = "G:\\Android\\Sdk\\platform-tools\\adb.exe";
const URL = process.argv[2];
const OUTDIR = process.argv[3] || "G:\\Android\\qa-wc";
const EXPECTED = (process.argv[4] || "").trim().toLowerCase();
const PORT = "9239";
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
// enumerate all BIG containers with native + current background; classify the branch outcome
const WC = `(()=>{const RGXS=${RGX};
  const vw=window.innerWidth,vh=window.innerHeight;
  const out=[];
  for(const e of document.querySelectorAll('div,main,section,header,aside,nav')){
    const r=e.getBoundingClientRect();
    if(r.width<=vw*0.5||r.height<=vh*0.5)continue;      // big-container branch only
    if(e.offsetWidth<=0)continue;
    const cs=getComputedStyle(e);const m=RGXS.exec(cs.backgroundColor);
    const cur=m?{bg:cs.backgroundColor,alpha:(m[4]===undefined?1:parseFloat(m[4])),rgb:[+m[1],+m[2],+m[3]]}:null;
    const cls=(e.className||'').toString();
    // native: temporarily drop the inline background-color, read, then restore
    const inlineBefore=e.style.backgroundColor;
    const prioBefore=e.style.getPropertyPriority('background-color');
    let native=null,restoreOk=null;
    try{
      e.style.removeProperty('background-color');
      const nc=getComputedStyle(e);const nm=RGXS.exec(nc.backgroundColor);
      native=nm?{bg:nc.backgroundColor,alpha:(nm[4]===undefined?1:parseFloat(nm[4])),rgb:[+nm[1],+nm[2],+nm[3]]}:null;
      if(inlineBefore)e.style.setProperty('background-color',inlineBefore,prioBefore||'important');
      restoreOk=((e.style.backgroundColor||'')===inlineBefore);
    }catch(err){restoreOk=false;}
    const isAnchor=/BynINW_/.test(cls)||/_2H3hWW_root/.test(cls)||/Dc7zOa_root/.test(cls);
    const isTabHost=/_tabHost/.test(cls);
    const isCodeBlock=/md-code-block/.test(cls);
    out.push({cls:cls.slice(0,80),w:Math.round(r.width),h:Math.round(r.height),
      cur,native,inline:inlineBefore||'',prio:prioBefore||'',restoreOk,
      isAnchor,isTabHost,isCodeBlock});
  }
  // wouldChange = big containers the panel branch actually turned OPAQUE (alpha==1)
  const opaque=out.filter(o=>o.cur&&o.cur.alpha===1);
  const transparent=out.filter(o=>o.cur&&o.cur.alpha===0);
  const anchors=out.filter(o=>o.isAnchor);
  return JSON.stringify({vw,vh,bigTotal:out.length,
    wouldChange:opaque.length,
    opaqueList:opaque.map(o=>({cls:o.cls,alpha:o.cur.alpha,bg:o.cur.bg,isTabHost:o.isTabHost,isCodeBlock:o.isCodeBlock,isAnchor:o.isAnchor})),
    transparentCount:transparent.length,
    anchorStates:anchors.map(o=>({cls:o.cls,alpha:o.cur.alpha,bg:o.cur.bg,nativeAlpha:o.native?o.native.alpha:null,inline:o.inline})),
    dcRoot:(out.find(o=>/Dc7zOa_root/.test(o.cls))||null),
    detail:out});})()`;
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
    await sleep(5000);  // let the injection settle before judging steady state

    // --- closed state (no reading panel)
    out.closed = await evJ(WC);
    console.log("CLOSED  bigTotal=" + out.closed.bigTotal + " wouldChange=" + out.closed.wouldChange +
      " dcRootAlpha=" + (out.closed.dcRoot ? out.closed.dcRoot.cur.alpha : "n/a"));
    // --- open the reading panel (the state where the panel branch matters)
    const tg = await evJ(`(()=>{const o=[];
      for(const e of document.querySelectorAll('a,button,[role=button]')){
        const t=((e.textContent||'')+' '+(e.getAttribute&&(e.getAttribute('title')||'')||'')).toLowerCase();
        if(t.indexOf('.md')>=0||t.indexOf('markdown')>=0){const r=e.getBoundingClientRect();
          if(r.width>0&&r.height>0)o.push({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});}}
      return JSON.stringify(o.slice(0,4));})()`);
    let opened = false;
    for (const t of (Array.isArray(tg) ? tg : [])) {
      await ev(`(()=>{const all=[...document.querySelectorAll('a,button,[role=button]')];
        const e=all.find(x=>{const r=x.getBoundingClientRect();return Math.round(r.left+r.width/2)===${t.x}&&Math.round(r.top+r.height/2)===${t.y};});
        if(e){const c=e.closest('button,a,[role=button]')||e;c.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));}})()`);
      await sleep(2200);
      const p = await evJ(`(()=>{const l=[...document.querySelectorAll("[class*='_tabHost']")].filter(e=>e.offsetWidth>0).sort((a,b)=>(b.offsetWidth*b.offsetHeight)-(a.offsetWidth*a.offsetHeight))[0];
        if(!l)return JSON.stringify({open:false});return JSON.stringify({open:true,w:l.offsetWidth,h:l.offsetHeight});})()`);
      if (p.open && p.w > 300) { opened = true; break; }
    }
    await sleep(4500);   // settle past apply()'s 4s re-run
    out.panelOpen = { opened, wc: await evJ(WC) };
    const wc = out.panelOpen.wc;
    console.log("PANEL_OPEN bigTotal=" + wc.bigTotal + " wouldChange=" + wc.wouldChange);
    console.log("  opaqueList=" + JSON.stringify(wc.opaqueList));
    console.log("  anchorStates=" + JSON.stringify(wc.anchorStates));
    console.log("  dcRoot alpha=" + (wc.dcRoot ? wc.dcRoot.cur.alpha : "n/a") + " bg=" + (wc.dcRoot ? wc.dcRoot.cur.bg : "n/a") +
      " nativeAlpha=" + (wc.dcRoot && wc.dcRoot.native ? wc.dcRoot.native.alpha : "n/a") + " inline='" + (wc.dcRoot ? wc.dcRoot.inline : "") + "'");
    out.shot = shot("qa-C16-wouldchange-panelopen");
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
    fs.writeFileSync(`${OUTDIR}\\wouldchange-report.json`, JSON.stringify(out, null, 2), "utf8");
    console.log("REPORT " + OUTDIR + "\\wouldchange-report.json");
    process.exit(0);
  }
})();
