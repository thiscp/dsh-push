// qa-overlay-layers.mjs - task-7 follow-up (lead request): WHY is the real slash menu still see-through?
//
// Answers three questions with measurements, not guesses:
//   1. the FULL ancestor chain from the menu's [role=listbox] up to <body>: tag/class/bg/alpha/
//      position/z-index/size  -- INCLUDING ::before and ::after pseudo-elements, because a
//      "surface" class commonly paints its background in a pseudo-element while the element's own
//      computed backgroundColor stays rgba(0,0,0,0). Measuring only the element (what the first
//      probe did) would MISS that layer entirely.
//   2. which layers inside the menu subtree actually paint (own bg or pseudo bg non-transparent)
//   3. the sidebar P13/C12: brute-force the rail buttons to expand the sidebar, then click outside
//      to collapse it.
//
// Runs on the laptop (adb forwards are host-local). adbd must be root BEFORE am start (H-1).
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const ADB = "G:\\Android\\Sdk\\platform-tools\\adb.exe";
const URL = process.argv[2];
const OUTDIR = process.argv[3] || "G:\\Android\\qa-overlay";
const PORT = "9230";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function adb(a, o = {}) { return execFileSync(ADB, a, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 60000, ...o }); }
function whoami() { try { return String(adb(["shell", "whoami"]) || "").trim(); } catch { return "ERR"; } }
function shot(name) {
  const r = `/sdcard/${name}.png`;
  try {
    adb(["shell", "screencap", "-p", r]); adb(["pull", r, `${OUTDIR}\\${name}.png`]);
    const st = fs.statSync(`${OUTDIR}\\${name}.png`);
    console.log("SHOT " + name + " bytes=" + st.size + " ok=" + (st.size > 100000));
    return { name, bytes: st.size, ok: st.size > 100000 };
  } catch (e) { console.log("SHOT " + name + " FAILED " + String(e && e.message).slice(0, 140)); return { name, bytes: 0, ok: false }; }
}
let ws = null, id = 0, pend = new Map();
function send(m, p = {}) {
  const i = ++id;
  return new Promise((res, rej) => { pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); setTimeout(() => { if (pend.delete(i)) rej(new Error("timeout " + m)); }, 25000); });
}
async function ev(x) {
  const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r && r.exceptionDetails) throw new Error("JS:" + JSON.stringify(r.exceptionDetails).slice(0, 250));
  return r && r.result ? r.result.value : undefined;
}
async function evJ(x) { const v = await ev(x); try { return JSON.parse(v); } catch { return { raw: v }; } }
async function clickAt(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
// single-level escape regex source, safe to interpolate
const RGX = "/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/";

// Describe one element INCLUDING its pseudo-elements.
// A pseudo-element that paints the surface is exactly the layer the first probe could not see.
const DESC = (sel) => `(()=>{const e=${sel};if(!e)return JSON.stringify({found:false});
 const cs=getComputedStyle(e);const m=${RGX}.exec(cs.backgroundColor);
 const R=e.getBoundingClientRect();
 const ps=(which)=>{try{const c=getComputedStyle(e,which);const pm=${RGX}.exec(c.backgroundColor);
   return {content:(c.content||'').slice(0,30),bg:c.backgroundColor,
     alpha:pm?(pm[4]===undefined?1:parseFloat(pm[4])):null,display:c.display,opacity:c.opacity};}catch(err){return null;}};
 return JSON.stringify({tag:e.tagName,cls:(e.className||'').toString().slice(0,120),id:e.id||'',
   role:e.getAttribute&&(e.getAttribute('role')||'')||'',
   bg:cs.backgroundColor,alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,
   position:cs.position,zIndex:cs.zIndex,opacity:cs.opacity,
   w:Math.round(R.width),h:Math.round(R.height),
   inlineBg:e.style.backgroundColor||'',inlinePrio:e.style.getPropertyPriority('background-color')||'',
   before:ps('::before'),after:ps('::after')});})()`;

(async () => {
  const out = { startedAt: new Date().toISOString() };
  try {
    console.log("WHOAMI " + whoami());
    if (whoami() !== "root") { adb(["root"]); await sleep(3500); }
    console.log("WHOAMI_AFTER " + whoami());
    adb(["shell", "am", "force-stop", "xyz.cpyh.dshpush"]);
    await sleep(1500);
    adb(["shell", "am", "start", "-n", "xyz.cpyh.dshpush/.WebActivity", "--es", "url", URL]);
    let pid = "";
    for (let i = 0; i < 30; i++) { try { pid = adb(["shell", "pidof", "xyz.cpyh.dshpush"]).trim().split(/\s+/)[0]; } catch { } if (/^\d+$/.test(pid)) break; await sleep(1000); }
    adb(["forward", "--remove-all"]);
    adb(["forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`]);
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.filter((t) => t.type === "page").pop();
    ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } });
    await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", () => rej(new Error("ws"))); });
    await send("Runtime.enable");
    for (let i = 0; i < 20; i++) { if (await ev("(!!document.querySelector(\"[class*='BynINW_frame']\"))")) break; await sleep(2500); }
    out.viewport = { w: await ev("innerWidth"), h: await ev("innerHeight"), dpr: await ev("devicePixelRatio") };
    console.log("VIEWPORT " + JSON.stringify(out.viewport));

    // ---- open the menu: el.focus() then Input.insertText (synthesized CLICK steals focus)
    await ev(`(()=>{const c=[...document.querySelectorAll('textarea,[contenteditable=true]')].filter(e=>e.offsetHeight>0);
      const el=c[c.length-1]; if(el) el.focus(); return !!el;})()`);
    await sleep(400);
    await send("Input.insertText", { text: "/" });
    await sleep(1800);
    const ov = await evJ(`(()=>{const el=document.querySelector('[role=listbox]');window.__qaOverlay=el;
      if(!el)return JSON.stringify({found:false});const r=el.getBoundingClientRect();
      return JSON.stringify({found:true,w:Math.round(r.width),h:Math.round(r.height),
        items:[...el.querySelectorAll('[role=option]')].filter(b=>b.offsetHeight>0).length});})()`);
    out.overlay = ov;
    console.log("OVERLAY " + JSON.stringify(ov));
    if (!ov.found) throw new Error("menu did not open");

    // ---- (1) FULL ancestor chain including pseudo-elements
    out.ancestorChain = await evJ(`(()=>{
      const o=[];let e=window.__qaOverlay;
      while(e){o.push(e);if(e===document.body)break;e=e.parentElement;}
      // also include body's parent (html) for completeness
      const RGXS=${RGX};
      return JSON.stringify(o.map((x,i)=>{const cs=getComputedStyle(x);const m=RGXS.exec(cs.backgroundColor);
        const R=x.getBoundingClientRect();
        const ps=(w)=>{try{const c=getComputedStyle(x,w);const pm=RGXS.exec(c.backgroundColor);
          return {content:(c.content||'').slice(0,24),bg:c.backgroundColor,alpha:pm?(pm[4]===undefined?1:parseFloat(pm[4])):null,display:c.display};}catch(err){return null;}};
        return {depth:i,tag:x.tagName,cls:(x.className||'').toString().slice(0,110),id:x.id||'',
          role:x.getAttribute&&(x.getAttribute('role')||'')||'',
          bg:cs.backgroundColor,alpha:m?(m[4]===undefined?1:parseFloat(m[4])):null,
          // CRITICAL for "why is it still see-through": background-color:transparent !important does
          // NOT remove a background-IMAGE (e.g. a gradient that paints the surface). Measuring only
          // background-color would silently miss that layer.
          bgImage:(cs.backgroundImage||'none').slice(0,140),
          boxShadow:(cs.boxShadow||'none').slice(0,80),
          backdrop:(cs.backdropFilter||cs.webkitBackdropFilter||'none'),
          position:cs.position,zIndex:cs.zIndex,isolation:cs.isolation,
          opacity:cs.opacity,w:Math.round(R.width),h:Math.round(R.height),
          inlineBg:x.style.backgroundColor||'',inlinePrio:x.style.getPropertyPriority('background-color')||'',
          before:ps('::before'),after:ps('::after')};}));})()`);
    console.log("CHAIN_LAYERS " + (out.ancestorChain ? out.ancestorChain.length : 0));

    // ---- (2) every element INSIDE the menu subtree that actually paints (own bg or pseudo bg)
    out.menuPainters = await evJ(`(()=>{
      const RGXS=${RGX};const root=window.__qaOverlay;const out=[];
      const els=[root,...root.querySelectorAll('*')];
      for(const e of els){
        const cs=getComputedStyle(e);const m=RGXS.exec(cs.backgroundColor);
        const a=m?(m[4]===undefined?1:parseFloat(m[4])):null;
        let pb=null,pba=null;
        try{const c=getComputedStyle(e,'::before');const pm=RGXS.exec(c.backgroundColor);
          if(pm){pb=c.backgroundColor;pba=pm[4]===undefined?1:parseFloat(pm[4]);}}catch(err){}
        if((a!==null&&a>0)||(pba!==null&&pba>0)){
          const R=e.getBoundingClientRect();
          out.push({tag:e.tagName,cls:(e.className||'').toString().slice(0,90),role:e.getAttribute&&(e.getAttribute('role')||'')||'',
            bg:cs.backgroundColor,alpha:a,pseudoBeforeBg:pb,pseudoBeforeAlpha:pba,
            w:Math.round(R.width),h:Math.round(R.height),text:(e.textContent||'').trim().slice(0,28)});
        }
      }
      return JSON.stringify(out);})()`);
    console.log("MENU_PAINTERS " + (out.menuPainters ? out.menuPainters.length : 0));

    // first menu item, with pseudo-elements
    out.firstItem = await evJ(DESC(`document.querySelector('[role=option]')`));
    // computed style of the item class, so a stylesheet-level alpha is visible too
    out.itemStyleProbe = await evJ(`(()=>{const it=document.querySelector('[role=option]');if(!it)return JSON.stringify({found:false});
      const p=it.parentElement; const cs=getComputedStyle(it);
      return JSON.stringify({found:true,itemBg:cs.backgroundColor,itemOpacity:cs.opacity,
        parentCls:(p.className||'').toString().slice(0,90),parentBg:getComputedStyle(p).backgroundColor});})()`);
    shot("qa-P11-slash-menu");

    // ---- (3) sidebar: brute-force rail buttons to expand, then click outside to collapse (C12)
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(900);
    const SB = `document.querySelector("[class*='_2H3hWW_root']")`;
    const state = () => evJ(`(()=>{const e=${SB};if(!e)return JSON.stringify({found:false});
      const cn=(e.className||'').toString();const r=e.getBoundingClientRect();
      return JSON.stringify({found:true,collapsed:cn.indexOf('_2H3hWW_collapsed')>=0,width:+r.width.toFixed(1)});})()`);
    out.sidebarCollapsed = await state();
    const cands = await evJ(`(()=>{const R=[...document.querySelectorAll('button,[role=button],[aria-label],svg')]
      .filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&r.height>0&&r.left<60&&r.top<300;});
      return JSON.stringify(R.slice(0,12).map((b,i)=>{const r=b.getBoundingClientRect();
        return {i,tag:b.tagName,label:b.getAttribute&&(b.getAttribute('aria-label')||b.title||'')||'',
          cls:(b.className||'').toString().slice(0,60),x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};}));})()`);
    out.railCandidates = cands;
    let expanded = false, usedLabel = "";
    for (const c of (cands || [])) {
      await ev(`(()=>{const b=[...document.querySelectorAll('button,[role=button],[aria-label],svg')].find(x=>{
        const r=x.getBoundingClientRect();return Math.abs(r.left+r.width/2-${c.x})<2&&Math.abs(r.top+r.height/2-${c.y})<2;});
        if(b){const t=b.closest('button,[role=button]')||b;t.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));}})()`);
      await sleep(1500);
      const s = await state();
      if (s.found && !s.collapsed) { expanded = true; usedLabel = c.label || c.cls; break; }
    }
    out.sidebarExpanded = { expanded, usedLabel, state: await state() };
    console.log("SIDEBAR_EXPANDED " + JSON.stringify(out.sidebarExpanded));
    if (expanded) {
      out.sidebarExpandedPanel = await evJ(DESC(SB));
      shot("qa-P13-sidebar-expanded");
      // C12: click well outside the panel -> must collapse
      await clickAt(340, 420);
      await sleep(1800);
      out.c12 = { afterOutsideTap: await state() };
      console.log("C12 " + JSON.stringify(out.c12));
      shot("qa-C12-after-outside-tap");
    } else {
      shot("qa-P13-sidebar-expanded-NOTOPEN");
    }
    out.finishedAt = new Date().toISOString();
  } catch (e) {
    out.fatal = String((e && e.message) || e).slice(0, 400);
    console.log("FATAL " + out.fatal);
  } finally {
    try { adb(["shell", "am", "force-stop", "xyz.cpyh.dshpush"]); } catch { }
    try { adb(["forward", "--remove-all"]); } catch { }
    try { adb(["root"]); } catch { }
    await sleep(2500);
    out.deviceClean = { whoami: whoami(), forwards: (() => { try { return String(adb(["forward", "--list"]) || "").trim(); } catch { return "ERR"; } })() };
    fs.writeFileSync(`${OUTDIR}\\layers-report.json`, JSON.stringify(out, null, 2), "utf8");
    console.log("REPORT " + OUTDIR + "\\layers-report.json");
    console.log("DEVICE_CLEAN whoami=" + out.deviceClean.whoami + " forwards='" + out.deviceClean.forwards + "'");
    process.exit(0);
  }
})();
