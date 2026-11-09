// qa-doc-panel.mjs - task-11: v1.32.12 document-preview panel opacity verification.
//
// Verifies the fix for the user report "the document I opened has a transparent background":
//   * main criterion : the doc preview panel ([class*='_tabHost'], the layer that gets injected)
//                      must be OPAQUE alpha = 1.0 (native design is rgb(255,255,255)), AND the
//                      full-page screenshot must show NO bleed-through of chat text / tab bar.
//   * red lines      : BynINW_frame / BynINW_centerCol / Dc7zOa_root / html / body stay
//                      rgba(0,0,0,0) (wallpaper channel) -- measured both OPEN and CLOSED,
//                      because BynINW_frame is NATIVELY rgb(255,255,255) too, so only the
//                      structural isPanel rule separates them. This is the round's core risk.
//                      veil stays 0.45, card 0.45, menu (role=listbox) stays 0.96,
//                      sidebar expanded 0.92 / collapsed 0.45.
//   * leftover       : _block_7gxqk_4 (big code block, ~331x524) is KNOWN UNFIXED this round;
//                      recorded as a standing assertion, not a failure.
//
// Probe traps already paid for (ANALYSIS v1.32.12 sec 2.10, README):
//   1. [class*='_tabHost'] has SIX matches incl. a 0x0 placeholder -> querySelector returns the
//      0x0 one and reports "panel not open" while it IS open. ALWAYS scan all and take the max.
//   2. The screenshot path must be HARDCODED (not argv[3]): the wrapper only passes (url, outdir)
//      and a missing path silently skips screencap, which reads as "cannot capture".
//   3. connect() needs bounded retry: right after a cold boot the devtools socket appears ~25s in.
//   4. Hash must be BRACKETED (read before AND after sampling); mismatch = fail-closed.
//   5. Full-page visual verdict must assert the app process is alive (a concurrent install -r
//      kills it and you capture the launcher instead).
//
// usage: node qa-doc-panel.mjs <dsh-web-url> <outdir> <expectedApkSha> [rounds]
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const ADB = "G:\\Android\\Sdk\\platform-tools\\adb.exe";
const URL = process.argv[2];
const OUTDIR = process.argv[3] || "G:\\Android\\qa-doc";
const EXPECTED = (process.argv[4] || "").trim().toLowerCase();
const ROUNDS = parseInt(process.argv[5] || "5", 10);
const PORT = "9233";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RGX = "/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/";

fs.mkdirSync(OUTDIR, { recursive: true });
function adb(a, o = {}) { return execFileSync(ADB, a, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 60000, ...o }); }
function whoami() { try { return String(adb(["shell", "whoami"]) || "").trim(); } catch { return "ERR"; } }
function pidofApp() {
  try { return String(adb(["shell", "pidof", "xyz.cpyh.dshpush"]) || "").trim(); }
  catch (e) { const s = String((e && (e.stdout || e.message)) || ""); return /^\s*\d/.test(s) ? s.trim() : ""; }
}
function apkPath() {
  try { return String(adb(["shell", "pm", "path", "xyz.cpyh.dshpush"]) || "").trim().replace(/^package:/, "").trim(); }
  catch { return ""; }
}
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
// NOTE trap 2: output dir is hardcoded from argv, never an extra positional that the wrapper omits
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
// trap 3: bounded retry
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
// trap 1: scan ALL [class*='_tabHost'] and take the LARGEST (a 0x0 placeholder sorts first)
const PANEL = `(()=>{const RGXS=${RGX};
  const all=[...document.querySelectorAll("[class*='_tabHost']")];
  const info=all.map(e=>{const r=e.getBoundingClientRect();return {cls:(e.className||'').toString().slice(0,70),
    w:Math.round(r.width),h:Math.round(r.height)};});
  const live=all.filter(e=>e.offsetWidth>0&&e.offsetHeight>0)
    .sort((a,b)=>(b.offsetWidth*b.offsetHeight)-(a.offsetWidth*a.offsetHeight));
  const e=live[0]||null;
  if(!e)return JSON.stringify({open:false,candidates:info});
  const cs=getComputedStyle(e);const m=RGXS.exec(cs.backgroundColor);const r=e.getBoundingClientRect();
  // the diff header (+N -M) lives in TdjKvG_header / preview inside this same container
  const hdr=document.querySelector("[class*='TdjKvG_header']");
  const pv=document.querySelector("[class*='TdjKvG_preview']");
  return JSON.stringify({open:true,candidates:info,tag:e.tagName,cls:(e.className||'').toString().slice(0,80),
    bg:cs.backgroundColor,alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,rgb:m?[+m[1],+m[2],+m[3]]:null,
    position:cs.position,w:Math.round(r.width),h:Math.round(r.height),
    pctW:Math.round(100*r.width/window.innerWidth),pctH:Math.round(100*r.height/window.innerHeight),
    inline:e.style.backgroundColor||'',prio:e.style.getPropertyPriority('background-color')||'',
    headerText:hdr?(hdr.textContent||'').trim().slice(0,60):'',hasPreview:!!pv,
    isDiff:/\\+\\d+\\s*-\\d+/.test(hdr?(hdr.textContent||''):'')});})()`;

// red lines, measured in whatever state the page is in (panel open or closed)
const REDLINES = `(()=>{const RGXS=${RGX};
  const g=(sel)=>{const e=document.querySelector(sel);if(!e)return null;const cs=getComputedStyle(e);const m=RGXS.exec(cs.backgroundColor);
    const r=e.getBoundingClientRect();
    return {found:true,cls:(e.className||'').toString().slice(0,70),id:e.id||'',
      bg:cs.backgroundColor,alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,
      w:Math.round(r.width),h:Math.round(r.height),inline:e.style.backgroundColor||''};};
  const sb=[...document.querySelectorAll("[class*='_2H3hWW_root']")].sort((a,b)=>b.offsetWidth-a.offsetWidth)[0];
  const sbm=sb?RGXS.exec(getComputedStyle(sb).backgroundColor):null;
  return JSON.stringify({frame:g("[class*='BynINW_frame']"),centerCol:g("[class*='BynINW_centerCol']"),
    dcRoot:g("[class*='Dc7zOa_root']"),html:g("html"),body:g("body"),
    veil:g("#dsh-theme-veil"),card:g("[class*='RlGAzG_card']"),
    codeBlock:g("[class*='_block_7gxqk']"),
    sidebar:sb?{found:true,cls:(sb.className||'').toString().slice(0,70),collapsed:(sb.className||'').toString().indexOf('_2H3hWW_collapsed')>=0,
      w:+sb.getBoundingClientRect().width.toFixed(1),
      alpha:sbm?(sbm[4]===undefined?1:parseFloat(sbm[4])):null,bg:getComputedStyle(sb).backgroundColor,
      inline:sb.style.backgroundColor||''}:{found:false}});})()`;

// open the doc-preview panel: click an in-chat .md link/tab, verify the panel really grew
const TRIGGERS = `(()=>{const out=[];
  const seen=new Set();
  const push=(e,why)=>{if(!e)return;if(seen.has(e))return;seen.add(e);
    const r=e.getBoundingClientRect();
    if(r.width<=0||r.height<=0)return;
    out.push({why,tag:e.tagName,cls:(e.className||'').toString().slice(0,60),
      text:(e.textContent||'').trim().slice(0,40),title:e.getAttribute&&(e.getAttribute('title')||'')||'',
      x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});};
  // 1) anything that looks like the generated .md document
  for(const e of document.querySelectorAll('a,button,[role=button],[role=tab],[class*=tab]')){
    const t=((e.textContent||'')+' '+(e.getAttribute&&(e.getAttribute('title')||'')||'')).toLowerCase();
    if(t.indexOf('.md')>=0||t.indexOf('story_meizijiu')>=0||t.indexOf('markdown')>=0) push(e,'doc-link');
  }
  // 2) existing viewer tabs in the tab bar
  for(const e of document.querySelectorAll("[class*='_tabCell'],[class*='_tab_']")) push(e,'tab-cell');
  return JSON.stringify(out.slice(0,14));})()`;

const CLOSE_PANEL = `(()=>{const cs=[...document.querySelectorAll("[class*='_tabClose'],[aria-label*='Close' i],[title*='Close' i]")].filter(e=>e.offsetWidth>0);
  if(!cs.length)return JSON.stringify({ok:false});
  const e=cs[0];const r=e.getBoundingClientRect();
  return JSON.stringify({ok:true,x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),cls:(e.className||'').toString().slice(0,50)});})()`;

// slash menu still 0.96 (v1.32.11 must not regress), focus WITHOUT clicking (a synthesized click steals focus)
const MENU = `(()=>{const lb=document.querySelector('[role=listbox]');window.__qaOverlay=lb;
  if(!lb)return JSON.stringify({found:false});
  const cs=getComputedStyle(lb);const m=${RGX}.exec(cs.backgroundColor);const r=lb.getBoundingClientRect();
  return JSON.stringify({found:true,alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,bg:cs.backgroundColor,
    w:Math.round(r.width),h:Math.round(r.height),items:[...lb.querySelectorAll('[role=option]')].filter(b=>b.offsetHeight>0).length});})()`;

// panel inner scroller -> bottom (must run BEFORE closing the panel)
const SCROLL = `(()=>{const all=[...document.querySelectorAll("[class*='_tabHost']")].filter(e=>e.offsetWidth>0);
  const panel=all.sort((a,b)=>(b.offsetWidth*b.offsetHeight)-(a.offsetWidth*a.offsetHeight))[0];
  if(!panel)return JSON.stringify({ok:false});
  const sc=[panel,...panel.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+4)
    .sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight))[0];
  if(!sc)return JSON.stringify({ok:true,scrollable:false});
  const before=sc.scrollTop; sc.scrollTop=sc.scrollHeight;
  return JSON.stringify({ok:true,scrollable:true,moved:sc.scrollTop>before,scrollTopBefore:before,
    scrollTopAfter:sc.scrollTop,scrollHeight:sc.scrollHeight,clientHeight:sc.clientHeight});})()`;

// adversarial: TWO panels open at once (multi-tab) -- does the new rule still hold, and do the
// non-panel channels stay transparent with more surfaces on screen?  (new angle, A30)
const TWO_PANELS = `(()=>{const RGXS=${RGX};
  const live=[...document.querySelectorAll("[class*='_tabHost']")].filter(e=>e.offsetWidth>0&&e.offsetHeight>0)
    .sort((a,b)=>(b.offsetWidth*b.offsetHeight)-(a.offsetWidth*a.offsetHeight));
  const out=live.slice(0,3).map(e=>{const cs=getComputedStyle(e);const m=RGXS.exec(cs.backgroundColor);
    return {cls:(e.className||'').toString().slice(0,60),bg:cs.backgroundColor,
      alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,w:e.offsetWidth,h:e.offsetHeight};});
  const fr=document.querySelector("[class*='BynINW_frame']");
  const fm=fr?RGXS.exec(getComputedStyle(fr).backgroundColor):null;
  return JSON.stringify({livePanels:out,count:live.length,
    frame:fr?{bg:getComputedStyle(fr).backgroundColor,alpha:fm?(fm[4]===undefined?1:parseFloat(fm[4])):null}:null});})()`;

async function openPanel() {
  // strategy A: click a doc link
  const tg = await evJ(TRIGGERS);
  for (const t of (Array.isArray(tg) ? tg : [])) {
    try {
      await ev(`(()=>{const all=[...document.querySelectorAll('a,button,[role=button],[role=tab],[class*=tab]')];
        const e=all.find(x=>{const r=x.getBoundingClientRect();return Math.round(r.left+r.width/2)===${t.x}&&Math.round(r.top+r.height/2)===${t.y};});
        if(e){const c=e.closest('button,a,[role=button],[role=tab]')||e;c.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));}})()`);
      await sleep(1800);
      let p = await evJ(PANEL);
      if (p.open && p.pctW >= 85 && p.pctH >= 85) return { ok: true, via: t.why + ":" + t.text, panel: p };
      // strategy B: real CDP click
      await clickAt(t.x, t.y);
      await sleep(1800);
      p = await evJ(PANEL);
      if (p.open && p.pctW >= 85 && p.pctH >= 85) return { ok: true, via: "cdp:" + t.why + ":" + t.text, panel: p };
    } catch (e) { }
  }
  return { ok: false, tried: tg };
}

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

    await startFresh();
    out.viewport = { w: await ev("innerWidth"), h: await ev("innerHeight"), dpr: await ev("devicePixelRatio") };
    console.log("VIEWPORT " + JSON.stringify(out.viewport));

    // ---- baseline with panel CLOSED (wallpaper channel + all red lines)
    out.closed = { redlines: await evJ(REDLINES) };
    out.closed.shellAlive = !!(await ev("(!!document.querySelector(\"[class*='BynINW_frame']\"))"));
    out.closed.pid = pidofApp();
    out.shots.push(shot("qa-C13-panel-closed-wallpaper"));
    console.log("CLOSED frame=" + (out.closed.redlines.frame ? out.closed.redlines.frame.bg : "n/a") +
      " veil=" + (out.closed.redlines.veil ? out.closed.redlines.veil.alpha : "n/a"));

    // ---- open the panel and sample N times (close/reopen each round)
    let lastOpen = null;
    for (let r = 1; r <= ROUNDS; r++) {
      if (r > 1) {
        const c = await evJ(CLOSE_PANEL);
        if (c.ok) { await ev(`(()=>{const e=document.querySelector("[class*='_tabClose']");})()`); await clickAt(c.x, c.y); await sleep(1500); }
        else { await ev(`(()=>{const b=[...document.querySelectorAll("[class*='_tabClose']")][0];if(b)b.dispatchEvent(new MouseEvent('click',{bubbles:true}));})()`); await sleep(1500); }
      }
      const o = await openPanel();
      if (!o.ok) { out.rounds.push({ round: r, BLOCKED: "could not open the doc panel", tried: o.tried }); console.log("R" + r + " PANEL_NOT_OPEN"); break; }
      const p = o.panel;
      const rec = { round: r, openedVia: o.via, panel: p, redlines: await evJ(REDLINES) };
      if (r === 1) {
        rec.scroll = await evJ(SCROLL);           // scroll BEFORE closing (task requirement)
        out.scroll = rec.scroll;
        out.shots.push(shot("qa-C13-doc-panel-open"));
        out.menuWithPanelOpen = await evJ(MENU); // panel + overlay coexist
        rec.slashWhilePanelOpen = out.menuWithPanelOpen;
        console.log("MENU_WITH_PANEL " + JSON.stringify(out.menuWithPanelOpen));
      }
      console.log("R" + r + " panel alpha=" + p.alpha + " bg=" + p.bg + " " + p.w + "x" + p.h +
        " pct=" + p.pctW + "%/" + p.pctH + "% diff=" + p.isDiff + " | frame=" + (rec.redlines.frame ? rec.redlines.frame.bg : "n/a") +
        " veil=" + (rec.redlines.veil ? rec.redlines.veil.alpha : "n/a") +
        " card=" + (rec.redlines.card ? rec.redlines.card.alpha : "n/a") +
        " centerCol=" + (rec.redlines.centerCol ? rec.redlines.centerCol.bg : "n/a") +
        " dcRoot=" + (rec.redlines.dcRoot ? rec.redlines.dcRoot.bg : "n/a"));
      out.rounds.push(rec);
      lastOpen = p;
    }

    // ---- adversarial A30: open a SECOND tab/panel if possible, then re-measure
    try {
      const before = await evJ(TWO_PANELS);
      const o2 = await openPanel();
      await sleep(1200);
      const after = await evJ(TWO_PANELS);
      out.a30_multiPanel = { before, secondOpenAttempt: o2.ok ? "opened" : "not-opened", after };
      console.log("A30 " + JSON.stringify(out.a30_multiPanel).slice(0, 400));
      out.shots.push(shot("qa-A30-multi-panel"));
    } catch (e) { out.a30_multiPanel = { error: String(e && e.message).slice(0, 160) }; }

    // ---- close panel(s) -> wallpaper channel must be intact again
    for (let i = 0; i < 4; i++) {
      const c = await evJ(CLOSE_PANEL);
      if (!c.ok) break;
      await clickAt(c.x, c.y); await sleep(1200);
    }
    const stillOpen = await evJ(PANEL);
    out.afterClose = { panelStillOpen: !!(stillOpen.open && stillOpen.pctW >= 85), redlines: await evJ(REDLINES) };
    out.afterClose.shellAlive = !!(await ev("(!!document.querySelector(\"[class*='BynINW_frame']\"))"));
    out.afterClose.pid = pidofApp();
    out.shots.push(shot("qa-P12-panel-closed-wallpaper"));
    console.log("AFTER_CLOSE frame=" + (out.afterClose.redlines.frame ? out.afterClose.redlines.frame.bg : "n/a") +
      " veil=" + (out.afterClose.redlines.veil ? out.afterClose.redlines.veil.alpha : "n/a") +
      " alive=" + out.afterClose.shellAlive + "/" + out.afterClose.pid);

    // ---- slash menu still 0.96 with no panel (v1.32.11 regression guard)
    try {
      await ev(`(()=>{const c=[...document.querySelectorAll('textarea,[contenteditable=true]')].filter(e=>e.offsetHeight>0);const el=c[c.length-1];if(el)el.focus();})()`);
      await sleep(350);
      await send("Input.insertText", { text: "/" });
      await sleep(1600);
      out.menuAlone = await evJ(MENU);
      console.log("MENU_ALONE " + JSON.stringify(out.menuAlone));
      out.shots.push(shot("qa-P11-menu-still-096"));
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await sleep(600);
    } catch (e) { out.menuAlone = { error: String(e && e.message).slice(0, 120) }; }

    // ---- sidebar collapsed / expanded
    try {
      const sbState = (s) => ({ collapsed: s.sidebar ? s.sidebar.collapsed : null, alpha: s.sidebar ? s.sidebar.alpha : null, w: s.sidebar ? s.sidebar.w : null });
      const rl = await evJ(REDLINES);
      out.sidebarCollapsed = sbState(rl);
      await ev(`(()=>{const b=[...document.querySelectorAll('button,[role=button]')].find(x=>/open sidebar|expand/i.test(x.getAttribute('aria-label')||x.title||''));
        if(b)b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));})()`);
      await sleep(2500);
      const rl2 = await evJ(REDLINES);
      out.sidebarExpanded = sbState(rl2);
      out.shots.push(shot("qa-P13-sidebar-expanded-v13212"));
      await clickAt(340, 430); await sleep(1500);
      const rl3 = await evJ(REDLINES);
      out.sidebarAfterOutsideTap = sbState(rl3);
      console.log("SIDEBAR collapsed=" + JSON.stringify(out.sidebarCollapsed) + " expanded=" + JSON.stringify(out.sidebarExpanded) + " after=" + JSON.stringify(out.sidebarAfterOutsideTap));
    } catch (e) { out.sidebar = { error: String(e && e.message).slice(0, 120) }; }

    out.finishedAt = new Date().toISOString();
  } catch (e) {
    out.fatal = String((e && e.message) || e).slice(0, 400);
    console.log("FATAL " + out.fatal);
  } finally {
    // trap 4: hash bracket close
    try { out.apkShaAfter = apkSha(); } catch (e) { out.apkShaAfter = "ERR"; }
    out.hashStable = (out.apkShaBefore && out.apkShaAfter && out.apkShaBefore === out.apkShaAfter);
    console.log("APK_SHA_AFTER " + out.apkShaAfter + " stable=" + out.hashStable);
    try { adb(["shell", "am", "force-stop", "xyz.cpyh.dshpush"]); } catch { }
    try { adb(["forward", "--remove-all"]); } catch { }
    try { adb(["root"]); } catch { }
    await sleep(2000);
    out.deviceClean = { whoami: whoami(), pidof: pidofApp(), forwards: (() => { try { return String(adb(["forward", "--list"]) || "").trim(); } catch { return "ERR"; } })() };
    fs.writeFileSync(`${OUTDIR}\\doc-report.json`, JSON.stringify(out, null, 2), "utf8");
    console.log("REPORT " + OUTDIR + "\\doc-report.json");
    console.log("DEVICE_CLEAN whoami=" + out.deviceClean.whoami + " pidof='" + out.deviceClean.pidof + "' forwards='" + out.deviceClean.forwards + "'");
    process.exit(0);
  }
})();
