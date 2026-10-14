// qa-codeblock.mjs - task-13: v1.32.13 large-code-block opacity verification.
//
// Verifies the fix for the KNOWN LEFTOVER registered in v1.32.12: the chat's large code block
// (`_block_7gxqk_4` / `md-code-block`, ~331x524, native rgb(249,250,251)) was being CRUSHED to
// `transparent` (alpha=0) -> code text bled through the chat text behind it.
// Expected AFTER the fix: alpha = 1.0 (opaque, native hue preserved).
//
// TWO BAD STATES must both be observed (the fix must repair both):
//   A) `transparent`  -- full-height element that hit the big-container branch
//   B) `0.45`         -- element processed while still short, then grew; frozen by the idempotence gate
// And the 8 SHORT code blocks (heights ~87..296, i.e. NOT >50% viewport) must STAY 0.45 --
// that is by-design behaviour, a failure would be them being wrongly bumped to 1.0.
//
// Five red lines (all measured, never inferred):
//   1. BynINW_frame / BynINW_centerCol / Dc7zOa_root / html / body stay rgba(0,0,0,0) + wallpaper visible
//   2. `_tabHost` (reading panel) still 1.0
//   3. real menu (role=listbox) still 0.96 ; #dsh-theme-veil still 0.45 (measured value required)
//   4. sidebar expanded 0.92 / collapsed 0.45
//   5. RlGAzG_card still 0.45
//
// Probe traps already paid for (README / TESTER.md):
//   * multi-match classes: ALWAYS scan all and take max area ([class*='_tabHost'] had 6 matches)
//   * screenshot path HARDCODED (an optional argv slot silently skips screencap)
//   * connect() bounded retry (devtools socket appears ~25s after a cold start)
//   * hash BRACKET: read before AND after; mismatch = fail-closed, refuse to sample
//   * re-run `pm path` every time (the parent dir changed in v1.32.12)
//   * full-page visual verdict must assert the app process is alive
//
// usage: node qa-codeblock.mjs <dsh-web-url> <outdir> <expectedApkSha> [rounds]
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const ADB = "G:\\Android\\Sdk\\platform-tools\\adb.exe";
const URL = process.argv[2];
const OUTDIR = process.argv[3] || "G:\\Android\\qa-cb";
const EXPECTED = (process.argv[4] || "").trim().toLowerCase();
const ROUNDS = parseInt(process.argv[5] || "5", 10);
const PORT = "9235";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RGX = "/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/";

fs.mkdirSync(OUTDIR, { recursive: true });
function adb(a, o = {}) { return execFileSync(ADB, a, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 60000, ...o }); }
function whoami() { try { return String(adb(["shell", "whoami"]) || "").trim(); } catch { return "ERR"; } }
function pidofApp() {
  try { return String(adb(["shell", "pidof", "xyz.cpyh.dshpush"]) || "").trim(); }
  catch (e) { const s = String((e && (e.stdout || e.message)) || ""); return /^\s*\d/.test(s) ? s.trim() : ""; }
}
// always re-resolve: the apk parent dir can change between installs
function apkPath() { try { return String(adb(["shell", "pm", "path", "xyz.cpyh.dshpush"]) || "").trim().replace(/^package:/, "").trim(); } catch { return ""; } }
function apkSha() {
  try {
    const p = apkPath();
    if (!p) return "NO_PATH";
    const t = String(adb(["shell", "sha256sum", p]) || "").trim().split(/\s+/)[0];
    return /^[0-9a-f]{64}$/i.test(t) ? t : "UNPARSED";
  } catch { return "ERR"; }
}
async function requireRoot(tag) {
  let w = whoami();
  if (w === "root") { console.log("ADB_ROOT " + tag + " already=root"); return; }
  console.log("ADB_ROOT " + tag + " whoami=" + w + " -> adb root");
  try { adb(["root"]); } catch { }
  await sleep(3000);
  for (let i = 0; i < 20; i++) { w = whoami(); if (w === "root") { console.log("ADB_ROOT " + tag + " root after " + (i + 1)); return; } await sleep(1500); }
  throw new Error("BLOCKED: adbd not root (whoami=" + w + ")");
}
function shot(name) {
  const r = `/sdcard/${name}.png`;
  try {
    adb(["shell", "screencap", "-p", r]);
    adb(["pull", r, `${OUTDIR}\\${name}.png`]);
    const st = fs.statSync(`${OUTDIR}\\${name}.png`);
    const ok = st.size > 100000;
    console.log("SHOT " + name + " bytes=" + st.size + " ok=" + ok);
    return { name, bytes: st.size, ok };
  } catch (e) { console.log("SHOT " + name + " FAILED " + String(e && e.message).slice(0, 120)); return { name, bytes: 0, ok: false }; }
}
let ws = null, id = 0, pend = new Map();
function send(m, p = {}) {
  const i = ++id;
  return new Promise((res, rej) => { pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); setTimeout(() => { if (pend.delete(i)) rej(new Error("timeout " + m)); }, 25000); });
}
async function ev(x) {
  const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r && r.exceptionDetails) throw new Error("JS:" + JSON.stringify(r.exceptionDetails).slice(0, 200));
  return r && r.result ? r.result.value : undefined;
}
async function evJ(x) { const v = await ev(x); try { return JSON.parse(v); } catch { return { raw: v }; } }
async function clickAt(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
async function connect() {
  await requireRoot("connect");
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
      if (a > 1) console.log("CONNECT ok on attempt " + a);
      return pid;
    } catch (e) { last = e; if (a === 1 || a % 5 === 0) console.log("CONNECT retry " + a + ": " + String((e && e.message) || e).slice(0, 70)); await sleep(2500); }
  }
  throw new Error("connect failed: " + String((last && last.message) || last).slice(0, 120));
}
async function startFresh() {
  await requireRoot("startApp");
  try { adb(["shell", "am", "force-stop", "xyz.cpyh.dshpush"]); } catch { }
  await sleep(1500);
  adb(["shell", "am", "start", "-n", "xyz.cpyh.dshpush/.WebActivity", "--es", "url", URL]);
  await connect();
  for (let i = 0; i < 20; i++) { if (await ev("(!!document.querySelector(\"[class*='BynINW_frame']\"))")) return; await sleep(2500); }
  throw new Error("shell not ready");
}

// ---- in-page probes ----
// Enumerate EVERY code block, with computed alpha, geometry, inline value, and the NATIVE colour
// (read by temporarily removing the inline background-color, then restoring it -- restoreOk asserted).
const CODEBLOCKS = `(()=>{const RGXS=${RGX};
  const sel="[class*='_block_7gxqk'],[class*='md-code-block'],pre,code";
  const seen=new Set(); const out=[];
  for(const e of document.querySelectorAll(sel)){
    // only the OUTERMOST block that carries a class marker (pre/code nest inside)
    const marked=/md-code-block/.test((e.className||'').toString())||/_block_/.test((e.className||'').toString());
    if(!marked) continue;
    if(seen.has(e)) continue; seen.add(e);
    const cs=getComputedStyle(e);const m=RGXS.exec(cs.backgroundColor);
    const r=e.getBoundingClientRect();
    const inlineBefore=e.style.backgroundColor;
    let native=null,restoreOk=null;
    try{
      e.style.removeProperty('background-color');
      const nm=RGXS.exec(getComputedStyle(e).backgroundColor);
      native=nm?{bg:getComputedStyle(e).backgroundColor,alpha:(nm[4]===undefined?1:parseFloat(nm[4])),rgb:[+nm[1],+nm[2],+nm[3]]}:null;
      if(inlineBefore)e.style.setProperty('background-color',inlineBefore,(e.style.getPropertyPriority('background-color')||'important'));
      restoreOk=((e.style.backgroundColor||'')===inlineBefore);
    }catch(err){native={err:String(err).slice(0,60)};restoreOk=false;}
    out.push({tag:e.tagName,cls:(e.className||'').toString().slice(0,70),
      alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,bg:cs.backgroundColor,
      inline:inlineBefore||'',prio:e.style.getPropertyPriority('background-color')||'',
      x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),
      pctW:Math.round(100*r.width/window.innerWidth),pctH:Math.round(100*r.height/window.innerHeight),
      overHalf:(r.width>window.innerWidth*0.5&&r.height>window.innerHeight*0.5),
      native,restoreOk,
      text:(e.textContent||'').trim().slice(0,40)});}
  out.sort((a,b)=>(b.w*b.h)-(a.w*a.h));
  return JSON.stringify({count:out.length,blocks:out,vw:window.innerWidth,vh:window.innerHeight});})()`;

const REDLINES = `(()=>{const RGXS=${RGX};
  const g=(sel)=>{const e=document.querySelector(sel);if(!e)return null;const cs=getComputedStyle(e);const m=RGXS.exec(cs.backgroundColor);
    const r=e.getBoundingClientRect();
    return {cls:(e.className||'').toString().slice(0,70),id:e.id||'',bg:cs.backgroundColor,
      alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,w:Math.round(r.width),h:Math.round(r.height),inline:e.style.backgroundColor||''};};
  const live=[...document.querySelectorAll("[class*='_tabHost']")].filter(e=>e.offsetWidth>0&&e.offsetHeight>0)
    .sort((a,b)=>(b.offsetWidth*b.offsetHeight)-(a.offsetWidth*a.offsetHeight));
  let tab=null;
  if(live[0]){const cs=getComputedStyle(live[0]);const m=RGXS.exec(cs.backgroundColor);
    tab={cls:(live[0].className||'').toString().slice(0,60),bg:cs.backgroundColor,alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,
      w:live[0].offsetWidth,h:live[0].offsetHeight,inline:live[0].style.backgroundColor||''};}
  const sbs=[...document.querySelectorAll("[class*='_2H3hWW_root']")].sort((a,b)=>b.offsetWidth-a.offsetWidth)[0];
  let sb=null;
  if(sbs){const m=RGXS.exec(getComputedStyle(sbs).backgroundColor);
    sb={cls:(sbs.className||'').toString().slice(0,60),collapsed:(sbs.className||'').toString().indexOf('_2H3hWW_collapsed')>=0,
      w:+sbs.getBoundingClientRect().width.toFixed(1),alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,bg:getComputedStyle(sbs).backgroundColor};}
  return JSON.stringify({frame:g("[class*='BynINW_frame']"),centerCol:g("[class*='BynINW_centerCol']"),
    dcRoot:g("[class*='Dc7zOa_root']"),html:g("html"),body:g("body"),veil:g("#dsh-theme-veil"),
    card:g("[class*='RlGAzG_card']"),tabHost:tab,sidebar:sb});})()`;

// other content blocks (tables / quotes / images) -- report alpha as-is, annotate unfixed ones
const OTHERBLOCKS = `(()=>{const RGXS=${RGX};
  const sels={table:"table",blockquote:"blockquote",img:"img[class],img",
    mdTable:"[class*='md-table'],[class*='_table_']",quote:"[class*='md-quote'],[class*='_quote_']",
    codeBlockShort:"[class*='md-code-block']"};
  const o={};
  for(const k in sels){const e=document.querySelector(sels[k]);
    if(!e){o[k]={present:false};continue;}
    const cs=getComputedStyle(e);const m=RGXS.exec(cs.backgroundColor);const r=e.getBoundingClientRect();
    o[k]={present:true,cls:(e.className||'').toString().slice(0,60),bg:cs.backgroundColor,
      alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,w:Math.round(r.width),h:Math.round(r.height)};}
  return JSON.stringify(o);})()`;

const MENU = `(()=>{const lb=document.querySelector('[role=listbox]');window.__qaOverlay=lb;
  if(!lb)return JSON.stringify({found:false});
  const cs=getComputedStyle(lb);const m=${RGX}.exec(cs.backgroundColor);const r=lb.getBoundingClientRect();
  return JSON.stringify({found:true,alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,bg:cs.backgroundColor,
    w:Math.round(r.width),h:Math.round(r.height),items:[...lb.querySelectorAll('[role=option]')].filter(b=>b.offsetHeight>0).length});})()`;

// chat scroll to bottom, and code-block horizontal scroller check
const CHATSCROLL = `(()=>{const all=[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+8&&e.clientHeight>200);
  const sc=all.sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight))[0];
  if(!sc)return JSON.stringify({ok:false});
  const before=sc.scrollTop; sc.scrollTop=sc.scrollHeight;
  return JSON.stringify({ok:true,moved:sc.scrollTop>before,scrollTopBefore:before,scrollTopAfter:sc.scrollTop,
    scrollHeight:sc.scrollHeight,clientHeight:sc.clientHeight,cls:(sc.className||'').toString().slice(0,50)});})()`;

const CODEHSCROLL = `(()=>{const RGXS=${RGX};
  const cbs=[...document.querySelectorAll("[class*='md-code-block'],[class*='_block_']")].filter(e=>e.offsetWidth>0);
  const out=[];
  for(const cb of cbs.slice(0,4)){
    const inner=[...cb.querySelectorAll('*')].filter(e=>e.scrollWidth>e.clientWidth+4)
      .sort((a,b)=>(b.scrollWidth-b.clientWidth)-(a.scrollWidth-a.clientWidth))[0];
    if(!inner){out.push({cls:(cb.className||'').toString().slice(0,40),hScrollable:false});continue;}
    const before=inner.scrollLeft; inner.scrollLeft=inner.scrollWidth;
    out.push({cls:(cb.className||'').toString().slice(0,40),hScrollable:true,innerCls:(inner.className||'').toString().slice(0,40),
      moved:inner.scrollLeft>before,scrollWidth:inner.scrollWidth,clientWidth:inner.clientWidth});}
  return JSON.stringify(out);})()`;

// A31 adversarial (new angle): MANY code blocks co-resident + the SMALL ones must stay 0.45
const A31 = `(()=>{const RGXS=${RGX};
  const cbs=[...document.querySelectorAll("[class*='md-code-block']")].filter(e=>e.offsetWidth>0);
  const rows=cbs.map(e=>{const cs=getComputedStyle(e);const m=RGXS.exec(cs.backgroundColor);const r=e.getBoundingClientRect();
    return {h:Math.round(r.height),w:Math.round(r.width),alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,
      overHalf:(r.height>window.innerHeight*0.5)};});
  const big=rows.filter(r=>r.overHalf&&r.w>window.innerWidth*0.5);
  const small=rows.filter(r=>!(r.overHalf&&r.w>window.innerWidth*0.5));
  return JSON.stringify({total:rows.length,bigCount:big.length,smallCount:small.length,
    bigAlphas:[...new Set(big.map(r=>r.alpha))],smallAlphas:[...new Set(small.map(r=>r.alpha))],
    smallHeights:small.map(r=>r.h),bigSizes:big.map(r=>r.w+"x"+r.h)});})()`;

(async () => {
  const out = { startedAt: new Date().toISOString(), url: URL.replace(/token=[^&]+/, "token=<redacted>"),
    expectedSha: EXPECTED || "(not asserted)", rounds: [], shots: [] };
  try {
    console.log("WHOAMI " + whoami());
    out.versionName = (adb(["shell", "dumpsys", "package", "xyz.cpyh.dshpush"]).split(/\r?\n/).find((l) => l.includes("versionName=")) || "").trim();
    out.versionCode = (adb(["shell", "dumpsys", "package", "xyz.cpyh.dshpush"]).split(/\r?\n/).find((l) => l.includes("versionCode=")) || "").trim();
    console.log("VERSION " + out.versionName + " | " + out.versionCode);
    out.apkPath = apkPath();
    out.apkShaBefore = apkSha();
    console.log("APK_SHA_BEFORE " + out.apkShaBefore);
    if (EXPECTED && out.apkShaBefore.toLowerCase() !== EXPECTED) {
      throw new Error("BLOCKED: installed sha " + out.apkShaBefore + " != expected " + EXPECTED + " - refusing to sample");
    }
    if (EXPECTED) console.log("APK_SHA_MATCH ok (build frozen)");

    // ---------- pure chat state: N independent rounds
    for (let r = 1; r <= ROUNDS; r++) {
      await startFresh();
      if (r === 1) {
        out.viewport = { w: await ev("innerWidth"), h: await ev("innerHeight"), dpr: await ev("devicePixelRatio") };
        console.log("VIEWPORT " + JSON.stringify(out.viewport));
        out.chatScroll = await evJ(CHATSCROLL);
        console.log("CHAT_SCROLL " + JSON.stringify(out.chatScroll));
      }
      // scroll through the chat so code blocks are laid out, then let apply() settle (runs at 0/1.5/4s)
      await ev(`(()=>{const all=[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+8&&e.clientHeight>200);
        const sc=all.sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight))[0];
        if(sc)sc.scrollTop=sc.scrollHeight*0.55;})()`);
      await sleep(1500);
      await ev(`(()=>{const all=[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+8&&e.clientHeight>200);
        const sc=all.sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight))[0];
        if(sc)sc.scrollTop=sc.scrollHeight*0.9;})()`);
      await sleep(4500);   // past apply()'s 4s re-run so we judge the settled state
      const cb = await evJ(CODEBLOCKS);
      const rec = { round: r, chat: cb, redlines: await evJ(REDLINES) };
      const big = (cb.blocks || []).filter((b) => b.overHalf);
      const small = (cb.blocks || []).filter((b) => !b.overHalf);
      console.log("R" + r + " chat: total=" + cb.count + " big=" + big.length + "(alpha " + [...new Set(big.map((b) => b.alpha))] + ")" +
        " small=" + small.length + "(alpha " + [...new Set(small.map((b) => b.alpha))] + ")" +
        " | frame=" + (rec.redlines.frame ? rec.redlines.frame.bg : "n/a") +
        " veil=" + (rec.redlines.veil ? rec.redlines.veil.alpha : "n/a") +
        " card=" + (rec.redlines.card ? rec.redlines.card.alpha : "n/a") +
        " tabHost=" + (rec.redlines.tabHost ? rec.redlines.tabHost.alpha : "n/a"));
      if (r === 1) {
        out.chatFirst = { big, small, otherBlocks: await evJ(OTHERBLOCKS), hs: await evJ(CODEHSCROLL), a31: await evJ(A31) };
        console.log("A31 " + JSON.stringify(out.chatFirst.a31));
        console.log("OTHER " + JSON.stringify(out.chatFirst.otherBlocks).slice(0, 300));
        out.shots.push(shot("qa-C14-codeblock-chat"));
        out.chatShellAlive = !!(await ev("(!!document.querySelector(\"[class*='BynINW_frame']\"))"));
        out.chatPid = pidofApp();
      }
      out.rounds.push(rec);
    }
    out.chatRedlines = out.rounds[0] ? out.rounds[0].redlines : null;

    // ---------- with the reading panel OPEN (v1.32.12 measured a different code-block state)
    const tg = await evJ(`(()=>{const out=[];
      for(const e of document.querySelectorAll('a,button,[role=button]')){
        const t=((e.textContent||'')+' '+(e.getAttribute&&(e.getAttribute('title')||'')||'')).toLowerCase();
        if(t.indexOf('.md')>=0||t.indexOf('markdown')>=0){const r=e.getBoundingClientRect();
          if(r.width>0&&r.height>0)out.push({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});}}
      return JSON.stringify(out.slice(0,4));})()`);
    let panelOpened = false;
    for (const t of (Array.isArray(tg) ? tg : [])) {
      await ev(`(()=>{const all=[...document.querySelectorAll('a,button,[role=button]')];
        const e=all.find(x=>{const r=x.getBoundingClientRect();return Math.round(r.left+r.width/2)===${t.x}&&Math.round(r.top+r.height/2)===${t.y};});
        if(e){const c=e.closest('button,a,[role=button]')||e;c.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));}})()`);
      await sleep(2000);
      const rl = await evJ(REDLINES);
      if (rl.tabHost && rl.tabHost.alpha === 1 && rl.tabHost.w > 300) { panelOpened = true; break; }
    }
    out.panelOpen = { opened: panelOpened };
    if (panelOpened) {
      out.panelOpen.codeblocks = await evJ(CODEBLOCKS);
      out.panelOpen.redlines = await evJ(REDLINES);
      out.panelOpen.otherBlocks = await evJ(OTHERBLOCKS);
      const big = (out.panelOpen.codeblocks.blocks || []).filter((b) => b.overHalf);
      const small = (out.panelOpen.codeblocks.blocks || []).filter((b) => !b.overHalf);
      console.log("PANEL_OPEN panel=" + out.panelOpen.redlines.tabHost.alpha +
        " bigAlphas=" + [...new Set(big.map((b) => b.alpha))] + " smallAlphas=" + [...new Set(small.map((b) => b.alpha))] +
        " frame=" + out.panelOpen.redlines.frame.bg + " veil=" + out.panelOpen.redlines.veil.alpha);
      out.shots.push(shot("qa-C14-panel-open-codeblock"));
      out.panelShellAlive = !!(await ev("(!!document.querySelector(\"[class*='BynINW_frame']\"))"));
      out.panelPid = pidofApp();
      // close the panel again
      for (let i = 0; i < 3; i++) {
        const c = await evJ(`(()=>{const e=[...document.querySelectorAll("[class*='_tabClose']")].filter(x=>x.offsetWidth>0)[0];
          if(!e)return JSON.stringify({ok:false});const r=e.getBoundingClientRect();
          return JSON.stringify({ok:true,x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`);
        if (!c.ok) break;
        await clickAt(c.x, c.y); await sleep(1300);
      }
      const after = await evJ(REDLINES);
      out.afterClosePanel = { tabHost: after.tabHost, frame: after.frame, veil: after.veil };
      console.log("AFTER_CLOSE tabHost=" + (after.tabHost ? after.tabHost.alpha : "n/a") + " frame=" + (after.frame ? after.frame.bg : "n/a"));
      out.shots.push(shot("qa-C14-panel-closed-wallpaper"));
    }

    // ---------- slash menu + sidebar (regression guards)
    try {
      await ev(`(()=>{const c=[...document.querySelectorAll('textarea,[contenteditable=true]')].filter(e=>e.offsetHeight>0);const el=c[c.length-1];if(el)el.focus();})()`);
      await sleep(350);
      await send("Input.insertText", { text: "/" });
      await sleep(1600);
      out.menu = await evJ(MENU);
      console.log("MENU " + JSON.stringify(out.menu));
      out.shots.push(shot("qa-P11-menu-v13213"));
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await sleep(600);
    } catch (e) { out.menu = { error: String(e && e.message).slice(0, 120) }; }
    try {
      const sbState = (s) => ({ collapsed: s.sidebar ? s.sidebar.collapsed : null, alpha: s.sidebar ? s.sidebar.alpha : null, w: s.sidebar ? s.sidebar.w : null });
      const rl = await evJ(REDLINES);
      out.sidebarCollapsed = sbState(rl);
      await ev(`(()=>{const b=[...document.querySelectorAll('button,[role=button]')].find(x=>/open sidebar|expand/i.test(x.getAttribute('aria-label')||x.title||''));
        if(b)b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));})()`);
      await sleep(2500);
      out.sidebarExpanded = sbState(await evJ(REDLINES));
      out.shots.push(shot("qa-P13-sidebar-v13213"));
      await clickAt(340, 430); await sleep(1500);
      out.sidebarAfterOutsideTap = sbState(await evJ(REDLINES));
      console.log("SIDEBAR " + JSON.stringify(out.sidebarCollapsed) + " -> " + JSON.stringify(out.sidebarExpanded) + " -> " + JSON.stringify(out.sidebarAfterOutsideTap));
    } catch (e) { out.sidebar = { error: String(e && e.message).slice(0, 120) }; }

    out.finishedAt = new Date().toISOString();
  } catch (e) {
    out.fatal = String((e && e.message) || e).slice(0, 400);
    console.log("FATAL " + out.fatal);
  } finally {
    try { out.apkShaAfter = apkSha(); } catch (e) { out.apkShaAfter = "ERR"; }
    out.hashStable = (out.apkShaBefore && out.apkShaAfter && out.apkShaBefore === out.apkShaAfter);
    console.log("APK_SHA_AFTER " + out.apkShaAfter + " stable=" + out.hashStable);
    try { adb(["shell", "am", "force-stop", "xyz.cpyh.dshpush"]); } catch { }
    try { adb(["forward", "--remove-all"]); } catch { }
    try { adb(["root"]); } catch { }
    await sleep(2000);
    out.deviceClean = { whoami: whoami(), pidof: pidofApp(), forwards: (() => { try { return String(adb(["forward", "--list"]) || "").trim(); } catch { return "ERR"; } })() };
    fs.writeFileSync(`${OUTDIR}\\cb-report.json`, JSON.stringify(out, null, 2), "utf8");
    console.log("REPORT " + OUTDIR + "\\cb-report.json");
    console.log("DEVICE_CLEAN whoami=" + out.deviceClean.whoami + " pidof='" + out.deviceClean.pidof + "' forwards='" + out.deviceClean.forwards + "'");
    process.exit(0);
  }
})();
