// qa-overlay-probe.mjs - v1.32.11 overlay opacity verification driver (task-7).
//
// RUNS ON THE EMULATOR HOST (the laptop): adb forwards are host-local, so the CDP client must
// live there. Measures the slash-command menu overlay opacity (QA-P11), the wallpaper channel
// (QA-P12), the expanded sidebar alpha (QA-P13), sweeps every fixed|absolute element for
// collateral damage from the new "overlays are opaque" rule (QA-A29), and drives the menu
// interaction (QA-C11).
//
// REAL DOM (captured by developer on this emulator; the probe locates by ROLE first because
// hardcoding CSS-module hashes is explicitly forbidden by ANALYSIS-v1.32.11-overlay-opacity.md):
//   div.Z9Jnlq_viewport [role=listbox][aria-label="Trigger suggestions"]  257x172  bg=rgba(0,0,0,0)
//   div._surface_ri079_1.Z9Jnlq_menu                                       bg=rgba(0,0,0,0) position:absolute z-index:100
//   button.Z9Jnlq_item [role=option]  251x34
// KEY FACT (lead's task-7 correction): the real menu's two surface layers are BOTH rgba(0,0,0,0),
// so under the OLD code they hit the `alpha<1 -> continue` idempotence gate and were NEVER
// injected at all -- worse than the 0.45 originally assumed. Role-based location is what makes
// this overlay findable regardless of the CSS-module hash.
//
// Three traps this probe deliberately avoids (each would silently measure nothing):
//   1. Runtime.evaluate with returnByValue:true CANNOT return a DOM node -> the node is stashed on
//      window.__qaOverlay and only a JSON descriptor crosses the boundary.
//   2. Input.insertText inserts ZERO characters into this input (developer measured it). The slash
//      is typed through the device IME: `adb shell input text "/"`.
//   3. Regex escapes: RGX below holds the rgba() matcher with single-level escapes, so interpolating
//      it into a template literal yields a valid regex in the page (a naive \\( inside a template
//      literal collapses to "(" and breaks the match silently).
//
// Discipline encoded here (verify/TESTER.md):
//   - adbd must be ROOT before `am start .WebActivity` (H-1, task-4). `adb root` restarts the adb
//     server and DROPS existing forwards, so root happens BEFORE any `adb forward`. whoami is
//     asserted and a non-root adbd is a hard BLOCKED, never a silent continue.
//   - screenshots always go through `adb screencap` + `adb pull` (never CDP captureScreenshot: it
//     cannot see the native wallpaper layer) and must exceed 100KB.
//
// usage: node qa-overlay-probe.mjs <dsh-web-url> <outdir>
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const ADB = "G:\\Android\\Sdk\\platform-tools\\adb.exe";
const URL = process.argv[2];
const OUTDIR = process.argv[3] || "G:\\Android\\qa-overlay";
const PORT = "9228";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(OUTDIR, { recursive: true });

// rgba() matcher source (single-level escapes; safe to interpolate into template literals)
const RGX = "/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/";

function adb(args, opts = {}) {
  return execFileSync(ADB, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 60000, ...opts });
}
function whoami() {
  try { return String(adb(["shell", "whoami"]) || "").trim(); }
  catch (e) { return "ERR:" + String(e && e.message).slice(0, 80); }
}
// `pidof` exits 1 when nothing matches, and execFileSync THROWS on a non-zero exit -- so a naive
// call reports "ERR" for the perfectly healthy "process is gone" case. That would make the clean
// state assertion meaningless (it must distinguish "empty" from "could not measure").
function pidofApp() {
  try { return String(adb(["shell", "pidof", "xyz.cpyh.dshpush"]) || "").trim(); }
  catch (e) {
    const s = String((e && (e.stdout || e.message)) || "");
    if (/^\s*\d/.test(s)) return s.trim();
    return "";   // exit 1 with no output == no such process == the clean state we want
  }
}
async function requireRoot(tag) {
  let who = whoami();
  if (who === "root") { console.log("ADB_ROOT " + tag + " already=root (forward untouched)"); return; }
  console.log("ADB_ROOT " + tag + " whoami=" + who + " -> adb root");
  try { adb(["root"]); } catch (e) { console.log("ADB_ROOT " + tag + " root-cmd-error " + String(e && e.message).slice(0, 120)); }
  await sleep(3000);
  for (let i = 0; i < 20; i++) {
    who = whoami();
    if (who === "root") { console.log("ADB_ROOT " + tag + " whoami=root after " + (i + 1) + " poll(s)"); return; }
    await sleep(1500);
  }
  throw new Error("BLOCKED: adbd is not root (whoami=" + who + ") - am start .WebActivity is denied (not exported). Remedy: adb root");
}
function shot(name) {
  const remote = `/sdcard/${name}.png`;
  try {
    adb(["shell", "screencap", "-p", remote]);
    adb(["pull", remote, `${OUTDIR}\\${name}.png`]);
    const st = fs.statSync(`${OUTDIR}\\${name}.png`);
    const ok = st.size > 100000;
    console.log("SHOT " + name + " bytes=" + st.size + " ok=" + ok);
    return { name, bytes: st.size, ok, path: `${OUTDIR}\\${name}.png` };
  } catch (e) {
    console.log("SHOT " + name + " FAILED " + String(e && e.message).slice(0, 160));
    return { name, bytes: 0, ok: false, error: String(e && e.message).slice(0, 200) };
  }
}

// ------------------------------------------------------------------ CDP plumbing
let ws = null, id = 0, pending = new Map();
async function connect() {
  await requireRoot("connect");            // MUST precede the forward below (adb root drops forwards)
  const pid = adb(["shell", "pidof", "xyz.cpyh.dshpush"]).trim().split(/\s+/)[0];
  if (!/^\d+$/.test(pid)) throw new Error("app not running (pidof=" + pid + ")");
  try { adb(["forward", "--remove-all"]); } catch {}
  adb(["forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`]);
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.filter((t) => t.type === "page").pop();
  if (!page) throw new Error("no page target");
  if (ws) { try { ws.close(); } catch {} }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  id = 0; pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  });
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", () => rej(new Error("ws error"))); });
  await send("Page.enable"); await send("Runtime.enable");
  return pid;
}
function send(method, params = {}) {
  const i = ++id;
  return new Promise((res, rej) => {
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pending.delete(i)) rej(new Error("timeout " + method)); }, 25000);
  });
}
async function ev(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r && r.exceptionDetails) throw new Error("JS: " + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r && r.result ? r.result.value : undefined;
}
async function evJson(expr) { const v = await ev(expr); try { return JSON.parse(v); } catch { return { raw: v }; } }
async function clickAt(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
const INPUT_VAL = `(()=>{const c=[...document.querySelectorAll('textarea,[contenteditable=true],input[type=text]')].filter(e=>e.offsetHeight>0);
  if(!c.length)return '';const el=c[c.length-1];return (el.value!==undefined?el.value:el.textContent)||'';})()`;

// ------------------------------------------------------------------ in-page probes
// role-first overlay locator (never a CSS-module hash): listbox -> menu -> dialog -> alertdialog
// -> tooltip, else the smallest absolute/fixed container holding >=3 command tokens.
const FIND_OVERLAY = `(()=>{
  const roles=["listbox","menu","dialog","alertdialog","tooltip"];
  let el=null,how="none";
  for(const r of roles){const c=document.querySelector('[role="'+r+'"]');if(c&&c.offsetHeight>0){el=c;how="role="+r;break;}}
  if(!el){
    const TOK=["compact","plan","feedback","model","permission","goal","export"];
    let best=null;
    for(const e of document.querySelectorAll('*')){
      const cs=getComputedStyle(e);
      if(cs.position!=='fixed'&&cs.position!=='absolute')continue;
      if(e.offsetWidth<=0||e.offsetHeight<=0)continue;
      const t=e.textContent||'';let hits=0;for(const k of TOK)if(t.indexOf(k)>=0)hits++;
      if(hits<3)continue;
      const a=e.offsetWidth*e.offsetHeight;
      if(!best||a<best.a)best={a,e};
    }
    if(best){el=best.e;how="token-scan";}
  }
  window.__qaOverlay=el;
  if(!el)return JSON.stringify({found:false});
  const r=el.getBoundingClientRect();
  const items=[...el.querySelectorAll('[role=option],li,button')].filter(b=>b.offsetHeight>0).length;
  return JSON.stringify({found:true,how,tag:el.tagName,cls:(el.className||'').toString().slice(0,120),
    aria:el.getAttribute('aria-label')||'',w:Math.round(r.width),h:Math.round(r.height),
    x:Math.round(r.left),y:Math.round(r.top),items});})()`;

// alpha + geometry of an arbitrary element expression
const ALPHA_OF = (sel) => `(()=>{const e=${sel};if(!e)return JSON.stringify({found:false});
  const cs=getComputedStyle(e);const m=${RGX}.exec(cs.backgroundColor);
  const r=e.getBoundingClientRect();
  return JSON.stringify({found:true,tag:e.tagName,cls:(e.className||'').toString().slice(0,160),id:e.id||'',
    bg:cs.backgroundColor, alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,
    rgb:m?[+m[1],+m[2],+m[3]]:null, position:cs.position, zIndex:cs.zIndex,
    backdrop:(cs.backdropFilter||cs.webkitBackdropFilter||'none'),
    rect:{x:+r.left.toFixed(1),y:+r.top.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)},
    inlineBg:e.style.backgroundColor||'', inlinePriority:(e.style.getPropertyPriority('background-color')||'')});})()`;

// ancestor chain outward from the overlay: catches "outer still 0.45, only inner lit" false passes
const ANCESTORS = `(()=>{const o=[];let e=window.__qaOverlay;
  while(e&&e!==document.documentElement){
    const cs=getComputedStyle(e);const m=${RGX}.exec(cs.backgroundColor);
    if(m||cs.position!=='static'||e.id==='dsh-theme-veil'){
      o.push({tag:e.tagName,cls:(e.className||'').toString().slice(0,90),id:e.id||'',
        bg:cs.backgroundColor,alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,
        position:cs.position,zIndex:cs.zIndex});
    }
    e=e.parentElement;}
  return JSON.stringify(o);})()`;

// A29: sweep every fixed/absolute element, recording alpha and whether the injection touched it
const SWEEP = `(()=>{
  const out=[];
  for(const e of document.querySelectorAll('*')){
    const cs=getComputedStyle(e);
    if(cs.position!=='fixed'&&cs.position!=='absolute')continue;
    if(e.offsetWidth<=0||e.offsetHeight<=0)continue;
    const m=${RGX}.exec(cs.backgroundColor);
    const r=e.getBoundingClientRect();
    out.push({tag:e.tagName,id:e.id||'',cls:(e.className||'').toString().slice(0,110),
      role:e.getAttribute('role')||'', bg:cs.backgroundColor,
      alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null, zIndex:cs.zIndex,
      inlineBg:e.style.backgroundColor||'',
      touched:!!e.style.backgroundColor,
      w:Math.round(r.width),h:Math.round(r.height)});
  }
  return JSON.stringify(out);})()`;

// non-overlay samples that MUST NOT be touched (lead: input card RlGAzG_card stays 0.45)
const NON_OVERLAYS = `(()=>{
  const sel=["[class*='RlGAzG_card']","[class*='BynINW_centerCol']","[class*='BynINW_frame']"];
  const o={};
  for(const s of sel){
    const e=document.querySelector(s);
    if(!e){o[s]=null;continue;}
    const cs=getComputedStyle(e);const m=${RGX}.exec(cs.backgroundColor);
    o[s]={cls:(e.className||'').toString().slice(0,110),bg:cs.backgroundColor,
      alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,inlineBg:e.style.backgroundColor||''};
  }
  return JSON.stringify(o);})()`;

// ------------------------------------------------------------------ main
(async () => {
  const report = { startedAt: new Date().toISOString(), url: URL.replace(/token=[^&]+/, "token=<redacted>"), cases: {}, shots: [] };
  try {
    await requireRoot("startApp");
    try { adb(["shell", "am", "force-stop", "xyz.cpyh.dshpush"]); } catch {}
    await sleep(1500);
    adb(["shell", "am", "start", "-n", "xyz.cpyh.dshpush/.WebActivity", "--es", "url", URL]);
    let pid = "";
    for (let i = 0; i < 30; i++) { try { pid = adb(["shell", "pidof", "xyz.cpyh.dshpush"]).trim().split(/\s+/)[0]; } catch { pid = ""; } if (/^\d+$/.test(pid)) break; await sleep(1000); }
    report.pid = pid;
    console.log("APP_PID " + pid);
    await connect();

    let ready = false;
    for (let i = 0; i < 20; i++) {
      try { ready = !!(await ev("(!!document.querySelector(\"[class*='BynINW_frame']\"))")); } catch { ready = false; }
      if (ready) break; await sleep(2500);
    }
    report.shellReady = ready;
    console.log("SHELL_READY " + ready);
    const pkg = adb(["shell", "dumpsys", "package", "xyz.cpyh.dshpush"]);
    report.versionName = (pkg.split(/\r?\n/).find((l) => l.includes("versionName=")) || "").trim();
    report.versionCode = (pkg.split(/\r?\n/).find((l) => l.includes("versionCode=")) || "").trim();
    console.log("VERSION " + report.versionName + " | " + report.versionCode);
    report.viewport = { innerWidth: await ev("innerWidth"), innerHeight: await ev("innerHeight"), dpr: await ev("devicePixelRatio") };
    console.log("VIEWPORT " + JSON.stringify(report.viewport));

    // ---- QA-P12 baseline (no overlay): wallpaper channel + veil
    report.shots.push(shot("qa-P12-wallpaper"));
    report.cases["QA-P12"] = {
      frame: await evJson(ALPHA_OF(`document.querySelector("[class*='BynINW_frame']")`)),
      centerCol: await evJson(ALPHA_OF(`document.querySelector("[class*='BynINW_centerCol']")`)),
      html: await evJson(ALPHA_OF("document.documentElement")),
      body: await evJson(ALPHA_OF("document.body")),
      veil: await evJson(ALPHA_OF("document.getElementById('dsh-theme-veil')"))
    };
    console.log("P12_veil " + JSON.stringify(report.cases["QA-P12"].veil));

    // ---- open the slash menu.
    // EMPIRICALLY MEASURED ON THIS DEVICE (task-7, see verify/QA-ROUND-v1.32.11.md):
    //   * `adb shell input text "/"`        -> inserts NOTHING (focus already lost)
    //   * `adb shell input keyevent 76`     -> inserts NOTHING
    //   * CDP KeyEvent triple (Slash)       -> inserts NOTHING
    //   * Input.insertText("/")             -> WORKS: editor text becomes "/" and [role=listbox] appears
    // ROOT CAUSE of the failures: a synthesized CDP mouse click on the editor does NOT give it
    // keyboard focus here -- document.activeElement ends up on `SECTION._tabHost_*`, so every
    // subsequent key/IME event goes to nothing. Focusing the editor with el.focus() (no click) and
    // then using Input.insertText is the path that actually works.
    const focus = await evJson(`(()=>{const c=[...document.querySelectorAll('textarea,[contenteditable=true],input[type=text]')].filter(e=>e.offsetHeight>0);
      if(!c.length)return JSON.stringify({ok:false});
      const el=c[c.length-1];el.focus();const r=el.getBoundingClientRect();
      return JSON.stringify({ok:true,x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),
        tag:el.tagName,cls:(el.className||'').toString().slice(0,90),
        activeIsEditor:document.activeElement===el});})()`);
    report.focus = focus;
    console.log("FOCUS " + JSON.stringify(focus));
    const beforeVal = String(await ev(INPUT_VAL) || "");
    await send("Input.insertText", { text: "/" });
    await sleep(1800);
    let afterVal = String(await ev(INPUT_VAL) || "");
    report.imeTyping = { strategy: "focus+insertText", beforeVal: beforeVal.slice(0, 60), afterVal: afterVal.slice(0, 60), inserted: afterVal.length - beforeVal.length };
    console.log("TYPED " + JSON.stringify(report.imeTyping));
    // If that ever stops working, try the device IME once and record which strategy won.
    if (afterVal.length === beforeVal.length) {
      const activeTag = await ev(`(document.activeElement?document.activeElement.tagName+'/'+(document.activeElement.className||''):'none')`);
      report.imeTyping.activeElementAfterInsertText = activeTag;
      adb(["shell", "input", "text", "/"]);
      await sleep(1800);
      afterVal = String(await ev(INPUT_VAL) || "");
      report.imeTyping.fallback = "adb-ime";
      report.imeTyping.afterFallback = afterVal.slice(0, 60);
      console.log("TYPED_FALLBACK " + JSON.stringify(report.imeTyping));
    }

    // ---- QA-P11: overlay opacity
    const desc = await ev(FIND_OVERLAY);
    const found = !!desc && desc !== '{"found":false}';
    report.overlayDesc = desc;
    console.log("OVERLAY " + desc);
    if (found) {
      report.cases["QA-P11"] = {
        overlay: await evJson(ALPHA_OF("window.__qaOverlay")),
        ancestors: await evJson(ANCESTORS),
        // the outer visual surface the user sees (.Z9Jnlq_menu) + the listbox viewport
        surfaceAbs: await evJson(ALPHA_OF(`document.querySelector("[class*='Z9Jnlq_menu']")`)),
        listbox: await evJson(ALPHA_OF(`document.querySelector('[role=listbox]')`))
      };
      report.shots.push(shot("qa-P11-slash-menu"));
      // A29 sweep at the same moment the overlay is up
      report.cases["QA-A29"] = { sweep: await evJson(SWEEP), overlayFound: true };
      report.cases["QA-A29b-nonoverlays"] = await evJson(NON_OVERLAYS);
      report.shots.push(shot("qa-A29-fixed-sweep"));

      // ---- QA-C11: real click on a NON-file option (avoid opening the system file picker)
      //      the file entry is matched by its ASCII hint only; this file stays pure ASCII so the
      //      scp->laptop hop can never mangle it (same reason .ps1 files are ASCII-only)
      const opt = await evJson(`(()=>{
        const list=[...document.querySelectorAll('[role=option],button')].filter(b=>b.offsetHeight>0&&b.offsetWidth>0);
        const mine=list.filter(b=>{const t=(b.textContent||'').toLowerCase();
          return /model|plan|compact|feedback|goal|permission|export/.test(t)&&!/file|attach/.test(t);});
        const pick=mine[0]||null;
        if(!pick)return JSON.stringify({ok:false,available:list.slice(0,16).map(b=>(b.textContent||'').trim().slice(0,24))});
        const r=pick.getBoundingClientRect();
        return JSON.stringify({ok:true,x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),
          text:(pick.textContent||'').trim().slice(0,40),role:pick.getAttribute('role')||''});})()`);
      report.c11 = { option: opt, inputBefore: afterVal.slice(0, 60) };
      console.log("C11_OPTION " + JSON.stringify(opt));
      if (opt.ok) {
        await clickAt(opt.x, opt.y);
        await sleep(1800);
        report.c11.inputAfter = String(await ev(INPUT_VAL) || "").slice(0, 60);
        report.c11.menuStillOpen = !!(await ev(`(!!document.querySelector('[role=listbox],[role=menu]'))`));
        report.shots.push(shot("qa-C11-menu-clicked"));
      }
      // ---- QA-C11: scroll the overlay to the bottom
      report.c11.scroll = await evJson(`(()=>{const el=window.__qaOverlay;if(!el)return JSON.stringify({ok:false});
        const before=el.scrollTop;el.scrollTop=el.scrollHeight;
        const r=el.getBoundingClientRect();
        const items=[...el.querySelectorAll('[role=option],li,button')].filter(b=>b.offsetHeight>0);
        const last=items[items.length-1];
        const lr=last?last.getBoundingClientRect():null;
        const visible=lr?(lr.top>=r.top-2&&lr.bottom<=r.bottom+2):false;
        return JSON.stringify({ok:true,scrollTopBefore:before,scrollTopAfter:el.scrollTop,
          scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,itemCount:items.length,
          lastItemText:last?(last.textContent||'').trim().slice(0,30):'',lastItemFullyVisible:visible});})()`);
      report.shots.push(shot("qa-C11-menu-scrolled"));
    } else {
      report.cases["QA-P11"] = { BLOCKED: "slash menu overlay NOT found (overlayDesc=" + desc + ", ime=" + JSON.stringify(report.imeTyping) + ")" };
      report.shots.push(shot("qa-P11-slash-menu-NOTFOUND"));
    }

    // close the overlay, then QA-P13 sidebar (collapsed baseline first, then expand)
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(900);
    const SIDEBAR = `document.querySelector("[class*='_2H3hWW_root']")`;
    const SIDEBAR_STATE = `(()=>{const e=${SIDEBAR};if(!e)return JSON.stringify({found:false});
      const r=e.getBoundingClientRect();const cn=(e.className||'').toString();
      return JSON.stringify({cls:cn,collapsed:cn.indexOf('_2H3hWW_collapsed')>=0,
        width:+r.width.toFixed(1),position:getComputedStyle(e).position});})()`;
    report.cases["QA-P13"] = { collapsed: await evJson(SIDEBAR_STATE), collapsedAlpha: await evJson(ALPHA_OF(SIDEBAR)) };
    console.log("P13_collapsed " + JSON.stringify(report.cases["QA-P13"].collapsed));

    // TESTER.md discipline: verify WHAT the click will actually hit before clicking.
    const openBtn = await evJson(`(()=>{
      const byLabel=[...document.querySelectorAll('button,[role=button]')].find(b=>/open sidebar|expand/i.test(b.getAttribute('aria-label')||b.title||''));
      if(!byLabel)return JSON.stringify({ok:false});
      const r=byLabel.getBoundingClientRect();
      const x=Math.round(r.left+r.width/2), y=Math.round(r.top+r.height/2);
      const hit=document.elementFromPoint(x,y);
      const owner=hit?((hit.closest&&hit.closest('button,[role=button]'))||hit):null;
      return JSON.stringify({ok:true,x,y,label:byLabel.getAttribute('aria-label')||'',
        rect:{x:+r.left.toFixed(1),y:+r.top.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)},
        hitTag:hit?hit.tagName:'none',hitCls:hit?(hit.className||'').toString().slice(0,60):'',
        ownerIsTarget: owner===byLabel});})()`);
    report.p13open = openBtn;
    console.log("P13_openBtn " + JSON.stringify(openBtn));
    const expanded = async () => { const s = await evJson(SIDEBAR_STATE); return !s.found || !s.collapsed; };
    let strategy = "none";
    if (openBtn.ok) {
      await clickAt(openBtn.x, openBtn.y);
      await sleep(2500);
      if (await expanded()) strategy = "cdp-input-click";
      if (strategy === "none") {
        // fallback: JS-dispatched click (gate-shot.ps1 uses this same fallback shape)
        await ev(`(()=>{const b=[...document.querySelectorAll('button,[role=button]')].find(x=>/open sidebar|expand/i.test(x.getAttribute('aria-label')||x.title||''));
          if(b)b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));})()`);
        await sleep(2500);
        if (await expanded()) strategy = "js-dispatch-click";
      }
    }
    report.cases["QA-P13"].openStrategy = strategy;
    report.cases["QA-P13"].expandedState = await evJson(SIDEBAR_STATE);
    report.cases["QA-P13"].sidebar = await evJson(ALPHA_OF(SIDEBAR));
    console.log("P13_sidebar " + JSON.stringify(report.cases["QA-P13"].sidebar) + " strategy=" + strategy);
    report.shots.push(shot("qa-P13-sidebar-expanded"));
    report.finishedAt = new Date().toISOString();
  } catch (e) {
    report.fatal = String((e && e.message) || e).slice(0, 500);
    console.log("FATAL " + report.fatal);
  } finally {
    try { adb(["shell", "am", "force-stop", "xyz.cpyh.dshpush"]); } catch {}
    try { adb(["forward", "--remove-all"]); } catch {}
    report.deviceClean = {
      whoami: whoami(),
      pidof: pidofApp(),
      forwards: (() => { try { return String(adb(["forward", "--list"]) || "").trim(); } catch { return "ERR"; } })()
    };
    fs.writeFileSync(`${OUTDIR}\\overlay-report.json`, JSON.stringify(report, null, 2), "utf8");
    console.log("REPORT " + OUTDIR + "\\overlay-report.json");
    console.log("DEVICE_CLEAN whoami=" + report.deviceClean.whoami + " pidof='" + report.deviceClean.pidof + "' forwards='" + report.deviceClean.forwards + "'");
    process.exit(0);
  }
})();
