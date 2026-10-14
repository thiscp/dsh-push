// qa-overlay-r2.mjs - task-9 re-verification of the P1 fix (commit f5e4a6b, vc77).
//
// Answers, with measurements:
//   1. QA-P11  : real slash menu [role=listbox] alpha, sampled N times with a FRESH app each round
//                (the previous round failed exactly because a single sample cannot see an
//                intermittent defect). BOTH geometries are covered:
//                  - HIGH menu (type "/"      -> ~25 items, was 257x392, i.e. h > vh*0.5 = 335.5)
//                  - LOW  menu (type "/plan"  -> filtered, h < vh*0.5)
//   2. ancestors: full chain from [role=listbox] to <body>, incl. backgroundImage + ::before/::after
//                (background-color:transparent !important does NOT remove a gradient)
//   3. outer surface `_surface_*` (no role) residual: it still goes through the geometry branch,
//                so quantify the rim it leaves (predicted ~2px) and whether it is force-transparent
//   4. QA-P12   : wallpaper channel + #dsh-theme-veil must stay 0.45
//   5. QA-A29   : non-overlays must not be brightened (veil 0.45, input card 0.45)
//   6. U-1      : expanded sidebar ~0.92 (Open sidebar via JS dispatchEvent: a synthesized CDP
//                 click gets stolen by SECTION._tabHost_*, which is what blocked it last round)
//   7. U-2      : menu scroll-to-bottom BEFORE the click (last round scrolled after the click,
//                 when the menu was already unmounted -> measured nothing)
//
// Discipline (verify/TESTER.md): adbd must be ROOT before `am start .WebActivity` (H-1), and
// `adb root` restarts the adb server and DROPS forwards -> root happens BEFORE any adb forward,
// with a whoami assertion that fails CLOSED. Screenshots go through adb screencap+pull (>100KB).
//
// usage: node qa-overlay-r2.mjs <dsh-web-url> <outdir> [highRounds] [lowRounds] [expectedApkSha]
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const ADB = "G:\\Android\\Sdk\\platform-tools\\adb.exe";
const URL = process.argv[2];
const OUTDIR = process.argv[3] || "G:\\Android\\qa-r2";
const HIGH = parseInt(process.argv[4] || "5", 10);
const LOW = parseInt(process.argv[5] || "2", 10);
const EXPECTED_SHA = (process.argv[6] || "").trim().toLowerCase();
const PORT = "9231";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RGX = "/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/";

fs.mkdirSync(OUTDIR, { recursive: true });
function adb(a, o = {}) { return execFileSync(ADB, a, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 60000, ...o }); }
function whoami() { try { return String(adb(["shell", "whoami"]) || "").trim(); } catch { return "ERR"; } }
function pidofApp() {
  try { return String(adb(["shell", "pidof", "xyz.cpyh.dshpush"]) || "").trim(); }
  catch (e) { const s = String((e && (e.stdout || e.message)) || ""); return /^\s*\d/.test(s) ? s.trim() : ""; }
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
    adb(["shell", "screencap", "-p", r]); adb(["pull", r, `${OUTDIR}\\${name}.png`]);
    const st = fs.statSync(`${OUTDIR}\\${name}.png`);
    const ok = st.size > 100000;
    console.log("SHOT " + name + " bytes=" + st.size + " ok=" + ok);
    return { name, bytes: st.size, ok };
  } catch (e) { console.log("SHOT " + name + " FAILED " + String(e && e.message).slice(0, 140)); return { name, bytes: 0, ok: false }; }
}

let ws = null, id = 0, pend = new Map();
function send(m, p = {}) {
  const i = ++id;
  return new Promise((res, rej) => { pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); setTimeout(() => { if (pend.delete(i)) rej(new Error("timeout " + m)); }, 25000); });
}
async function ev(x) {
  const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r && r.exceptionDetails) throw new Error("JS:" + JSON.stringify(r.exceptionDetails).slice(0, 220));
  return r && r.result ? r.result.value : undefined;
}
async function evJ(x) { const v = await ev(x); try { return JSON.parse(v); } catch { return { raw: v }; } }
async function clickAt(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
async function connect() {
  await requireRoot("connect");
  // The devtools socket only exists once the page has actually started loading (README: ~25s
  // after am start). A single fetch right after the forward throws "fetch failed" on a fresh
  // boot -> bounded retry instead of failing the whole round.
  let lastErr = null;
  for (let attempt = 1; attempt <= 20; attempt++) {
    const pid = adb(["shell", "pidof", "xyz.cpyh.dshpush"]).trim().split(/\s+/)[0];
    if (!/^\d+$/.test(pid)) { lastErr = new Error("app not running"); await sleep(2000); continue; }
    try {
      try { adb(["forward", "--remove-all"]); } catch { }
      adb(["forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`]);
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.filter((t) => t.type === "page").pop();
      if (!page) { lastErr = new Error("no page target"); await sleep(2000); continue; }
      if (ws) { try { ws.close(); } catch { } }
      ws = new WebSocket(page.webSocketDebuggerUrl);
      id = 0; pend = new Map();
      ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } });
      await new Promise((res2, rej2) => { ws.addEventListener("open", res2); ws.addEventListener("error", () => rej2(new Error("ws"))); });
      await send("Runtime.enable");
      if (attempt > 1) console.log("CONNECT ok on attempt " + attempt);
      return pid;
    } catch (e) {
      lastErr = e;
      if (attempt === 1 || attempt % 5 === 0) console.log("CONNECT retry " + attempt + ": " + String((e && e.message) || e).slice(0, 80));
      await sleep(2500);
    }
  }
  throw new Error("connect failed after 20 attempts: " + String((lastErr && lastErr.message) || lastErr).slice(0, 120));
}
// Installed-APK sha256. NEW DISCIPLINE (lead, 2026-10-15): read it BEFORE and AFTER sampling and
// bracket the dataset with both reads. Why: my first Part A run stamped a hash that was read
// AFTER the 0.96 build had been installed, so the label did not describe the samples. A single
// read is not evidence of which build produced the samples; a bracket is.
function apkPath() {
  const p = String(adb(["shell", "pm", "path", "xyz.cpyh.dshpush"]) || "").trim();
  return p.replace(/^package:/, "").trim();
}
function apkSha() {
  try {
    const p = apkPath();
    if (!p) return "NO_PATH";
    const out = String(adb(["shell", "sha256sum", p]) || "").trim();
    const t = out.split(/\s+/)[0];
    return /^[0-9a-f]{64}$/i.test(t) ? t : "UNPARSED:" + out.slice(0, 80);
  } catch (e) { return "ERR:" + String((e && e.message) || e).slice(0, 80); }
}

// per-round app start
async function startFresh() {
  await requireRoot("startApp");
  try { adb(["shell", "am", "force-stop", "xyz.cpyh.dshpush"]); } catch { }
  await sleep(1500);
  adb(["shell", "am", "start", "-n", "xyz.cpyh.dshpush/.WebActivity", "--es", "url", URL]);
  let pid = "";
  for (let i = 0; i < 30; i++) { try { pid = adb(["shell", "pidof", "xyz.cpyh.dshpush"]).trim().split(/\s+/)[0]; } catch { } if (/^\d+$/.test(pid)) break; await sleep(1000); }
  await connect();
  for (let i = 0; i < 20; i++) { if (await ev("(!!document.querySelector(\"[class*='BynINW_frame']\"))")) return pid; await sleep(2500); }
  throw new Error("shell not ready");
}

const MENU = `(()=>{const lb=document.querySelector('[role=listbox]');const el=lb||document.querySelector('[role=menu]');
  window.__qaOverlay=el;if(!el)return JSON.stringify({found:false});
  const cs=getComputedStyle(el);const m=${RGX}.exec(cs.backgroundColor);const R=el.getBoundingClientRect();
  const items=[...el.querySelectorAll('[role=option]')].filter(b=>b.offsetHeight>0).length;
  const surf=document.querySelector("[class*='Z9Jnlq_menu']");
  let s=null;
  if(surf){const sc=getComputedStyle(surf);const sm=${RGX}.exec(sc.backgroundColor);const SR=surf.getBoundingClientRect();
    s={cls:(surf.className||'').toString().slice(0,80),bg:sc.backgroundColor,alpha:sm?(sm[4]===undefined?1:parseFloat(sm[4])):null,
       inline:surf.style.backgroundColor||'',prio:surf.style.getPropertyPriority('background-color')||'',
       w:Math.round(SR.width),h:Math.round(SR.height),
       rimL:Math.round(SR.left-R.left),rimT:Math.round(SR.top-R.top),
       rimR:Math.round((SR.left+SR.width)-(R.left+R.width)),rimB:Math.round((SR.top+SR.height)-(R.top+R.height))};}
  return JSON.stringify({found:true,tag:el.tagName,cls:(el.className||'').toString().slice(0,90),
    aria:el.getAttribute('aria-label')||'',
    bg:cs.backgroundColor,alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,
    inline:el.style.backgroundColor||'',prio:el.style.getPropertyPriority('background-color')||'',
    w:Math.round(R.width),h:Math.round(R.height),items,surface:s,
    vh:window.innerHeight,overHalfH:(R.height>window.innerHeight*0.5),overHalfW:(R.width>window.innerWidth*0.5)});})()`;

const CHAIN = `(()=>{const RGXS=${RGX};const lb=window.__qaOverlay;if(!lb)return JSON.stringify([]);
  const o=[];let e=lb;
  while(e){const cs=getComputedStyle(e);const m=RGXS.exec(cs.backgroundColor);const R=e.getBoundingClientRect();
    const ps=(w)=>{try{const c=getComputedStyle(e,w);const pm=RGXS.exec(c.backgroundColor);
      return {content:(c.content||'').slice(0,18),bg:c.backgroundColor,alpha:pm?(pm[4]===undefined?1:parseFloat(pm[4])):null};}catch(err){return null;}};
    o.push({d:o.length,tag:e.tagName,cls:(e.className||'').toString().slice(0,95),role:e.getAttribute&&(e.getAttribute('role')||'')||'',
      bg:cs.backgroundColor,alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,
      img:(cs.backgroundImage||'none').slice(0,70),pos:cs.position,z:cs.zIndex,
      w:Math.round(R.width),h:Math.round(R.height),
      inline:e.style.backgroundColor||'',prio:e.style.getPropertyPriority('background-color')||'',
      before:ps('::before'),after:ps('::after')});
    if(e===document.body)break; e=e.parentElement;}
  return JSON.stringify(o);})()`;

const REDLINES = `(()=>{const RGXS=${RGX};
  const g=(sel)=>{const e=document.querySelector(sel);if(!e)return null;const cs=getComputedStyle(e);const m=RGXS.exec(cs.backgroundColor);
    return {cls:(e.className||'').toString().slice(0,80),id:e.id||'',bg:cs.backgroundColor,
      alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,inline:e.style.backgroundColor||''};};
  return JSON.stringify({frame:g("[class*='BynINW_frame']"),centerCol:g("[class*='BynINW_centerCol']"),
    html:g("html"),body:g("body"),veil:g("#dsh-theme-veil"),card:g("[class*='RlGAzG_card']")});})()`;

// scroll BEFORE any click (U-2): find the real scroller, jump to bottom, check the last item
const SCROLL = `(()=>{const lb=window.__qaOverlay;if(!lb)return JSON.stringify({ok:false,why:'no overlay'});
  const cands=[lb,...lb.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+2);
  const sc=cands.sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight))[0];
  if(!sc)return JSON.stringify({ok:true,scrollable:false,note:'listbox has no scroller (fits)'});
  const before=sc.scrollTop; sc.scrollTop=sc.scrollHeight; const after=sc.scrollTop;
  const R=sc.getBoundingClientRect();
  const items=[...lb.querySelectorAll('[role=option]')].filter(b=>b.offsetHeight>0);
  const last=items[items.length-1];const lr=last?last.getBoundingClientRect():null;
  return JSON.stringify({ok:true,scrollable:true,scrollerCls:(sc.className||'').toString().slice(0,60),
    scrollTopBefore:before,scrollTopAfter:after,scrollHeight:sc.scrollHeight,clientHeight:sc.clientHeight,
    moved:after>before,lastItemText:last?(last.textContent||'').trim().slice(0,26):'',
    lastItemFullyVisible:lr?(lr.top>=R.top-2&&lr.bottom<=R.bottom+2):false,itemCount:items.length});})()`;

const ITEM = `(()=>{const list=[...document.querySelectorAll('[role=option]')].filter(b=>b.offsetHeight>0&&b.offsetWidth>0);
  const pick=list.find(b=>/model|plan|goal|compact|feedback|permission|export/i.test(b.textContent||'')&&!/file|attach/i.test(b.textContent||''))||list[0];
  if(!pick)return JSON.stringify({ok:false});
  const r=pick.getBoundingClientRect();
  return JSON.stringify({ok:true,x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),text:(pick.textContent||'').trim().slice(0,34)});})()`;

const SIDEBAR_STATE = `(()=>{const e=document.querySelector("[class*='_2H3hWW_root']");if(!e)return JSON.stringify({found:false});
  const cn=(e.className||'').toString();const r=e.getBoundingClientRect();const cs=getComputedStyle(e);const m=${RGX}.exec(cs.backgroundColor);
  return JSON.stringify({found:true,collapsed:cn.indexOf('_2H3hWW_collapsed')>=0,w:+r.width.toFixed(1),
    alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,bg:cs.backgroundColor,pos:cs.position,z:cs.zIndex,
    inline:e.style.backgroundColor||''});})()`;

async function openMenu(seq) {
  await ev(`(()=>{const c=[...document.querySelectorAll('textarea,[contenteditable=true]')].filter(e=>e.offsetHeight>0);
    const el=c[c.length-1]; if(el) el.focus(); return document.activeElement===el;})()`);
  await sleep(350);
  await send("Input.insertText", { text: seq });
  await sleep(1800);
}

(async () => {
  const out = { startedAt: new Date().toISOString(), url: URL.replace(/token=[^&]+/, "token=<redacted>"),
    expectedApkSha: EXPECTED_SHA || "(not asserted)", highSamples: [], lowSamples: [], shots: [] };
  try {
    console.log("WHOAMI " + whoami());
    out.versionName = (adb(["shell", "dumpsys", "package", "xyz.cpyh.dshpush"]).split(/\r?\n/).find((l) => l.includes("versionName=")) || "").trim();
    out.versionCode = (adb(["shell", "dumpsys", "package", "xyz.cpyh.dshpush"]).split(/\r?\n/).find((l) => l.includes("versionCode=")) || "").trim();
    console.log("VERSION " + out.versionName + " | " + out.versionCode);

    // ---- HASH BRACKET (open): read BEFORE any sampling. Fails closed if mismatched.
    out.apkShaBefore = apkSha();
    console.log("APK_SHA_BEFORE " + out.apkShaBefore);
    if (EXPECTED_SHA) {
      if (out.apkShaBefore.toLowerCase() !== EXPECTED_SHA) {
        throw new Error("BLOCKED: installed APK sha " + out.apkShaBefore + " != expected " + EXPECTED_SHA +
          " - refusing to sample across builds (stopping before any measurement)");
      }
      console.log("APK_SHA_MATCH ok (build frozen)");
    }

    // ---------- HIGH menu: N independent rounds, fresh app each time
    for (let i = 1; i <= HIGH; i++) {
      const pid = await startFresh();
      if (i === 1) {
        out.viewport = { w: await ev("innerWidth"), h: await ev("innerHeight"), dpr: await ev("devicePixelRatio") };
        console.log("VIEWPORT " + JSON.stringify(out.viewport));
        out.redlines_noOverlay = await evJ(REDLINES);
        // QA-P12 wallpaper shot with the app DEFINITELY alive (last round the concurrent install
        // killed the process and I captured the launcher -> BLOCKED). Assert the shell is present
        // right before and right after the capture.
        out.p12_shellBefore = !!(await ev("(!!document.querySelector(\"[class*='BynINW_frame']\"))"));
        out.p12_pidBefore = pidofApp();
        out.p12_shot = shot("qa-P12-r2-wallpaper");
        out.shots.push(out.p12_shot);
        out.p12_shellAfter = !!(await ev("(!!document.querySelector(\"[class*='BynINW_frame']\"))"));
        out.p12_pidAfter = pidofApp();
        console.log("P12_ALIVE before=" + out.p12_shellBefore + "/" + out.p12_pidBefore + " after=" + out.p12_shellAfter + "/" + out.p12_pidAfter);
      }
      await openMenu("/");
      const m = await evJ(MENU);
      m.round = i; m.pid = pid;
      console.log("HIGH_R" + i + " alpha=" + m.alpha + " h=" + m.h + " items=" + m.items + " overHalfH=" + m.overHalfH + " surfaceAlpha=" + (m.surface ? m.surface.alpha : "n/a"));
      if (i === 1) { out.chain_high = await evJ(CHAIN); out.menu_high = m; }
      // U-2: scroll BEFORE the click
      m.scroll = await evJ(SCROLL);
      m.shot = shot("qa-P11-r2-high-r" + i);
      out.shots.push(m.shot);
      if (i === 1) {
        const it = await evJ(ITEM);
        m.clickTarget = it;
        if (it.ok) {
          await clickAt(it.x, it.y);
          await sleep(1600);
          m.menuClosedAfterClick = !(await ev("(!!document.querySelector('[role=listbox],[role=menu]'))"));
          m.shotAfterClick = shot("qa-C11-r2-menu-clicked");
          out.shots.push(m.shotAfterClick);
        }
        out.redlines_withOverlay = await evJ(REDLINES);
      }
      out.highSamples.push(m);
    }

    // ---------- LOW menu: filtered sequence, must stay under vh*0.5
    for (let i = 1; i <= LOW; i++) {
      const pid = await startFresh();
      await openMenu("/plan");
      const m = await evJ(MENU);
      m.round = i; m.pid = pid;
      console.log("LOW_R" + i + " alpha=" + m.alpha + " h=" + m.h + " items=" + m.items + " overHalfH=" + m.overHalfH);
      m.shot = shot("qa-P11-r2-low-r" + i);
      out.shots.push(m.shot);
      out.lowSamples.push(m);
    }

    // ---------- U-1: expanded sidebar (JS dispatchEvent; a synthesized CDP click gets stolen)
    {
      const pid = await startFresh();
      out.p13_before = await evJ(SIDEBAR_STATE);
      const dis = await evJ(`(()=>{const b=[...document.querySelectorAll('button,[role=button]')].find(x=>/open sidebar|expand/i.test(x.getAttribute('aria-label')||x.title||''));
        if(!b)return JSON.stringify({ok:false});
        const r=b.getBoundingClientRect();
        return JSON.stringify({ok:true,label:b.getAttribute('aria-label')||'',x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`);
      out.p13_button = dis;
      if (dis.ok) {
        await ev(`(()=>{const b=[...document.querySelectorAll('button,[role=button]')].find(x=>/open sidebar|expand/i.test(x.getAttribute('aria-label')||x.title||''));
          if(b)b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));})()`);
        await sleep(2500);
      }
      out.p13_expanded = await evJ(SIDEBAR_STATE);
      out.p13_shot = shot("qa-P13-r2-sidebar-expanded");
      out.shots.push(out.p13_shot);
      // C12: click outside -> collapse
      await clickAt(340, 430);
      await sleep(1800);
      out.c12_afterOutsideTap = await evJ(SIDEBAR_STATE);
      out.c12_shot = shot("qa-C12-r2-after-outside-tap");
      out.shots.push(out.c12_shot);
      out.pid_p13 = pid;
      // ---------- A29 multi-overlay: bounded attempt to raise other overlays and check they are
      // not collaterally brightened. Anything we cannot raise is recorded as NOT COVERED.
      out.a29_otherOverlays = await evJ(`(()=>{const RGXS=${RGX};
        const surf=(e)=>{if(!e)return null;const cs=getComputedStyle(e);const m=RGXS.exec(cs.backgroundColor);
          const r=e.getBoundingClientRect();
          return {tag:e.tagName,cls:(e.className||'').toString().slice(0,80),id:e.id||'',role:e.getAttribute('role')||'',
            bg:cs.backgroundColor,alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,
            w:Math.round(r.width),h:Math.round(r.height),inline:e.style.backgroundColor||''};};
        // dialog / tooltip / menu that are present in the DOM right now (whatever the app renders)
        const out={};
        for(const r of ['dialog','alertdialog','tooltip','menu']){
          const e=document.querySelector('[role="'+r+'"]');
          out[r]= e? {present:true, ...surf(e)} : {present:false};
        }
        out.tabHost=surf(document.querySelector("section[class*='_tabHost_']"));
        out.veil=surf(document.getElementById('dsh-theme-veil'));
        return JSON.stringify(out);})()`);
      console.log("A29_OTHER " + JSON.stringify(out.a29_otherOverlays).slice(0, 300));
    }
    out.finishedAt = new Date().toISOString();
  } catch (e) {
    out.fatal = String((e && e.message) || e).slice(0, 400);
    console.log("FATAL " + out.fatal);
  } finally {
    // HASH BRACKET (close): read again AFTER sampling; equality with the opening read is what
    // proves the dataset was produced by ONE build.
    try { out.apkShaAfter = apkSha(); } catch (e) { out.apkShaAfter = "ERR"; }
    out.hashStable = (out.apkShaBefore && out.apkShaAfter && out.apkShaBefore === out.apkShaAfter);
    console.log("APK_SHA_AFTER " + out.apkShaAfter + "  stable=" + out.hashStable);
    try { adb(["shell", "am", "force-stop", "xyz.cpyh.dshpush"]); } catch { }
    try { adb(["forward", "--remove-all"]); } catch { }
    try { adb(["root"]); } catch { }
    await sleep(2500);
    out.deviceClean = { whoami: whoami(), pidof: pidofApp(), forwards: (() => { try { return String(adb(["forward", "--list"]) || "").trim(); } catch { return "ERR"; } })() };
    fs.writeFileSync(`${OUTDIR}\\r2-report.json`, JSON.stringify(out, null, 2), "utf8");
    console.log("REPORT " + OUTDIR + "\\r2-report.json");
    console.log("DEVICE_CLEAN whoami=" + out.deviceClean.whoami + " pidof='" + out.deviceClean.pidof + "' forwards='" + out.deviceClean.forwards + "'");
    process.exit(0);
  }
})();
