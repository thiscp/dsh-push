// qa-round-driver.mjs - QA round driver. RUNS ON THE EMULATOR HOST (the laptop), because adb
// forwards are host-local. Drives each case with real CDP input for taps inside the page and
// captures every piece of visual evidence with `adb screencap` + `adb pull` (never CDP
// screenshots: they cannot see the native wallpaper layer). A DOM re-check is bound to each
// screenshot. Reports are timestamped so consecutive runs cannot overwrite each other.
// Invoked by verify/qa-round.ps1; see verify/TESTER.md for the discipline.
//
// usage: node qa-round-driver.mjs <dsh-web-url> <comma,separated,case,ids>
// writes: G:\Android\qa\<caseid>-*.png and G:\Android\qa\qa-report-<timestamp>.json
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const ADB = "G:\\Android\\Sdk\\platform-tools\\adb.exe";
const OUTDIR = "G:\\Android\\qa";
// report file is timestamped: two runs in one day must never overwrite each other
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const REPORT = "qa-report-" + STAMP + ".json";
const URL = process.argv[2];
// a comma-separated list, not JSON: nested quotes get eaten by cmd/ssh/PowerShell layers
const CASES = (process.argv[3] || "").split(",").map((x) => x.trim()).filter(Boolean);
const PORT = "9225";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(OUTDIR, { recursive: true });
function adb(args, opts = {}) {
  return execFileSync(ADB, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, ...opts });
}
function sh(cmd) { return adb(["shell", ...cmd.split(" ")]); }
function shot(name) {
  const remote = `/sdcard/${name}.png`;
  try {
    adb(["shell", "screencap", "-p", remote]);
    adb(["pull", remote, `${OUTDIR}\\${name}.png`]);
    const st = fs.statSync(`${OUTDIR}\\${name}.png`);
    return { ok: st.size > 100000, bytes: st.size, path: `${OUTDIR}\\${name}.png` };
  } catch (e) {
    return { ok: false, bytes: 0, error: String(e.message).slice(0, 200) };
  }
}

let ws = null, id = 0, pending = new Map(), lastState = null;

async function connect() {
  // H-1: root must be re-established BEFORE the forward below (adb root drops existing forwards).
  await requireRoot("connect");
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
  if (r.exceptionDetails) throw new Error("JS: " + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 300));
  return r.result?.value;
}
async function tap(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1 });
  await sleep(80);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0 });
}
async function wheel(x, y, dy) {
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: dy });
}

// ---- page helpers (all selectors use [class*=] so CSS-module hashes can change) ----
const SHELL = "!!document.querySelector(\"[class*='BynINW_frame']\")";
async function waitShell(maxMs = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try { if (await ev(SHELL)) return true; } catch {}
    await sleep(1000);
  }
  return false;
}
async function reloadAndWait() {
  try { await send("Page.navigate", { url: URL }); } catch {}
  await sleep(1500);
  return waitShell();
}
async function panelState() {
  return await ev(`(()=>{const sb=document.querySelector("[class*='_2H3hWW_root']");if(!sb)return null;
    const cs=getComputedStyle(sb),r=sb.getBoundingClientRect();
    const cls=(sb.className||"").toString();
    return JSON.stringify({collapsed:cls.includes('_2H3hWW_collapsed'),position:cs.position,width:+r.width.toFixed(1),
      left:+r.left.toFixed(1),right:+r.right.toFixed(1),bg:cs.backgroundColor,shadow:cs.boxShadow.slice(0,40),
      visibleW:+Math.max(0,Math.min(r.right,innerWidth)-Math.max(r.left,0)).toFixed(1),
      patchCount:document.querySelectorAll('#bw-narrow-fix').length,innerWidth:innerWidth});})()`);
}
async function toggleTap(expand) {
  const res = await ev(`(()=>{const sb=document.querySelector("[class*='_2H3hWW_root']");if(!sb)return JSON.stringify({error:'no sidebar'});
    const collapsed=(sb.className||'').toString().includes('_2H3hWW_collapsed');
    if(collapsed===${expand ? "false" : "true"})return JSON.stringify({already:true});
    const want=${expand ? "'Open sidebar'" : "'Collapse sidebar'"};
    const b=[...document.querySelectorAll('button,[role=button]')].find(x=>(x.getAttribute('aria-label')||'').includes(want));
    if(!b)return JSON.stringify({error:'no toggle'});
    const r=b.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2,label:b.getAttribute('aria-label')});})()`);
  const t = JSON.parse(res);
  if (t.error || t.already) return t;
  await tap(t.x, t.y);
  await sleep(1800);
  return { tapped: t };
}
async function contentTap() {
  const res = await ev(`(()=>{const g=(s)=>document.querySelector(s);
    const cc=g("[class*='BynINW_centerCol']"),sb=g("[class*='_2H3hWW_root']");
    if(!cc||!sb)return JSON.stringify({error:'missing'});
    const r=cc.getBoundingClientRect(),pr=sb.getBoundingClientRect();
    const x=pr.right<innerWidth-20?(pr.right+innerWidth)/2:r.x+r.width/2;
    return JSON.stringify({x:x,y:r.y+180});})()`);
  const t = JSON.parse(res);
  if (t.error) return t;
  await tap(t.x, t.y);
  await sleep(1800);
  return { tapped: t };
}
async function bigContainerBgs() {
  return await ev(`(()=>{const o={};for(const k of ['BynINW_frame','BynINW_centerCol']){const e=document.querySelector("[class*='"+k+"']");o[k]=e?getComputedStyle(e).backgroundColor:null;}
    const chat=document.querySelector("[class*='BynINW_centerCol'] > div");o.chatChild=chat?getComputedStyle(chat).backgroundColor:null;
    o.veil=!!document.getElementById('dsh-theme-veil');return JSON.stringify(o);})()`);
}
async function hitAreas() {
  return await ev(`(()=>{const out=[];const bs=document.querySelectorAll("button,[role=button]");
    for(const b of bs){const r=b.getBoundingClientRect();if(r.width===0||r.height===0)continue;
      const l=(b.getAttribute('aria-label')||b.textContent||'').trim().slice(0,24);
      out.push({label:l,w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.x),y:Math.round(r.y)});}
    return JSON.stringify(out.slice(0,25));})()`);
}

// ---- device state helpers ----
function setFontScale(v) { sh(`settings put system font_scale ${v}`); }
function setNight(on) { sh(`cmd uimode night ${on ? "yes" : "no"}`); }
function setAirplane(on) { sh(`cmd connectivity airplane-mode ${on ? "enable" : "disable"}`); }
function setSize(v) { sh(`wm size ${v}`); }
function keyBack() { sh("input keyevent KEYCODE_BACK"); }
function focusInfo() { return sh("dumpsys window").split(/\r?\n/).filter((l) => /mCurrentFocus/.test(l)).join(" | ").trim(); }

const report = [];
function writeReport(meta) {
  try { fs.writeFileSync(OUTDIR + "\\" + REPORT, JSON.stringify({ meta, report }, null, 2), "utf8"); } catch (e) {}
}
process.on("uncaughtException", (e) => { console.log("UNCAUGHT " + String(e && e.message).slice(0, 200)); });
process.on("unhandledRejection", (e) => { console.log("UNHANDLED " + String(e && e.message).slice(0, 200)); });

// A case that "ran" while measuring nothing is NOT a pass: on 2026-10-13 a focused run reported
// RAN with identical screenshots and null DOM because the WebView was sitting on a stale
// auth/error page. Assertions below turn that into BLOCKED, and every case must first prove the
// page really is the DSH shell.
function assertOk(cond, msg) { if (!cond) throw new Error("ASSERT: " + msg); }

// H-1 fix (2026-10-14, task-4). `am start -n xyz.cpyh.dshpush/.WebActivity` requires adbd to be
// ROOT: the Activity is not exported, so a non-root shell (uid 2000) gets
//   SecurityException: Permission Denial: starting Intent { ... WebActivity ... } from null
//   (pid=.., uid=2000) not exported from uid 10216
// adbd drops back to non-root after an emulator restart (README "adb and APP data"), and the
// hardened self-heal can restart the emulator on a CPU-render violation -> this is no longer a
// rare corner. Re-establish root before EVERY WebActivity launch.
// ORDER IS LOAD-BEARING: `adb root` restarts the adb server and drops every existing forward, so
// this MUST run before any `adb forward` (see connect(), which builds the CDP forward).
// Same pattern as verify/card-layout-verify.ps1:220.
function whoami() {
  // bounded: a wedged guest must not hang the whole round (TESTER.md: every remote action gets a deadline)
  try { return String(adb(["shell", "whoami"], { timeout: 15000 }) || "").trim(); }
  catch (e) { return "ERR:" + String(e && e.message).slice(0, 80); }
}
async function requireRoot(tag) {
  let who = whoami();
  if (who === "root") { console.log("ADB_ROOT " + tag + " already=root (forward untouched)"); return; }
  console.log("ADB_ROOT " + tag + " whoami=" + who + " -> adb root");
  try { adb(["root"], { timeout: 30000 }); }
  catch (e) { console.log("ADB_ROOT " + tag + " root-cmd-error " + String(e && e.message).slice(0, 120)); }
  await sleep(3000);
  for (let i = 0; i < 20; i++) {
    who = whoami();
    if (who === "root") { console.log("ADB_ROOT " + tag + " whoami=root after " + (i + 1) + " poll(s)"); return; }
    await sleep(1500);
  }
  // fail closed: never keep going and let a case report "ran" while measuring nothing
  throw new Error("BLOCKED: adbd is not root (whoami=" + who + ") - am start .WebActivity is denied (not exported). Remedy: adb root");
}

async function startApp(url) {
  await requireRoot("startApp");   // must precede connect()'s adb forward
  try { adb(["shell", "am", "force-stop", "xyz.cpyh.dshpush"]); } catch {}
  await sleep(2000);
  adb(["shell", "am", "start", "-n", "xyz.cpyh.dshpush/.WebActivity", "--es", "url", url]);
  let pid = "";
  for (let i = 0; i < 30; i++) {
    try { pid = adb(["shell", "pidof", "xyz.cpyh.dshpush"]).trim().split(/\s+/)[0]; } catch { pid = ""; }
    if (/^\d+$/.test(pid)) break;
    await sleep(1000);   // must await: a bare sleep() spins the loop with no delay
  }
  return pid;
}
async function pageInfo() {
  try {
    const t = await ev("document.title");
    const h = await ev("location.href");
    return { title: t, href: String(h).replace(/token=[^&]+/, "token=<redacted>") };
  } catch (e) { return { title: "?", href: "?", error: String(e.message).slice(0, 120) }; }
}
async function ensureShell(tag) {
  for (let i = 0; i < 3; i++) {
    try {
      if (!ws || ws.readyState !== 1) await connect();
      if (await ev(SHELL)) return true;
      await reloadAndWait();
      if (await ev(SHELL)) return true;
    } catch (e) { try { await connect(); } catch {} }
    await sleep(2000);
  }
  console.log("NO_SHELL[" + tag + "] " + JSON.stringify(await pageInfo()));
  return false;
}

async function runCase(c) {
  const rec = { id: c.id, title: c.title, shots: [], dom: null, notes: [], result: "BLOCKED", error: null };
  const t0 = Date.now();
  try {
    const shellOk = await ensureShell(c.id);
    assertOk(shellOk, "page is not the DSH shell (stale auth/error page?) - see NO_SHELL log line");
    await Promise.race([
      c.fn(rec).then((notes) => rec.notes.push(...notes)),
      new Promise((_, rej) => setTimeout(() => rej(new Error("case watchdog 150s")), 150000)),
    ]);
    rec.result = "RAN";
  } catch (e) {
    rec.error = String(e.message).slice(0, 300);
    rec.result = "BLOCKED";
  }
  rec.ms = Date.now() - t0;
  report.push(rec);
  if (global.__meta) writeReport(global.__meta);
  console.log(`[${rec.result}] ${rec.id} ${rec.title} (${rec.ms}ms)` + (rec.error ? " :: " + rec.error : ""));
  return rec;
}

const CASES_IMPL = {
  // QA-C05: expand -> check -> tap outside -> check (the round's baseline)
  "QA-C05": async (rec) => {
    await toggleTap(true);
    rec.dom = { expanded: JSON.parse(await panelState()) };
    assertOk(rec.dom.expanded && rec.dom.expanded.width === 280, "expanded panel did not measure 280px: " + JSON.stringify(rec.dom.expanded));
    rec.shots.push(shot("qa-C05-expanded"));
    rec.dom.bigBgs = JSON.parse(await bigContainerBgs());
    await contentTap();
    rec.dom.afterOutsideTap = JSON.parse(await panelState());
    assertOk(rec.dom.afterOutsideTap && rec.dom.afterOutsideTap.collapsed === true, "tapping outside did not collapse the panel: " + JSON.stringify(rec.dom.afterOutsideTap));
    assertOk(rec.shots.every((s) => s.ok), "a screenshot was smaller than 100KB (failed capture)");
    rec.shots.push(shot("qa-C05-collapsed"));
    assertOk(rec.shots.every((s) => s.ok), "a screenshot was smaller than 100KB (failed capture)");
    return ["expand+outside-tap collapse"];
  },
  // QA-A01: 10 rapid toggles
  "QA-A01": async (rec) => {
    const states = [];
    for (let i = 0; i < 10; i++) {
      await toggleTap(i % 2 === 0);
      states.push(JSON.parse(await panelState()).collapsed);
      await sleep(120);
    }
    await sleep(2500);
    const s = JSON.parse(await panelState());
    rec.dom = { last10: states, final: s };
    rec.shots.push(shot("qa-A01-rapid"));
    await toggleTap(true); await sleep(1200);
    rec.dom.afterExtraToggle = JSON.parse(await panelState());
    rec.shots.push(shot("qa-A01-after-toggle"));
    return ["10 rapid toggles; states=" + states.join(",")];
  },
  // QA-A02: tap the sidebar while the page is still loading
  "QA-A02": async (rec) => {
    await requireRoot("QA-A02");   // this case relaunches WebActivity directly
    adb(["shell", "am", "force-stop", "xyz.cpyh.dshpush"]);
    await sleep(1500);
    adb(["shell", "am", "start", "-n", "xyz.cpyh.dshpush/.WebActivity", "--es", "url", URL]);
    let tappedAt = null;
    const t0 = Date.now();
    for (let i = 0; i < 40; i++) {
      try {
        if (!ws || ws.readyState !== 1) await connect();
        const r = await toggleTap(true);
        if (r.tapped || r.already) { tappedAt = Date.now() - t0; break; }
      } catch (e) {
        try { await connect(); } catch {}
      }
      await sleep(250);
    }
    const ready = await waitShell(30000);
    await sleep(3000);
    rec.dom = { tappedAtMs: tappedAt, shellReady: ready, state: JSON.parse(await panelState()) };
    rec.shots.push(shot("qa-A02-early-tap"));
    return ["tap during load at " + tappedAt + "ms"];
  },
  // QA-A06: font scale regression (1.0 daily / 1.3 / 1.5) + the F1 numbers v1.32.7 targets:
  // title must shrink, timestamp pinned with a real gap, last row clear of the Settings footer.
  "QA-A06": async (rec) => {
    const out = {};
    for (const v of ["1.0", "1.3", "1.5"]) {
      setFontScale(v);
      await sleep(2500);
      try { await connect(); } catch {}
      try { await reloadAndWait(); } catch {}
      try { await connect(); } catch {}
      await toggleTap(true);
      await sleep(1200);
      const key = "font" + v.replace(".", "");
      out[key] = JSON.parse(await panelState());
      out["f1_" + key] = JSON.parse(await ev(`(()=>{
        const q=(s)=>document.querySelector("[class*='"+s+"']");
        const rect=(e)=>{if(!e)return null;const r=e.getBoundingClientRect();return {x:+r.x.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1),right:+r.right.toFixed(1),bottom:+r.bottom.toFixed(1)};};
        const cs=(e)=>e?getComputedStyle(e):null;
        const titles=[...document.querySelectorAll("[class*='hIlkoa_title']")];
        const times=[...document.querySelectorAll("[class*='hIlkoa_time']")];
        const pairs=[];
        for(let i=0;i<Math.min(titles.length,times.length,6);i++){
          const tr=titles[i].getBoundingClientRect(), mr=times[i].getBoundingClientRect();
          pairs.push({text:(titles[i].textContent||'').trim().slice(0,18),titleW:+tr.width.toFixed(1),
            titleRight:+tr.right.toFixed(1),timeLeft:+mr.left.toFixed(1),gap:+(mr.left-tr.right).toFixed(1),
            overlap:+(tr.right-mr.left).toFixed(1)});
        }
        const listCands=[...document.querySelectorAll("[class*='_9lTDKa_list']")];
        const scroller=listCands.find(e=>e.scrollHeight>e.clientHeight+2)||listCands[0]||null;
        const scrollBefore=scroller?+scroller.scrollTop.toFixed(1):null;
        if(scroller)scroller.scrollTop=scroller.scrollHeight;
        const list=scroller;
        const lastRow=titles.length?titles[titles.length-1].closest("button,[role=button],li,div[class*='hIlkoa']"):null;
        const settings=[...document.querySelectorAll("button,[role=button],[class*='hIlkoa'] *")].find(e=>/^Settings$/i.test((e.textContent||'').trim()));
        const lr=lastRow?lastRow.getBoundingClientRect():null, sr=settings?settings.getBoundingClientRect():null;
        return JSON.stringify({
          titleCount:titles.length,
          titleMinWidth:cs(titles[0])?cs(titles[0]).minWidth:null,
          titleShrink:cs(titles[0])?cs(titles[0]).flexShrink:null,
          timeShrink:cs(times[0])?cs(times[0]).flexShrink:null,
          timeMarginLeft:cs(times[0])?cs(times[0]).marginLeft:null,
          listPadBottom:cs(list)?cs(list).paddingBottom:null,
          listScrollH:list?list.scrollHeight:null, listClientH:list?list.clientHeight:null,
          pairs:pairs,
          lastRowBottom:lr?+lr.bottom.toFixed(1):null,
          settingsTop:sr?+sr.top.toFixed(1):null,
          lastRowVsSettings:lr&&sr?+(lr.bottom-sr.top).toFixed(1):null,
          listCandidates:listCands.length,
          scrollTopBefore:scrollBefore,
          scrollTopAfter:scroller?+scroller.scrollTop.toFixed(1):null});})()`));
      rec.shots.push(shot("qa-A06-font" + v.replace(".", "")));
    }
    setFontScale("1.0");
    await sleep(1500);
    rec.dom = out;
    assertOk(out.f1_font10 && out.f1_font15, "F1 numbers missing for font 1.0/1.5");
    rec.dom.f1Clearance = { "1.0": out.f1_font10.lastRowVsSettings, "1.3": out.f1_font13.lastRowVsSettings, "1.5": out.f1_font15.lastRowVsSettings };
    return ["font 1.0/1.3/1.5 with F1 numbers (title/time/gap/list); font_scale reset to 1.0"];
  },
  // QA-A07: dark system theme (wallpaper/glass readability)
  "QA-A07": async (rec) => {
    setNight(true);
    await sleep(2500);
    const shellOk = await (async () => { try { return await reloadAndWait(); } catch { return false; } })();
    if (!shellOk) { try { await connect(); await reloadAndWait(); } catch {} }
    await toggleTap(true);
    rec.dom = { night: JSON.parse(await panelState()), bigBgs: JSON.parse(await bigContainerBgs()), bodyColor: await ev("getComputedStyle(document.body).color"), shellOk };
    rec.shots.push(shot("qa-A07-dark"));
    setNight(false);
    await sleep(2500);
    return ["dark captured; uimode reset to no"];
  },
  // QA-A08: airplane mode -> offline -> restore
  "QA-A08": async (rec) => {
    setAirplane(true);
    await sleep(6000);
    rec.shots.push(shot("qa-A08-offline"));
    rec.dom = { offline: { title: await ev("document.title"), href: await ev("location.href"), shell: await ev(SHELL), bodyText: (await ev("document.body.innerText"))?.slice(0, 200) } };
    setAirplane(false);
    let shellBack = false;
    for (let i = 0; i < 8 && !shellBack; i++) { await sleep(3000); try { shellBack = await ev(SHELL); } catch { try { await connect(); } catch {} } }
    if (!shellBack) { try { const p = await connect(); shellBack = await reloadAndWait(); } catch {} }
    rec.dom.online = { shell: shellBack, patchCount: (await ev("document.querySelectorAll('#bw-narrow-fix').length")) };
    rec.shots.push(shot("qa-A08-back"));
    return ["airplane on -> off; shellBack=" + shellBack];
  },
  // QA-A10: very narrow viewport
  "QA-A10": async (rec) => {
    setSize("800x1200");
    await sleep(3000);
    let ok = false;
    try { ok = await reloadAndWait(); } catch { try { await connect(); ok = await reloadAndWait(); } catch {} }
    await toggleTap(true);
    rec.dom = { shellOk: ok, state: JSON.parse(await panelState()) };
    rec.shots.push(shot("qa-A10-narrow"));
    setSize("reset");
    await sleep(3000);
    return ["wm size 800x1200 captured; size reset"];
  },
  // QA-A11: back key twice
  "QA-A11": async (rec) => {
    const before = focusInfo();
    keyBack(); await sleep(1500);
    const mid = { focus: focusInfo(), pid: adb(["shell", "pidof", "xyz.cpyh.dshpush"]).trim() };
    keyBack(); await sleep(2000);
    const after = { focus: focusInfo(), pid: adb(["shell", "pidof", "xyz.cpyh.dshpush"]).trim() };
    rec.shots.push(shot("qa-A11-back"));
    rec.dom = { before, mid, after };
    return ["back x2"];
  },
  // QA-A12: scroll the panel to the bottom
  "QA-A12": async (rec) => {
    try { if (!ws || ws.readyState !== 1) await connect(); } catch {}
    await toggleTap(true);
    const beforeScroll = await ev(`(()=>{const sb=document.querySelector("[class*='_2H3hWW_root']");return JSON.stringify({sbTop:sb.scrollTop,sbH:sb.scrollHeight,sbClient:sb.clientHeight});})()`);
    for (let i = 0; i < 6; i++) { await wheel(140, 500, 400); await sleep(300); }
    await sleep(800);
    const afterScroll = await ev(`(()=>{const sb=document.querySelector("[class*='_2H3hWW_root']");
      const cc=document.querySelector("[class*='BynINW_centerCol']");
      const sc=cc?[...cc.querySelectorAll('*')].map(e=>e.scrollTop).filter(v=>v>0).length:null;
      return JSON.stringify({sbTop:+sb.scrollTop.toFixed(1),sbH:sb.scrollHeight,sbClient:sb.clientHeight,innerScrolledEls:sc});})()`);
    rec.dom = { beforeScroll: JSON.parse(beforeScroll), afterScroll: JSON.parse(afterScroll) };
    rec.shots.push(shot("qa-A12-scroll"));
    return ["panel scrolled to bottom"];
  },
  // QA-A14 (v1.32.7): the 40px hit areas are built as enlarge + equal NEGATIVE margin, so the
  // margin boxes of neighbours now overlap. For each of the seven buttons compare the box the
  // user sees (its icon) with the box that receives the tap, then fire REAL input at the risky
  // points to see which button actually gets it. A capture-phase spy stops propagation, so the
  // real hit test runs without changing any app state.
  "QA-A14": async (rec) => {
    await toggleTap(true);
    await sleep(1000);
    const SEL = "[class*='_2H3hWW_iconButton'],[class*='_9lTDKa_searchButton'],[class*='_9lTDKa_iconButton'],[class*='EBLgjq_trigger'],[class*='WgQWqa_main'],[class*='WgQWqa_chevron']";
    const analysis = await ev(`(()=>{
      const SEL=${JSON.stringify(SEL)};
      const label=(e)=>{if(!e)return null;const b=e.closest?e.closest("button,[role=button]"):null;
        const t=b||e;return ((t.getAttribute&&(t.getAttribute('aria-label')||t.textContent))||'').trim().slice(0,24)||t.className||t.tagName;};
      const ownLabel=(e)=>e?((e.getAttribute&&e.getAttribute('aria-label'))||e.textContent||'').trim().slice(0,24):null;
      const els=[...document.querySelectorAll(SEL)].filter((e)=>{const r=e.getBoundingClientRect();return r.width>1&&r.height>1;});
      const items=els.map((e,i)=>{
        const r=e.getBoundingClientRect();
        const icon=e.querySelector('svg,img')||e;
        const ir=icon.getBoundingClientRect();
        const cs=getComputedStyle(e);
        return {i,label:ownLabel(e),hit:{x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1),right:+r.right.toFixed(1),bottom:+r.bottom.toFixed(1)},
          visual:{x:+ir.x.toFixed(1),y:+ir.y.toFixed(1),w:+ir.width.toFixed(1),h:+ir.height.toFixed(1),right:+ir.right.toFixed(1),bottom:+ir.bottom.toFixed(1)},
          margin:cs.margin,pad:cs.padding};
      });
      const probes=[];
      const push=(it,at,x,y)=>{
        const el=document.elementFromPoint(x,y);
        const owner=el?(el.closest&&el.closest(SEL))||null:null;
        const ownerLabel=ownLabel(owner);
        probes.push({target:it.label,at,x:+x.toFixed(1),y:+y.toFixed(1),
          owner:ownerLabel, ownerIsTarget: ownerLabel===it.label});
      };
      for(const it of items){
        const v=it.visual,h=it.hit,cy=(v.y+v.bottom)/2;
        const pts=[["center",(v.x+v.right)/2,cy],["leftEdge",v.x+1,cy],["rightEdge",v.right-1,cy],["topEdge",(v.x+v.right)/2,v.y+1],["bottomEdge",(v.x+v.right)/2,v.bottom-1],
                   ["hitLeft",h.x+0.5,cy],["hitRight",h.right-0.5,cy]];
        for(const [at,x,y] of pts) push(it,at,x,y);
      }
      // ABUTMENT probes: for every close/touching pair sample the shared edge and +/-1/+/-2px.
      // Rule: inside the +/-2px band either button may win; outside it the owner must be the
      // button whose side the point is on (a real mis-trigger otherwise).
      const abut=[];
      for(let a=0;a<items.length;a++)for(let b=0;b<items.length;b++){
        if(a===b)continue;
        const A=items[a].hit,B=items[b].hit;
        const oy=Math.min(A.bottom,B.bottom)-Math.max(A.y,B.y);
        if(oy<=4)continue;
        const gap=+(B.x-A.right).toFixed(2);
        if(gap>8||gap<-8)continue;
        const edge=B.x;
        const cy=(Math.max(A.y,B.y)+Math.min(A.bottom,B.bottom))/2;
        const rows=[];
        for(const d of [-2,-1,0,1,2]){
          const x=edge+d;
          const el=document.elementFromPoint(x,cy);
          const owner=el?(el.closest&&el.closest(SEL))||null:null;
          rows.push({d,x:+x.toFixed(1),owner:ownLabel(owner)});
        }
        const leftOk=rows.filter((r)=>r.d<-2).every((r)=>r.owner===items[a].label);
        const rightOk=rows.filter((r)=>r.d>2).every((r)=>r.owner===items[b].label);
        abut.push({a:items[a].label,b:items[b].label,gap:gap,edgeX:+edge.toFixed(1),rows:rows,outsideBandOk:leftOk&&rightOk});
      }
      // pairwise overlap of the enlarged hit boxes (what the negative margins bought us)
      const overlaps=[];
      for(let a=0;a<items.length;a++)for(let b=a+1;b<items.length;b++){
        const A=items[a].hit,B=items[b].hit;
        const ox=Math.max(0,Math.min(A.right,B.right)-Math.max(A.x,B.x));
        const oy=Math.max(0,Math.min(A.bottom,B.bottom)-Math.max(A.y,B.y));
        if(ox>0&&oy>0)overlaps.push({a:items[a].label,b:items[b].label,overlapW:+ox.toFixed(1),overlapH:+oy.toFixed(1),area:+(ox*oy).toFixed(1)});
      }
      return JSON.stringify({count:items.length,items,probes,overlaps,abut});
    })()`);
    rec.dom = JSON.parse(analysis);
    // Targets whose visual centre sits under the expanded 280px overlay panel are EXPECTED not to
    // receive the tap (upstream overlay design, same as v1.32.6): record them, do not fail on them.
    const panelRect = JSON.parse(await ev(`(()=>{const sb=document.querySelector("[class*='_2H3hWW_root']");if(!sb)return "null";const r=sb.getBoundingClientRect();
      const cs=getComputedStyle(sb);return JSON.stringify({x:+r.x.toFixed(1),right:+r.right.toFixed(1),collapsed:(sb.className||'').toString().includes('_2H3hWW_collapsed')||cs.position!=="fixed"});})()`));
    const covered = (label) => {
      const it = rec.dom.items.find((i) => i.label === label);
      if (!it || !panelRect || panelRect.collapsed) return false;
      const cx = (it.visual.x + it.visual.right) / 2;
      return cx < panelRect.right;
    };
    const centresOff = rec.dom.probes.filter((x) => x.at === "center" && !x.ownerIsTarget);
    const centresOffExpected = centresOff.filter((x) => covered(x.target));
    const centresOffReal = centresOff.filter((x) => !covered(x.target));
    rec.dom.centreSelfHit = { all: centresOffReal.length === 0, offenders: centresOffReal.map((x) => x.target + "->" + x.owner),
      coveredByPanelExpected: centresOffExpected.map((x) => x.target + "->" + x.owner) };
    const abutBad = (rec.dom.abut || []).filter((x) => !x.outsideBandOk);
    rec.dom.abutmentOk = { all: abutBad.length === 0, bad: abutBad.map((x) => x.a + "|" + x.b + " gap=" + x.gap) };
    assertOk(rec.dom.centreSelfHit.all, "visual centre did not hit its own button: " + JSON.stringify(rec.dom.centreSelfHit.offenders));
    assertOk(rec.dom.abutmentOk.all, "outside the +/-2px abutment band the owner is wrong: " + JSON.stringify(rec.dom.abutmentOk.bad));

    // (the rail-mode header check lives at the END of this case: collapsing the panel would
    //  invalidate the Workspaces-row taps below, so it must run last)


    // real input at the risky points, with a capture-phase spy that swallows the event
    const spy = `(()=>{if(window.__qaSpy)return 'exists';window.__qaSpy=1;window.__hits=[];
      const lab=(e)=>{const b=e&&e.closest?e.closest("button,[role=button]"):null;const t=b||e;
        if(!t)return null;return ((t.getAttribute&&(t.getAttribute('aria-label')||t.textContent))||'').trim().slice(0,24)||t.className||t.tagName;};
      document.addEventListener('pointerdown',(e)=>{if(!window.__qaSpy)return;window.__hits.push({type:'pointerdown',x:Math.round(e.clientX),y:Math.round(e.clientY),label:lab(e.target)});e.stopImmediatePropagation();e.preventDefault();},true);
      document.addEventListener('click',(e)=>{if(!window.__qaSpy)return;window.__hits.push({type:'click',x:Math.round(e.clientX),y:Math.round(e.clientY),label:lab(e.target)});e.stopImmediatePropagation();e.preventDefault();},true);
      return 'installed';})()`;
    rec.notes.push("spy=" + (await ev(spy)));

    const risky = rec.dom.probes.filter((p) => !p.ownerIsTarget).slice(0, 8).map((p) => ({ target: p.target, at: p.at, x: p.x, y: p.y, predicted: p.owner }));
    const fired = [];
    for (const p of risky) {
      await ev("window.__hits=[]");
      await tap(p.x, p.y);
      await sleep(250);
      const hits = JSON.parse(await ev("JSON.stringify(window.__hits||[])"));
      fired.push({ ...p, actual: hits.map((h) => h.type + ":" + h.label).join(" | "), matchesPrediction: hits.length > 0 && hits[0].label === p.predicted });
    }
    // and prove a centre tap still hits its own button
    const centres = rec.dom.items.slice(0, 7).map((it) => ({ label: it.label, x: +((it.visual.x + it.visual.right) / 2).toFixed(1), y: +((it.visual.y + it.visual.bottom) / 2).toFixed(1) }));
    const centreFired = [];
    for (const c of centres) {
      await ev("window.__hits=[]");
      await tap(c.x, c.y);
      await sleep(250);
      const hits = JSON.parse(await ev("JSON.stringify(window.__hits||[])"));
      centreFired.push({ ...c, actual: hits.map((h) => h.label).join("|"), selfHit: hits.length > 0 && hits[0].label === c.label });
    }
    // real taps can land on the composer and raise the IME, which would shrink the viewport for
    // every later measurement: dismiss it and confirm the height came back
    try { adb(["shell", "input", "keyevent", "111"]); } catch {}
    await sleep(800);
    rec.dom.viewportAfterTaps = JSON.parse(await ev("JSON.stringify({innerHeight:innerHeight,innerWidth:innerWidth})"));
    rec.dom.realTaps = { risky, fired, centres: centreFired };
    rec.dom.spyHits = JSON.parse(await ev("JSON.stringify((window.__hits||[]).slice(-4))"));

    // evidence shot: outline the enlarged hit box (dashed red) vs the icon the user sees (green)
    await ev(`(()=>{const s=document.createElement('style');s.id='qa-hit-outline';
      s.textContent="[class*='_2H3hWW_iconButton'],[class*='_9lTDKa_searchButton'],[class*='_9lTDKa_iconButton'],[class*='EBLgjq_trigger'],[class*='WgQWqa_main'],[class*='WgQWqa_chevron']{outline:1px dashed rgba(255,0,0,.85)!important}"+
      "[class*='_2H3hWW_iconButton'] svg,[class*='_9lTDKa_searchButton'] svg,[class*='_9lTDKa_iconButton'] svg,[class*='EBLgjq_trigger'] svg,[class*='WgQWqa_main'] svg,[class*='WgQWqa_chevron'] svg{outline:1px solid rgba(0,180,0,.9)!important}";
      document.head.appendChild(s);return 1;})()`);
    await sleep(500);
    rec.shots.push(shot("qa-A14-hitboxes"));
    await ev("(()=>{const s=document.getElementById('qa-hit-outline');if(s)s.remove();window.__qaSpy=0;return 1;})()");

    // LAST in this case: the panel covers part of the header while expanded, so the header trio must
    // also self-hit with the panel COLLAPSED (rail mode) - which is where the user aims at them.
    await ev("(()=>{const b=[...document.querySelectorAll('button,[role=button]')].find(x=>(x.getAttribute('aria-label')||'').includes('Collapse sidebar'));if(b)b.click();return 1;})()");
    await sleep(1800);
    rec.dom.railState = JSON.parse(await ev(`(()=>{const sb=document.querySelector("[class*='_2H3hWW_root']");const r=sb.getBoundingClientRect();return JSON.stringify({w:+r.width.toFixed(1),collapsed:(sb.className||'').toString().includes('_2H3hWW_collapsed')});})()`));
    assertOk(rec.dom.railState.collapsed && rec.dom.railState.w < 60, "panel did not collapse before the rail-mode probe: " + JSON.stringify(rec.dom.railState));
    rec.dom.railProbe = JSON.parse(await ev(`(()=>{const SEL=${JSON.stringify(SEL)};
      const own=(e)=>e?((e.getAttribute&&e.getAttribute('aria-label'))||e.textContent||'').trim().slice(0,26):null;
      const out=[];
      for(const e of document.querySelectorAll(SEL)){
        const ic=e.querySelector('svg,img')||e, r=ic.getBoundingClientRect();
        if(!(r.width>1&&r.height>1))continue;
        const cx=(r.x+r.right)/2, cy=(r.y+r.bottom)/2;
        const el=document.elementFromPoint(cx,cy);
        const owner=el?(el.closest&&el.closest(SEL))||null:null;
        out.push({label:own(e),cx:+cx.toFixed(1),cy:+cy.toFixed(1),owner:own(owner),selfHit:own(owner)===own(e)});}
      return JSON.stringify(out);})()`));
    rec.dom.railSelfHit = { all: rec.dom.railProbe.every((x) => x.selfHit), offenders: rec.dom.railProbe.filter((x) => !x.selfHit).map((x) => x.label + "->" + x.owner) };
    assertOk(rec.dom.railSelfHit.all, "with the panel collapsed the header centre must hit itself: " + JSON.stringify(rec.dom.railSelfHit.offenders));
    return ["hit boxes vs visual icons measured; real taps at " + risky.length + " risky points; centre taps for " + centres.length + " buttons; rail-mode header self-hit ok"];
  },
  // QA-A17 (round-2 addition): is the F1 clearance real when the user actually scrolls the session
  // list to the bottom? (round 1 measured at scrollTop=0, mid-list, which is not the defect state)
  "QA-A17": async (rec) => {
    await toggleTap(true);
    await sleep(1000);
    rec.dom = JSON.parse(await ev(`(()=>{
      const cands=[...document.querySelectorAll("[class*='_9lTDKa_list']")];
      const info=cands.map((e)=>({cls:(e.className||'').toString().slice(0,40),sh:e.scrollHeight,ch:e.clientHeight,
        scrollable:e.scrollHeight>e.clientHeight+2,padBottom:getComputedStyle(e).paddingBottom}));
      const scroller=cands.find(e=>e.scrollHeight>e.clientHeight+2)||null;
      const titles=[...document.querySelectorAll("[class*='hIlkoa_title']")];
      const settings=[...document.querySelectorAll("button,[role=button]")].find(e=>/^Settings$/i.test((e.textContent||'').trim()));
      const measure=()=>{const t=titles[titles.length-1],s=settings;
        if(!t||!s)return null;const tr=t.closest("button,[role=button],li,div[class*='hIlkoa']").getBoundingClientRect();const sr=s.getBoundingClientRect();
        return {lastRowBottom:+tr.bottom.toFixed(1),settingsTop:+sr.top.toFixed(1),clearance:+(sr.top-tr.bottom).toFixed(1)};};
      const before=measure();
      if(scroller)scroller.scrollTop=scroller.scrollHeight;
      const after=measure();
      return JSON.stringify({candidateCount:cands.length,info,scrollerFound:!!scroller,
        scrolledBy:scroller?+scroller.scrollTop.toFixed(1):null,atTop:before,atBottom:after});})()`));
    rec.shots.push(shot("qa-A17-scrollbottom"));
    const b = rec.dom.atBottom;
    assertOk(b && b.clearance >= 0, "scrolled to the bottom the last row does not clear the Settings footer: " + JSON.stringify(b));
    return ["real scroller=" + rec.dom.scrollerFound + "; clearance at bottom=" + (b ? b.clearance : "n/a") + "px (at top: " + (rec.dom.atTop ? rec.dom.atTop.clearance : "n/a") + "px)"];
  },
  // QA-A15 (v1.32.7): the collapsed icon rail is 56px wide - do the 40px hit boxes fit, and do
  // the vertically stacked ones now overlap each other?
  "QA-A15": async (rec) => {
    await toggleTap(false);   // collapse
    await sleep(1200);
    rec.dom = JSON.parse(await ev(`(()=>{
      const sb=document.querySelector("[class*='_2H3hWW_root']");
      const rail=sb?sb.getBoundingClientRect():null;
      const bs=[...document.querySelectorAll("button,[role=button]")].map((e)=>{const r=e.getBoundingClientRect();
        return {label:((e.getAttribute('aria-label')||e.textContent)||'').trim().slice(0,22),x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1),right:+r.right.toFixed(1),bottom:+r.bottom.toFixed(1),vis:r.width>0&&r.height>0};}).filter(b=>b.vis);
      const over=[];
      for(let a=0;a<bs.length;a++)for(let b=a+1;b<bs.length;b++){
        const A=bs[a],B=bs[b];
        const ox=Math.max(0,Math.min(A.right,B.right)-Math.max(A.x,B.x));
        const oy=Math.max(0,Math.min(A.bottom,B.bottom)-Math.max(A.y,B.y));
        if(ox>0&&oy>0)over.push({a:A.label,b:B.label,ox:+ox.toFixed(1),oy:+oy.toFixed(1)});}
      const outside=bs.filter(b=>rail&&(b.right>rail.right+0.5||b.x<rail.x-0.5));
      const gt40=bs.filter(b=>b.h>=40);
      return JSON.stringify({rail:rail?{x:+rail.x.toFixed(1),w:+rail.width.toFixed(1),right:+rail.right.toFixed(1)}:null,
        buttonCount:bs.length, buttonsAtLeast40High:gt40.length, overflowingRail:outside, overlaps:over, sample:bs.slice(0,14)});})()`));
    rec.shots.push(shot("qa-A15-rail"));
    assertOk(rec.dom.rail && Math.abs(rec.dom.rail.w - 55.6) < 1.5, "collapsed rail is not ~56px: " + JSON.stringify(rec.dom.rail));
    return ["collapsed rail buttons measured for overflow/overlap"];
  },
  // QA-A19 (standing case, task-21): hit-area GEOMETRY AUDIT. For every group of buttons that
  // shares a row, compare the adjacent centre distance against the two hit-box widths: if
  // centreDistance < (halfwidthA + halfwidthB) the boxes overlap -> the v1.32.7 round-1 P1 class
  // of bug (tapping A's centre fires B) is caught mechanically from now on. Runs at three font
  // scales; the baseline is CSS360 (innerWidth 360 / dpr 4), old 411-width numbers are void.
  "QA-A19": async (rec) => {
    const out = {};
    for (const v of ["1.0", "1.15", "1.5"]) {
      setFontScale(v);
      await sleep(2600);
      try { await connect(); } catch {}
      try { await reloadAndWait(); } catch {}
      try { await connect(); } catch {}
      await toggleTap(true);
      await sleep(1300);
      const key = "font" + v.replace(".", "");
      out[key] = JSON.parse(await ev(`(()=>{
        const SEL="[class*='_2H3hWW_iconButton'],[class*='_9lTDKa_searchButton'],[class*='_9lTDKa_iconButton'],[class*='EBLgjq_trigger'],[class*='WgQWqa_main'],[class*='WgQWqa_chevron']";
        const items=[...document.querySelectorAll(SEL)].map((e)=>{
          const r=e.getBoundingClientRect(); const ic=e.querySelector('svg,img')||e; const ir=ic.getBoundingClientRect();
          const panel=e.closest("[class*='_2H3hWW_root']");
          const parent=e.parentElement; let pid=(parent&&parent.className||'').toString().slice(0,24)||parent?.tagName||'?';
          return {label:((e.getAttribute('aria-label')||e.textContent)||'').trim().slice(0,20),
            layer:panel?'panel':'page', parent:pid,
            hit:{x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1),right:+r.right.toFixed(1),bottom:+r.bottom.toFixed(1)},
            visual:{x:+ir.x.toFixed(1),y:+ir.y.toFixed(1),w:+ir.width.toFixed(1),h:+ir.height.toFixed(1)},
            centre:+((r.x+r.right)/2).toFixed(1)};})
          .filter((i)=>i.hit.w>1&&i.hit.h>1)
          .filter((i)=>i.hit.x>=-0.5&&i.hit.right<=innerWidth+0.5);   // off-screen buttons are unreachable, not a hit-area bug
        // group first by container (layer + parent), then by row inside that container: buttons from
        // the overlay panel and from the page behind it must never be compared with each other
        const rows=[];
        for(const it of items){
          let row=null;
          for(const r of rows){
            if(r.layer!==it.layer)continue;
            const oy=Math.min(r.y1,it.hit.bottom)-Math.max(r.y0,it.hit.y);
            if(oy > 0.5*Math.min(it.hit.h, r.y1-r.y0)){row=r;break;}
          }
          if(!row){row={layer:it.layer,y0:it.hit.y,y1:it.hit.bottom,items:[]};rows.push(row);}
          row.y0=Math.min(row.y0,it.hit.y); row.y1=Math.max(row.y1,it.hit.bottom); row.items.push(it);
        }
        const pairs=[];
        for(const r of rows){
          if(r.items.length<2)continue;
          r.items.sort((a,b)=>a.centre-b.centre);
          for(let i=0;i<r.items.length-1;i++){
            const A=r.items[i],B=r.items[i+1];
            const gapCentre=+(B.centre-A.centre).toFixed(2);
            const halfSum=+((A.hit.w+B.hit.w)/2).toFixed(2);
            const overlap=+(halfSum-gapCentre).toFixed(2);
            pairs.push({a:A.label,b:B.label,gapCentre,halfSum,overlap,widths:[A.hit.w,B.hit.w],height:[A.hit.h,B.hit.h],
              verdict:overlap>0.5?"OVERLAP":"ok"});
          }
        }
        const all=[...document.querySelectorAll(SEL)].map((e)=>{const r=e.getBoundingClientRect();
          return {label:((e.getAttribute('aria-label')||e.textContent)||'').trim().slice(0,20),x:+r.x.toFixed(1),right:+r.right.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)};})
          .filter((i)=>i.w>1&&i.h>1);
        const skipped=all.filter((i)=>!(i.x>=-0.5&&i.right<=innerWidth+0.5));
        return JSON.stringify({innerWidth:innerWidth,dpr:devicePixelRatio,buttons:items.length,rowsAudited:rows.filter((r)=>r.items.length>1).length,
          pairsAudited:pairs.length,pairs:pairs,
          skippedOffscreen:skipped.map((i)=>i.label+' w='+i.w+' x='+i.x+'->'+i.right),
          singles:rows.filter((r)=>r.items.length===1).map((r)=>r.items[0].label)});})()`));
      rec.shots.push(shot("qa-A19-geom-" + key));
    }
    setFontScale("1.0");
    await sleep(1500);
    const bad = [];
    for (const k of Object.keys(out)) for (const p of out[k].pairs) if (p.verdict !== "ok") bad.push(k + ":" + p.a + "|" + p.b + " overlap=" + p.overlap);
    rec.dom = { ...out, summary: { scales: Object.keys(out), innerWidth: out.font10.innerWidth, dpr: out.font10.dpr, failures: bad } };
    assertOk(bad.length === 0, "hit-box geometry audit FAILED (adjacent centre distance < sum of half widths): " + JSON.stringify(bad));
    return ["geometry audit at 1.0/1.15/1.5; innerWidth=" + out.font10.innerWidth + " dpr=" + out.font10.dpr];
  },
  // QA-N1 (promoted from the v1.32.8 round): offline-banner timing. airplane-mode on -> how long
  // until the banner is in the DOM (requirement: <=2s), airplane-mode off -> how long until it is
  // gone and the page is usable again, plus the banner's own attributes and two screenshots.
  "QA-N1": async (rec) => {
    const R = {};
    setAirplane(false);
    await sleep(2000);
    try { await connect(); } catch {}
    R.shellReadyMs = await waitShell(30000);
    const B = "!!document.getElementById('bw-net-banner')";
    const attrs = () => ev(`(()=>{const d=document.getElementById('bw-net-banner');if(!d)return JSON.stringify({present:false});
      const cs=getComputedStyle(d),r=d.getBoundingClientRect();
      return JSON.stringify({present:true,text:(d.textContent||''),position:cs.position,zIndex:cs.zIndex,pointerEvents:cs.pointerEvents,
        bg:cs.backgroundColor,rect:{x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)},innerWidth:innerWidth});})()`);
    const t0 = Date.now();
    setAirplane(true);
    let appear = -1;
    while (Date.now() - t0 < 6000) { try { if (await ev(B)) { appear = Date.now() - t0; break; } } catch {} await sleep(100); }
    R.appearMs = appear;
    try { R.banner = JSON.parse(await attrs()); } catch (e) { R.banner = null; R.bannerErr = String(e.message).slice(0, 120); }
    R.textExact = R.banner ? R.banner.text === "\u7f51\u7edc\u5df2\u65ad\u5f00\uff0c\u6b63\u5728\u7b49\u5f85\u6062\u590d\u2026" : false;
    R.topFixed = R.banner ? R.banner.position === "fixed" && R.banner.rect.y === 0 : false;
    R.pointerNone = R.banner ? R.banner.pointerEvents === "none" : false;
    rec.shots.push(shot("qa-N1-banner"));
    const t1 = Date.now();
    setAirplane(false);
    let gone = -1;
    while (Date.now() - t1 < 10000) { try { if (!(await ev(B))) { gone = Date.now() - t1; break; } } catch {} await sleep(100); }
    R.goneMs = gone;
    R.shellAfter = (() => { try { return ev(SHELL); } catch { return null; } })();
    rec.shots.push(shot("qa-N1-after"));
    rec.dom = R;
    assertOk(appear >= 0 && appear <= 2000, "banner did not appear within 2s of losing the network: " + appear);
    assertOk(gone >= 0, "banner was not removed within 10s of the network coming back: " + gone);
    assertOk(R.textExact && R.topFixed && R.pointerNone, "banner attributes wrong: " + JSON.stringify(R.banner));
    assertOk(rec.shots.every((s) => s.ok), "a screenshot is smaller than 100KB");
    return ["banner appearMs=" + appear + " goneMs=" + gone + " textExact=" + R.textExact];
  },
  // QA-N4 (promoted from the v1.32.8 round): while the offline banner is up, does it steal taps?
  // elementFromPoint grid over the header buttons (centre + four visual edges + both hit-box edges)
  // with an explicit isBanner flag, then REAL CDP taps at the button centres through a capture-phase
  // spy (disarmable) to prove the taps still land on the buttons.
  "QA-N4": async (rec) => {
    const R = {};
    setAirplane(false);
    await sleep(1500);
    try { await connect(); } catch {}
    setAirplane(true);
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) { try { if (await ev("!!document.getElementById('bw-net-banner')")) break; } catch {} await sleep(150); }
    R.grid = JSON.parse(await ev(`(()=>{
      const b=document.getElementById('bw-net-banner');
      const br=b?b.getBoundingClientRect():null;
      const own=(e)=>e?((e.getAttribute&&(e.getAttribute('aria-label')||e.textContent))||'').trim().slice(0,20):null;
      const all=[...document.querySelectorAll("button,[role=button]")].filter((e)=>{const r=e.getBoundingClientRect();return r.width>8&&r.height>8&&r.y<120;});
      const offscreen=all.filter((e)=>{const r=e.getBoundingClientRect();return r.x<0||r.right>innerWidth+0.5;})
        .map((e)=>(((e.getAttribute('aria-label')||e.textContent)||'').trim().slice(0,20)+' @x'+Math.round(e.getBoundingClientRect().x)));
      const cands=all.filter((e)=>{const r=e.getBoundingClientRect();return r.x>=-0.5&&r.right<=innerWidth+0.5;});
      const items=[];
      for(const e of cands){
        const r=e.getBoundingClientRect(); const ic=e.querySelector('svg,img')||e; const ir=ic.getBoundingClientRect();
        const pts={};
        const sample=(k,x,y)=>{const el=document.elementFromPoint(x,y);pts[k]={owner:own(el?(el.closest&&el.closest("button,[role=button]")):null),isBanner:!!(el&&el.id==='bw-net-banner'),isSelf:own(el?(el.closest&&el.closest("button,[role=button]")):null)===own(e)};};
        const cy=(ir.y+ir.bottom)/2, cx=(ir.x+ir.right)/2;
        sample("centre",cx,cy); sample("vLeft",ir.x+1,cy); sample("vRight",ir.right-1,cy);
        sample("vTop",cx,ir.y+1); sample("vBottom",cx,ir.bottom-1);
        sample("hitLeft",r.x+0.5,cy); sample("hitRight",r.right-0.5,cy);
        items.push({label:own(e),hit:{x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)},
          visual:{x:+ir.x.toFixed(1),y:+ir.y.toFixed(1),w:+ir.width.toFixed(1),h:+ir.height.toFixed(1)},
          underBanner: br? (r.y < br.bottom) : false,
          centreSelf: pts.centre.isSelf, allSelf: Object.keys(pts).every((k)=>pts[k].isSelf), pts});
      }
      return JSON.stringify({bannerPresent:!!b,bannerRect:br?{x:+br.x.toFixed(1),y:+br.y.toFixed(1),w:+br.width.toFixed(1),h:+br.height.toFixed(1)}:null,
        innerWidth:innerWidth,count:items.length,offscreenCandidates:offscreen,items:items});})()`));
    // real input at the centre of the first under-banner button, spy disarmed afterwards
    await ev(`(()=>{if(!window.__qaSpy){window.__qaSpy=1;window.__hits=[];
      const lab=(e)=>{const bb=e&&e.closest?e.closest("button,[role=button]"):null;const t=bb||e;
        return t?(((t.getAttribute&&(t.getAttribute('aria-label')||t.textContent))||'').trim().slice(0,20)||t.tagName):null;};
      document.addEventListener('pointerdown',(e)=>{if(!window.__qaSpy)return;window.__hits.push({t:'down',x:Math.round(e.clientX),y:Math.round(e.clientY),label:lab(e.target)});e.stopImmediatePropagation();e.preventDefault();},true);}return 1;})()`);
    const target = R.grid.items.find((i) => i.underBanner && i.centreSelf) || R.grid.items[0];
    if (target) {
      const pt = JSON.parse(await ev(`(()=>{const b=[...document.querySelectorAll("button,[role=button]")].find(x=>((x.getAttribute('aria-label')||x.textContent)||'').trim().slice(0,20)===${JSON.stringify(target.label)});
        if(!b)return "null";const r=b.getBoundingClientRect();const ic=b.querySelector('svg,img')||b;const ir=ic.getBoundingClientRect();
        return JSON.stringify({x:+((ir.x+ir.right)/2).toFixed(1),y:+((ir.y+ir.bottom)/2).toFixed(1)});})()`));
      if (pt) {
        await ev("window.__hits=[]");
        await tap(pt.x, pt.y);
        await sleep(350);
        R.realClick = { at: pt, tag: "n4-realclick-" + target.label, hits: JSON.parse(await ev("JSON.stringify(window.__hits||[])")) };
        R.realClickHitSelf = R.realClick.hits.length > 0 && R.realClick.hits[0].label === target.label;
      }
    }
    await ev("window.__qaSpy=0");
    rec.shots.push(shot("qa-N4-banner-hits"));
    setAirplane(false);
    await sleep(1500);
    rec.dom = R;
    const bannerOwners = R.grid.items.flatMap((i) => Object.keys(i.pts).filter((k) => i.pts[k].isBanner).map((k) => i.label + "/" + k));
    assertOk(bannerOwners.length === 0, "elementFromPoint returned the banner for: " + JSON.stringify(bannerOwners));
    const centreOff = R.grid.items.filter((i) => !i.centreSelf).map((i) => i.label + "->" + i.pts.centre.owner);
    assertOk(centreOff.length === 0, "with the banner up, these buttons' visual centres do not hit themselves: " + JSON.stringify(centreOff));
    assertOk(R.realClickHitSelf !== false, "a real CDP tap at a button centre did not reach it: " + JSON.stringify(R.realClick));
    return ["banner present while probing; " + R.grid.count + " header buttons, all centres self; real click ok=" + R.realClickHitSelf];
  },
  // QA-P04: hit areas (DOM only)
  "QA-P04": async (rec) => {
    await toggleTap(true);
    const expanded = JSON.parse(await hitAreas());
    await contentTap();
    const collapsed = JSON.parse(await hitAreas());
    assertOk(expanded.length > 0, "no clickable elements found with the panel expanded - wrong page?");
    const small = (arr) => arr.filter((b) => b.w < 40 || b.h < 40);
    rec.dom = { expandedCount: expanded.length, collapsedCount: collapsed.length, tooSmallExpanded: small(expanded), tooSmallCollapsed: small(collapsed), expanded: expanded.slice(0, 12) };
    return ["hit areas measured (no screenshot: DOM-only case)"];
  },
};

// ---- round ----
(async () => {
  const meta = { url: URL.replace(/token=[^&]+/, "token=<redacted>"), startedAt: new Date().toISOString(), versionName: null, cases: CASES };
  try {
    meta.versionName = (adb(["shell", "dumpsys", "package", "xyz.cpyh.dshpush"]).split(/\r?\n/).find((l) => l.includes("versionName=")) || "").trim();
  } catch (e) { meta.versionName = "unknown: " + String(e.message).slice(0, 120); }
  // the versionName is identical across patch generations (the lead bumps it at release time),
  // so prove which patch is live by reading the injected stylesheet itself
  try {
    meta.patchGen = await ev("(()=>{const s=document.getElementById('bw-narrow-fix');if(!s)return 'NO_PATCH';const t=s.textContent;return JSON.stringify({hasV1327Markers:t.includes('hIlkoa_time')&&t.includes('WgQWqa_chevron'),hasV1325Density:t.includes('box-shadow:0 8px 32px rgba(0,0,0,.35)'),hasV1324Ancestor:t.includes('BynINW_sidebarCol'),bytes:t.length});})()");
  } catch (e) { meta.patchGen = "unreadable: " + String(e.message).slice(0, 120); }
  console.log("PATCHGEN " + meta.patchGen);
  console.log("VERSION " + meta.versionName);
  console.log("CASES " + CASES.join(","));

  global.__meta = meta;
  // deterministic start: fresh app process loading the FRESH url, so a round can never measure
  // whatever page happened to be open (that is how a stale auth page got reported as RAN)
  try {
    const pid = await startApp(URL);
    meta.startPid = pid;
    console.log("APP_PID " + pid);
    await connect();
    const ok = await waitShell(60000);
    console.log("SHELL_READY " + ok + (ok ? "" : " :: " + JSON.stringify(await pageInfo())));
  } catch (e) { console.log("CONNECT_FAIL " + e.message); }

  for (const cid of CASES) {
    const impl = CASES_IMPL[cid];
    if (!impl) { console.log("[SKIP] " + cid + " no implementation"); report.push({ id: cid, result: "SKIP", notes: ["not implemented in this driver"] }); continue; }
    await runCase({ id: cid, title: cid, fn: impl });
    try { await connect(); } catch {}
  }

  // leave the device clean
  try { setFontScale("1.0"); setNight(false); setAirplane(false); setSize("reset"); } catch {}
  try { sh("settings put system accelerometer_rotation 0"); sh("settings put system user_rotation 0"); } catch {}
  try { adb(["shell", "am", "force-stop", "xyz.cpyh.dshpush"]); } catch {}
  meta.finishedAt = new Date().toISOString();
  meta.reportFile = REPORT;
  fs.writeFileSync(`${OUTDIR}\\${REPORT}`, JSON.stringify({ meta, report }, null, 2), "utf8");
  console.log("ROUND_DONE clean-state applied");
  process.exit(0);
})();
