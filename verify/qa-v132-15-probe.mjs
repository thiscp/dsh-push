// qa-v132-15-probe.mjs -- v1.32.15 QA change-verification probe (tester / task-2).
// usage: node qa-v132-15-probe.mjs <mode> <dsh-web-url> <outjson> [expectedApkSha] [tag]
//   mode = discover | sample | redline | applycount | s8 | a14
//
// Design notes (all hard-won, see verify/TESTER.md + skill dsh-push-app-dev):
//   * multi-match classes -> ALWAYS take max area, never querySelector()[0]
//   * every reading reports computed bg + INLINE + priority + size + text (a bare number cannot
//     distinguish "injection wrote it" from "React swapped the node and native shows through")
//   * connect() has bounded retry (devtools socket appears ~25s after a cold start)
//   * apk sha is read BEFORE and AFTER sampling (bracket); mismatch = fail closed
//   * node identity is tracked with a JS property so a React node swap is visible as nodeChanged
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ADB = "G:\\Android\\Sdk\\platform-tools\\adb.exe";
const PKG = "xyz.cpyh.dshpush";
const MODE = process.argv[2] || "discover";
const URL = process.argv[3] || "";
const OUT = process.argv[4] || "";
const EXPECTED = (process.argv[5] || "").trim().toLowerCase();
const TAG = process.argv[6] || "x";
const OPEN_SESSION = (process.argv[7] || "") === "session";
const ROW_INDEX = parseInt(process.argv[8] || "0", 10);
const PORT = "9236";
const OUTDIR = OUT ? path.dirname(path.resolve(OUT)) : process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RGX = "/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/";

function adb(a, o) {
  return execFileSync(ADB, a, Object.assign({ encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 90000 }, o || {}));
}
function tryAdb(a) { try { return String(adb(a) || "").trim(); } catch (e) { return "ERR:" + String((e && (e.stdout || e.message)) || e).slice(0, 80); } }
function whoami() { try { return String(adb(["shell", "whoami"]) || "").trim(); } catch { return "ERR"; } }
function pidofApp() { try { return String(adb(["shell", "pidof", PKG]) || "").trim(); } catch (e) { const s = String((e && (e.stdout || e.message)) || ""); return /^\s*\d/.test(s) ? s.trim() : ""; } }
function apkPath() { try { return String(adb(["shell", "pm", "path", PKG]) || "").trim().replace(/^package:/, "").split("\n")[0].trim(); } catch { return ""; } }
function apkSha() {
  const p = apkPath(); if (!p) return "NO_PATH";
  const t = tryAdb(["shell", "sha256sum", p]).split(/\s+/)[0] || "";
  return /^[0-9a-f]{64}$/i.test(t) ? t.toLowerCase() : t;
}
async function requireRoot(why) {
  let w = whoami();
  if (w === "root") { log("ADB_ROOT " + why + " already=root"); return; }
  log("ADB_ROOT " + why + " whoami=" + w + " -> adb root");
  try { adb(["root"]); } catch {}
  await sleep(3000);
  for (let i = 0; i < 20; i++) { w = whoami(); if (w === "root") { log("ADB_ROOT " + why + " root after " + (i + 1) + " polls"); return; } await sleep(1500); }
  throw new Error("BLOCKED: adbd not root (whoami=" + w + ")");
}
function shot(name) {
  const r = "/sdcard/" + name + ".png";
  try {
    adb(["shell", "screencap", "-p", r]);
    adb(["pull", r, OUTDIR + "\\" + name + ".png"]);
    const st = fs.statSync(OUTDIR + "\\" + name + ".png");
    const ok = st.size > 100000;
    log("SHOT " + name + " bytes=" + st.size + " ok=" + ok);
    return { name: name, bytes: st.size, ok: ok };
  } catch (e) { log("SHOT " + name + " FAILED " + String(e && e.message).slice(0, 100)); return { name: name, bytes: 0, ok: false }; }
}
function log(s) { console.log(s); }
let ws = null, id = 0, pend = new Map();
function send(m, p) {
  const i = ++id;
  return new Promise((res, rej) => {
    pend.set(i, { res: res, rej: rej });
    ws.send(JSON.stringify({ id: i, method: m, params: p || {} }));
    setTimeout(() => { if (pend.delete(i)) rej(new Error("timeout " + m)); }, 30000);
  });
}
async function ev(x) {
  const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r && r.exceptionDetails) throw new Error("JS:" + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r && r.result ? r.result.value : undefined;
}
async function evJ(x) { const v = await ev(x); if (typeof v === "string") { try { return JSON.parse(v); } catch { return { raw: String(v).slice(0, 400) }; } } return v; }
async function clickAt(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x, y: y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x, y: y, button: "left", clickCount: 1 });
}
async function connect() {
  await requireRoot("connect");
  let last = null;
  for (let a = 1; a <= 24; a++) {
    try {
      const pid = (pidofApp() || "").split(/\s+/)[0];
      if (!/^\d+$/.test(pid)) { last = new Error("no app pid"); await sleep(2000); continue; }
      try { adb(["forward", "--remove-all"]); } catch {}
      adb(["forward", "tcp:" + PORT, "localabstract:webview_devtools_remote_" + pid]);
      const list = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
      const page = list.filter((t) => t.type === "page").pop();
      if (!page) { last = new Error("no page target"); await sleep(2000); continue; }
      if (ws) { try { ws.close(); } catch {} }
      ws = new WebSocket(page.webSocketDebuggerUrl);
      id = 0; pend = new Map();
      ws.addEventListener("message", (e) => {
        const m = JSON.parse(e.data);
        if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error("cdp-error")) : p.res(m.result); }
      });
      await new Promise((r2, j2) => { ws.addEventListener("open", r2); ws.addEventListener("error", () => j2(new Error("ws-error"))); });
      await send("Runtime.enable");
      if (a > 1) log("CONNECT ok on attempt " + a);
      return pid;
    } catch (e) { last = e; if (a === 1 || a % 5 === 0) log("CONNECT retry " + a + ": " + String((e && e.message) || e).slice(0, 90)); await sleep(2500); }
  }
  throw new Error("connect failed: " + String((last && last.message) || last).slice(0, 140));
}
async function startFresh() {
  await requireRoot("startApp");
  try { adb(["shell", "am", "force-stop", PKG]); } catch {}
  await sleep(1500);
  adb(["shell", "am", "start", "-n", PKG + "/.WebActivity", "--es", "url", URL]);
  const pid = await connect();
  // readiness = the glass injection already ran (html inline transparent is written unconditionally)
  for (let i = 0; i < 30; i++) {
    let ready = false;
    try { ready = !!(await ev("(document.documentElement.style.backgroundColor==='transparent'&&document.body&&document.body.children.length>0)")); } catch {}
    if (ready) { log("PAGE_READY after " + (i + 1) + " polls pid=" + pid); return pid; }
    await sleep(2000);
  }
  throw new Error("BLOCKED: glass injection never landed (html inline not transparent after 60s)");
}

// ---------------- in-page: target resolution + one reading ----------------
const READ = [
"(function(){",
"var RGXS=" + RGX + ";",
"var vw=window.innerWidth,vh=window.innerHeight;",
"if(!window.__qaSeq)window.__qaSeq=0;",
"function cn(e){return (e.className||'').toString();}",
"function has(e,loc){var c=cn(e);if(c.indexOf(loc)<0)return false;",
"var re=new RegExp('(^|_)'+loc+'(_|$)');return re.test(c);}",
"var all=document.querySelectorAll('html,body,div,main,section,header,aside,nav,pre,textarea');",
"var best={};",
"function upd(k,e,a){var b=best[k];if(!b||a>b.area)best[k]={e:e,area:a};}",
"function upd2(k,e,a){var b=best[k];if(!b){best[k]={e:e,area:a};return;}",
"if(a>best[k].area){best[k+'A']=best[k];best[k]={e:e,area:a};}",
"else{if(!best[k+'A']||a>best[k+'A'].area)best[k+'A']={e:e,area:a};}}",
"for(var i=0;i<all.length;i++){var e=all[i];var r=e.getBoundingClientRect();",
"if(r.width<=0&&r.height<=0)continue;var area=r.width*r.height;",
"var isBig=(r.width>vw*0.5&&r.height>vh*0.5);",
"if(e===document.documentElement)best.html={e:e,area:area};",
"if(e===document.body)best.body={e:e,area:area};",
"if(e.id==='dsh-theme-veil')best.veil={e:e,area:area};",
"if(has(e,'frame'))upd('frame',e,area);",
"if(has(e,'centerCol'))upd('centerCol',e,area);",
"if(has(e,'scrollBody'))upd('scrollBody',e,area);",
"if(has(e,'overlayLayer'))upd('overlayLayer',e,area);",
"if(has(e,'tabHost'))upd('tabHost',e,area);",
"if(has(e,'panelBody'))upd('panelBody',e,area);",
"if(isBig){",
"if(has(e,'root')){upd('rootBig',e,area);upd2('rootBig2',e,area);}",
"if(has(e,'body'))upd('bodyBig',e,area);",
"if(has(e,'surface'))upd('surfaceBig',e,area);",
"if(has(e,'split'))upd('split',e,area);",
"if(e.tagName==='PRE')upd('bigPre',e,area);}",
"if(!isBig&&(has(e,'block')||cn(e).indexOf('md-code-block')>=0)&&r.height>20)upd('smallCB',e,area);",
"if(/tabhost/i.test(cn(e)))upd('tabHostAny',e,area);",
"if(/(^|_)emptyTabHost(_|$)/i.test(cn(e)))upd('emptyTabHost',e,area);",
"if(has(e,'root')&&r.width<=320&&r.height>=300)upd('sidebar',e,area);",
"var role=(e.getAttribute&&e.getAttribute('role')||'').toLowerCase();",
"if(role==='listbox'||role==='menu')upd('menu',e,area);}",
"var ta=document.querySelector('textarea');",
"var cbtn=null;var bs=document.querySelectorAll('button,[aria-label]');",
"for(var b2=0;b2<bs.length;b2++){var al=(bs[b2].getAttribute('aria-label')||'');",
"if(al.indexOf('Collapse sidebar')>=0||al.indexOf('\u6536\u8d77\u4fa7\u8fb9\u680f')>=0){cbtn=bs[b2];break;}}",
"if(cbtn){var pp=cbtn;",
"for(var w2=0;w2<12&&pp;w2++){if(/(^|_)(root|sidebar)(_|$)/.test(cn(pp))){",
"var rp=pp.getBoundingClientRect();",
"if(rp.height>=300){best.sidebarRoot={e:pp,area:rp.width*rp.height};break;}}pp=pp.parentElement;}}",
"if(ta){var p=ta;",
"for(var q=0;q<8&&p;q++){var csq=getComputedStyle(p);var mq=RGXS.exec(csq.backgroundColor);",
"if(mq&&(mq[4]===undefined?1:parseFloat(mq[4]))>0){var rq=p.getBoundingClientRect();",
"if(rq.width>60&&rq.height>20){best.inputCard={e:p,area:rq.width*rq.height};break;}}",
"p=p.parentElement;}}",
"var out={};",
"if(best.rootBigA)best.rootBig2=best.rootBigA;",
"for(var k in best){var e2=best[k].e;var cs=getComputedStyle(e2);",
"var m=RGXS.exec(cs.backgroundColor);var r3=e2.getBoundingClientRect();",
"if(e2.__qaId===undefined)e2.__qaId=++window.__qaSeq;",
"out[k]={id:e2.__qaId,tag:e2.tagName,cls:cn(e2).slice(0,80),domId:e2.id||'',",
"bg:cs.backgroundColor,alpha:(m?(m[4]===undefined?1:parseFloat(m[4])):null),",
"inline:e2.style.backgroundColor||'',prio:e2.style.getPropertyPriority('background-color')||'',",
"pos:cs.position,z:cs.zIndex,w:Math.round(r3.width),h:Math.round(r3.height),",
"big:(r3.width>vw*0.5&&r3.height>vh*0.5),",
"gateOpen:(e2.style.getPropertyValue('background-color')==='transparent'),",
"text:(e2.textContent||'').replace(/\\s+/g,' ').trim().slice(0,26)};}",
"return JSON.stringify({vw:vw,vh:vh,t0:Math.round(performance.now()),out:out});",
"})()"
].join("\n");

// ---------------- in-page: dead-anchor census + big-element inventory ----------------
const DISCOVER = [
"(function(){",
"var RGXS=" + RGX + ";",
"var vw=window.innerWidth,vh=window.innerHeight;",
"function cn(e){return (e.className||'').toString();}",
"var anchors=['BynINW_','_2H3hWW_root','_2H3hWW_collapsed','Dc7zOa_root','md-code-block',",
"'_tabHost_','_surface_','_split_','_root_','_frame_','_centerCol_','_float_','Z9Jnlq_'];",
"var census={};",
"for(var a=0;a<anchors.length;a++){var n=0;",
"var els=document.querySelectorAll('[class]');",
"for(var i=0;i<els.length;i++){if(cn(els[i]).indexOf(anchors[a])>=0)n++;}",
"census[anchors[a]]=n;}",
"function cbn(t){var n=0;var ds=t.querySelectorAll('div,section,main,aside,article,pre,code,table,ul');",
"for(var q=0;q<ds.length;q++){if(ds[q]===t)continue;var rr=ds[q].getBoundingClientRect();",
"if(rr.width>vw*0.5&&rr.height>vh*0.5)n++;}return n;}",
"var all=document.querySelectorAll('div,main,section,header,aside,nav,pre');",
"var inv=[];",
"for(var i2=0;i2<all.length;i2++){var e=all[i2];var r=e.getBoundingClientRect();",
"if(!(r.width>vw*0.5&&r.height>vh*0.5))continue;",
"var cs=getComputedStyle(e);var m=RGXS.exec(cs.backgroundColor);",
"var isCode=(e.tagName==='PRE');",
"if(!isCode&&e.children){for(var qk=0;qk<e.children.length;qk++){if(e.children[qk].tagName==='PRE'){isCode=true;break;}}}",
"inv.push({tag:e.tagName,cls:cn(e).slice(0,70),w:Math.round(r.width),h:Math.round(r.height),",
"pos:cs.position,alpha:(m?(m[4]===undefined?1:parseFloat(m[4])):null),",
"bg:cs.backgroundColor,inline:e.style.backgroundColor||'',",
"gateOpen:(e.style.getPropertyValue('background-color')==='transparent'),",
"isCode:isCode,innerBig:cbn(e),",
"text:(e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,26)});",
"}",
"inv.sort(function(a,b){return (b.w*b.h)-(a.w*a.h);});",
"var opaque=[];",
"var all2=document.querySelectorAll('*');",
"for(var i3=0;i3<all2.length;i3++){var e2=all2[i3];",
"var iv=e2.style.getPropertyValue('background-color');",
"if(/^rgb\\(/.test(iv)&&!/rgba/.test(iv)){var r2=e2.getBoundingClientRect();",
"var vis=(typeof e2.checkVisibility==='function')?e2.checkVisibility():null;",
"var chain=[];var pa2=e2;",
"for(var z=0;z<6&&pa2;z++){var pc=getComputedStyle(pa2);",
"chain.push((pa2.tagName||'')+'|disp='+pc.display+'|vis='+pc.visibility+'|op='+pc.opacity+'|pos='+pc.position+'|'+cn(pa2).slice(0,22));pa2=pa2.parentElement;}",
"var own='ZERO';",
"if(r2.width>0&&r2.height>0){var elp=document.elementFromPoint(r2.left+r2.width/2,r2.top+r2.height/2);own=elp?(elp.tagName+'|'+cn(elp).slice(0,30)):'none';}",
"opaque.push({tag:e2.tagName,cls:cn(e2).slice(0,60),w:Math.round(r2.width),h:Math.round(r2.height),inline:iv,checkVisibility:vis,ownerAtCenter:own,chain:chain});}}",
"return JSON.stringify({vw:vw,vh:vh,dpr:window.devicePixelRatio,census:census,",
"bigCount:inv.length,big:inv.slice(0,40),opaqueWritten:opaque,opaqueCount:opaque.length,",
"htmlInline:document.documentElement.style.backgroundColor||'',",
"bodyInline:document.body?(document.body.style.backgroundColor||''):'',",
"veilInline:(function(){var v=document.getElementById('dsh-theme-veil');return v?v.style.cssText.slice(0,200):'NO_VEIL';})()});",
"})()"
].join("\n");

// ---------------- in-page: code blocks with NATIVE colour (strip inline, read, restore) ----------------
const CODEBLOCKS = [
"(function(){",
"var RGXS=" + RGX + ";",
"var sel='[class*=md-code-block],[class*=_block_],pre';",
"var seen=[],out=[];",
"var els=document.querySelectorAll(sel);",
"for(var i=0;i<els.length;i++){var e=els[i];",
"var marked=/md-code-block|_block_/.test((e.className||'').toString());",
"if(!marked)continue;if(seen.indexOf(e)>=0)continue;seen.push(e);",
"var cs=getComputedStyle(e);var m=RGXS.exec(cs.backgroundColor);",
"var r=e.getBoundingClientRect();var before=e.style.backgroundColor;",
"var native=null,restoreOk=null;",
"try{e.style.removeProperty('background-color');",
"var nm=RGXS.exec(getComputedStyle(e).backgroundColor);",
"native=nm?{bg:getComputedStyle(e).backgroundColor,alpha:(nm[4]===undefined?1:parseFloat(nm[4])),rgb:[+nm[1],+nm[2],+nm[3]]}:null;",
"if(before)e.style.setProperty('background-color',before,e.style.getPropertyPriority('background-color')||'important');",
"restoreOk=((e.style.backgroundColor||'')===before);",
"}catch(err){native={err:String(err).slice(0,60)};restoreOk=false;}",
"var ib=0,ibTags=[];",
"var ds=e.querySelectorAll('div,section,main,aside,article,pre,code,table,ul');",
"for(var q=0;q<ds.length;q++){var dr=ds[q].getBoundingClientRect();",
"if(dr.width>window.innerWidth*0.5&&dr.height>window.innerHeight*0.5){ib++;",
"if(ibTags.length<6)ibTags.push(ds[q].tagName+'|'+String(ds[q].className||'').slice(0,18)+'|'+Math.round(dr.width)+'x'+Math.round(dr.height));}}",
"var kids=[];",
"for(var kk=0;kk<e.children.length&&kk<6;kk++){var ch=e.children[kk];var kr=ch.getBoundingClientRect();",
"kids.push(ch.tagName+'|'+String(ch.className||'').slice(0,18)+'|'+Math.round(kr.width)+'x'+Math.round(kr.height));}",
"out.push({tag:e.tagName,cls:(e.className||'').toString().slice(0,70),",
"bg:cs.backgroundColor,alpha:(m?(m[4]===undefined?1:parseFloat(m[4])):null),",
"inline:before||'',prio:e.style.getPropertyPriority('background-color')||'',",
"w:Math.round(r.width),h:Math.round(r.height),",
"overHalf:(r.width>window.innerWidth*0.5&&r.height>window.innerHeight*0.5),",
"native:native,restoreOk:restoreOk,innerBig:ib,ibTags:ibTags,kids:kids,",
"text:(e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,30)});}",
"out.sort(function(a,b){return (b.w*b.h)-(a.w*a.h);});",
"return JSON.stringify({count:out.length,blocks:out,vw:window.innerWidth,vh:window.innerHeight});",
"})()"
].join("\n");

// ---------------- in-page: v1.32.16 D2 geometry state (__bwW / __bwSbEl / __bwRailW / observers) ----------------
const PERF_HOOK = [
  "(function(){if(window.__qaPerf)return JSON.stringify({already:1,n:window.__qaPerf.set});",
  "var P=window.__qaPerf={set:0,setImp:0,byProp:{},attr:0,frames:[],t0:Date.now(),max:0};",
  "var sp=CSSStyleDeclaration.prototype.setProperty;",
  "CSSStyleDeclaration.prototype.setProperty=function(a,b,c){P.set++;if(c)P.setImp++;try{P.byProp[a]=(P.byProp[a]||0)+1;}catch(e){}return sp.apply(this,arguments);};",
  "var sa=Element.prototype.setAttribute;",
  "Element.prototype.setAttribute=function(a,b){if(a==='style')P.attr++;return sa.apply(this,arguments);};",
  "var last=0;",
  "function tick(ts){var f=P.frames;if(last){var d=ts-last;if(d<2000){f.push(Math.round(d));if(d>P.max)P.max=d;}}last=ts;if(f.length<3000)requestAnimationFrame(tick);}",
  "requestAnimationFrame(tick);",
  "return JSON.stringify({installed:1});})()"
].join("");

const PERF_READ = [
  "(function(){var P=window.__qaPerf;if(!P)return JSON.stringify({nohook:1});",
  "var s=P.frames.slice().sort(function(a,b){return a-b;});",
  "function q(p){return s.length?s[Math.min(s.length-1,Math.floor(s.length*p))]:null;}",
  "var j=0;for(var i=0;i<s.length;i++){if(s[i]>20)j++;}",
  "var bp={};for(var k in P.byProp){bp[k]=P.byProp[k];}",
  "var W=window.__bwW;",
  "return JSON.stringify({t:Math.round(Date.now()-P.t0),set:P.set,setImp:P.setImp,attr:P.attr,byProp:bp,frames:s.length,jankPct:s.length?Math.round(1000*j)/10:null,med:q(0.5),p90:q(0.9),p95:q(0.95),max:P.max,bwW:W?1:0,railW:(window.__bwRailW===undefined?null:window.__bwRailW),sbEl:window.__bwSbEl?1:0,obs:{geom:!!window.__bwGeomObs,panelBg:!!window.__bwPanelBgObs,panelClose:!!window.__bwPanelClose}});})()"
].join("");

async function scrollBurst() {
  for (let k = 0; k < 5; k++) {
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 180, y: 400, deltaX: 0, deltaY: 300 });
    await sleep(250);
  }
}

const D2STATE = [
  "(function(){",
  "function cn(e){return (e.className||'').toString();}",
  "function st(e){var cs=getComputedStyle(e);var r=e.getBoundingClientRect();",
  "return {cls:cn(e).slice(0,60),tag:e.tagName,w:Math.round(r.width),h:Math.round(r.height),",
  "x:Math.round(r.left),y:Math.round(r.top),pos:cs.position,z:cs.zIndex,vis:cs.visibility,",
  "disp:cs.display,bg:cs.backgroundColor,inline:e.style.cssText.slice(0,220),",
  "grid:e.style.getPropertyValue('grid-template-columns')||'',",
  "prio:e.style.getPropertyPriority('background-color')||''};}",
  "var vw=window.innerWidth,vh=window.innerHeight;",
  "var W=window.__bwW||null;",
  "var out={vw:vw,vh:vh,bwRailW:(window.__bwRailW===undefined?null:window.__bwRailW),",
  "bwW:W?{f:st(W.f),col:st(W.col),panel:st(W.panel)}:null,",
  "bwSbEl:window.__bwSbEl?st(window.__bwSbEl):null,",
  "obs:{geom:!!window.__bwGeomObs,panelBg:!!window.__bwPanelBgObs,panelClose:!!window.__bwPanelClose},",
  "bwFns:{panelBg:typeof window.__bwPanelBg}};",
  "var gs=document.querySelectorAll('div,main,section');var grids=[];",
  "for(var i=0;i<gs.length;i++){var e=gs[i];var cs=getComputedStyle(e);",
  "if(cs.display!=='grid'&&cs.display!=='inline-grid')continue;var r=e.getBoundingClientRect();",
  "if(r.width<vw*0.9||r.height<vh*0.5)continue;grids.push(st(e));if(grids.length>=4)break;}",
  "out.grids=grids;",
  "var bs=document.querySelectorAll('[class*=md-code-block],pre');var blocks=[];",
  "for(var j=0;j<bs.length;j++){var e2=bs[j];var r2=e2.getBoundingClientRect();",
  "var cs2=getComputedStyle(e2);",
  "blocks.push({cls:cn(e2).slice(0,50),tag:e2.tagName,w:Math.round(r2.width),h:Math.round(r2.height),",
  "x:Math.round(r2.left),bg:cs2.backgroundColor,inline:e2.style.backgroundColor||'',",
  "overHalf:(r2.width>vw*0.5&&r2.height>vh*0.5),vis:cs2.visibility});}",
  "blocks.sort(function(a,b){return (b.w*b.h)-(a.w*a.h);});",
  "out.blocks=blocks.slice(0,12);out.blockCount=blocks.length;",
  "var cands=document.querySelectorAll('[class*=centerCol]');var cc=null,ca=-1;",
  "for(var m=0;m<cands.length;m++){var r3=cands[m].getBoundingClientRect();",
  "if(r3.width*r3.height>ca){ca=r3.width*r3.height;cc=cands[m];}}",
  "out.centerCol=cc?st(cc):null;",
  "var cands2=document.querySelectorAll('div,section,aside,nav');var sbest=null,sba=-1;",
  "for(var q2=0;q2<cands2.length;q2++){var e3=cands2[q2];var r5=e3.getBoundingClientRect();",
  "if(r5.width<100||r5.width>vw*0.92||r5.height<vh*0.5)continue;",
  "var tx=e3.textContent||'';",
  "if(tx.indexOf('New Session')<0&&tx.indexOf('New Se')<0)continue;",
  "if(tx.indexOf('Settings')<0&&tx.indexOf('Plugins')<0)continue;",
  "var aa2=r5.width*r5.height;if(aa2>sba){sba=aa2;sbest=e3;}}",
  "out.sbProbe=sbest?st(sbest):null;",
  "var rails=document.querySelectorAll('div,section,aside,nav');var rb=null,rba=-1;",
  "for(var q3=0;q3<rails.length;q3++){var e4=rails[q3];var r6=e4.getBoundingClientRect();",
  "if(r6.width<30||r6.width>140||r6.height<vh*0.5||r6.left>10)continue;",
  "var lab=(e4.textContent||'')+(e4.getAttribute('aria-label')||'');",
  "var hasIcon=false;var ib2=e4.querySelectorAll('[aria-label]');",
  "for(var q4=0;q4<ib2.length;q4++){var al2=ib2[q4].getAttribute('aria-label')||'';",
  "if(/New session|New Session|Plugins|\\u65b0\\u4f1a\\u8bdd|\\u63d2\\u4ef6/i.test(al2)){hasIcon=true;break;}}",
  "if(!hasIcon)continue;var aa3=r6.width*r6.height;if(aa3>rba){rba=aa3;rb=e4;}}",
  "out.railProbe=rb?st(rb):null;",
  "if(rb){var r7=rb.getBoundingClientRect();var px4=Math.round(r7.left+Math.min(18,r7.width/2)),py4=Math.round(r7.top+Math.min(60,r7.height/2));",
  "var el4=document.elementFromPoint(px4,py4);",
  "out.railProbeHit={px:px4,py:py4,owner:el4?(el4.tagName+'.'+cn(el4).slice(0,30)):'null',",
  "selfOrDesc:el4?(el4===rb||rb.contains(el4)):false};}",
  "if(sbest){var par=sbest.parentElement;var chain=[];",
  "for(var u=0;u<6&&par;u++){var pc=getComputedStyle(par);var pr=par.getBoundingClientRect();",
  "chain.push({cls:cn(par).slice(0,30),tag:par.tagName,w:Math.round(pr.width),h:Math.round(pr.height),",
  "disp:pc.display,grid:pc.gridTemplateColumns.slice(0,60),inlineGrid:par.style.getPropertyValue('grid-template-columns')||''});",
  "par=par.parentElement;}out.sbAncestry=chain;",
  "var rs9=sbest.getBoundingClientRect();",
  "var px3=Math.round(rs9.left+Math.min(20,rs9.width/2)),py3=Math.round(rs9.top+Math.min(60,rs9.height/2));",
  "var el3=document.elementFromPoint(px3,py3);",
  "out.sbProbeHit={px:px3,py:py3,owner:el3?(el3.tagName+'.'+cn(el3).slice(0,30)):'null',",
  "selfOrDesc:el3?(el3===sbest||sbest.contains(el3)):false};}",
  "var sb=window.__bwSbEl||null;",
  "if(sb){var r4=sb.getBoundingClientRect();",
  "var px=Math.round(r4.left+Math.min(20,r4.width/2)),py=Math.round(r4.top+Math.min(60,r4.height/2));",
  "var el=document.elementFromPoint(px,py);",
  "out.sbHit={px:px,py:py,owner:el?(el.tagName+'.'+cn(el).slice(0,30)):'null',",
  "selfOrDesc:el?(el===sb||sb.contains(el)):false};",
  "out.sbVisible=(r4.width>0&&r4.height>0&&getComputedStyle(sb).visibility!=='hidden');}",
  "return JSON.stringify(out);",
  "})()"
].join("");
// ---------------- in-page: D1 instrumentation (window.__qaCb / __qaN / node identity) ----------------
const CBSTATE = function (nat) {
  return [
    "(function(){",
    "var RGXS=" + RGX + ";var NAT=" + (nat ? "true" : "false") + ";",
    "function cn(e){return (e.className||'').toString();}",
    "var vw=window.innerWidth,vh=window.innerHeight;",
    // box-tree isCode replica: PRE at depth 1..3, only descending display:contents wrappers
    "function boxCode(e){if(e.tagName==='PRE')return true;var lv=[e],dep=0;",
    "while(dep<3){var nx=[];for(var gi=0;gi<lv.length;gi++){var ch=lv[gi].children;",
    "for(var qk=0;ch&&qk<ch.length;qk++){var kk=ch[qk];if(kk.tagName==='PRE')return true;",
    "if(getComputedStyle(kk).display==='contents')nx.push(kk);}}lv=nx;dep++;}return false;}",
    "function gl(e){return (e.__dshGlass===undefined?null:e.__dshGlass);}",
    "var CHAN=[['frame','_frame'],['chatRoot','_root'],['centerCol','_centerCol'],",
    "['scrollBody','_scrollBody'],['panelBody','_panelBody'],['surface','_surface_'],",
    "['tabHost','_tabHost_'],['overlayLayer','_overlayLayer']];",
    "var chan={};",
    "for(var ci=0;ci<CHAN.length;ci++){var ckey=CHAN[ci][0],frag=CHAN[ci][1];",
    "var els=document.querySelectorAll('[class*='+JSON.stringify(frag)+']');var best=null,ba=-1;",
    "for(var ei=0;ei<els.length;ei++){var el=els[ei];var rr=el.getBoundingClientRect();",
    "var aa=rr.width*rr.height;if(aa>ba){ba=aa;best=el;}}",
    "if(!best){chan[ckey]=null;continue;}",
    "var cs2=getComputedStyle(best),rr2=best.getBoundingClientRect();",
    "chan[ckey]={cls:(best.className||'').toString().slice(0,50),w:Math.round(rr2.width),",
    "h:Math.round(rr2.height),bg:cs2.backgroundColor,inline:best.style.backgroundColor||'',",
    "prio:best.style.getPropertyPriority('background-color')||'',glass:gl(best),boxCode:boxCode(best)};}",
    "var ms=document.querySelectorAll('div');var card=null,ca=-1;",
    "for(var i=0;i<ms.length;i++){var e=ms[i];",
    "if(cn(e).indexOf('md-code-block')<0)continue;",
    "if(!e.querySelector('pre'))continue;",
    "var r=e.getBoundingClientRect();var a=r.width*r.height;",
    "if(a>ca){ca=a;card=e;}}",
    "var rec=null,bigPre=null;",
    "if(card){",
    "var cs=getComputedStyle(card);var m=RGXS.exec(cs.backgroundColor);",
    "var r2=card.getBoundingClientRect();",
    "var isCode=(card.tagName==='PRE');",
    "if(!isCode&&card.children){for(var q=0;q<card.children.length;q++){",
    "if(card.children[q].tagName==='PRE'){isCode=true;break;}}}",
    "var ib=0,ds=card.querySelectorAll('div,section,main,aside,article,pre,code,table,ul');",
    "for(var d=0;d<ds.length;d++){if(ds[d]===card)continue;var dr=ds[d].getBoundingClientRect();",
    "if(dr.width>vw*0.5&&dr.height>vh*0.5)ib++;}",
    "var pre=card.querySelector('pre');var pr=pre?pre.getBoundingClientRect():null;",
    "if(pre){bigPre={cls:cn(pre).slice(0,40),w:Math.round(pr.width),h:Math.round(pr.height),",
    "bg:getComputedStyle(pre).backgroundColor,inline:pre.style.backgroundColor||'',",
    "seq:(pre.__qaSeq===undefined?null:pre.__qaSeq)};}",
    "var nat=null;",
    "if(NAT){var sv=card.style.getPropertyValue('background-color'),",
    "sp=card.style.getPropertyPriority('background-color');",
    "card.style.removeProperty('background-color');nat=getComputedStyle(card).backgroundColor;",
    "card.style.setProperty('background-color',sv,sp||'');",
    "if((card.style.backgroundColor||'')!==sv)nat='RESTORE_FAIL:'+nat;}",
    "rec={cls:cn(card).slice(0,60),tag:card.tagName,w:Math.round(r2.width),h:Math.round(r2.height),",
    "pos:cs.position,z:cs.zIndex,bg:cs.backgroundColor,",
    "alpha:(m?(m[4]===undefined?1:parseFloat(m[4])):null),",
    "inline:card.style.backgroundColor||'',prio:card.style.getPropertyPriority('background-color')||'',",
    "nodeSeq:(card.__qaSeq===undefined?null:card.__qaSeq),qaRec:card.__qaRec||null,",
    "glass:gl(card),boxCode:boxCode(card),",
    "myIsCode:isCode,myInnerBig:ib,native:nat};}",
    "var cb=window.__qaCb||null,hits=[];",
    "if(cb){for(var k2=0;k2<cb.length;k2++){var o=cb[k2];",
    "if(/md-code-block|_block_|_plain_|_card_|_bannerWrap_/.test(o.cls))hits.push(o);}}",
    "return JSON.stringify({qaN:(window.__qaN===undefined?null:window.__qaN),",
    "cbLen:cb?cb.length:null,cbAll:cb?cb.slice(0,15):null,cardHits:hits,card:rec,bigPre:bigPre,",
    "chan:chan,vw:vw,vh:vh});",
    "})()"
  ].join("");
};

// ---------------- in-page: doc panel (_tabHost_ family, ALL matches, max area first) ----------------
const DOC_PANEL = [
"(function(){",
"var RGXS=" + RGX + ";",
"function cn(e){return (e.className||'').toString();}",
"var ms=document.querySelectorAll('[class*=_tabHost_],[class*=_surface_],[class*=_split_]');",
"var rows=[];",
"for(var i=0;i<ms.length;i++){var e=ms[i];var cs=getComputedStyle(e);",
"var m=RGXS.exec(cs.backgroundColor);var r=e.getBoundingClientRect();",
"rows.push({cls:cn(e).slice(0,60),tag:e.tagName,w:Math.round(r.width),h:Math.round(r.height),",
"pos:cs.position,bg:cs.backgroundColor,alpha:(m?(m[4]===undefined?1:parseFloat(m[4])):null),",
"inline:e.style.backgroundColor||'',prio:e.style.getPropertyPriority('background-color')||'',",
"text:(e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,26)});}",
"rows.sort(function(a,b){return (b.w*b.h)-(a.w*a.h);});",
"return JSON.stringify({count:rows.length,rows:rows.slice(0,14)});",
"})()"
].join("\n");

// ---------------- in-page: header hit-area audit (A14) ----------------
const A14 = [
"(function(){",
"function cn(e){return (e.className||'').toString();}",
"function bx(e){var r=e.getBoundingClientRect();",
"return {x:Math.round(r.left*10)/10,y:Math.round(r.top*10)/10,w:Math.round(r.width*10)/10,",
"h:Math.round(r.height*10)/10,cx:Math.round((r.left+r.width/2)*10)/10,cy:Math.round((r.top+r.height/2)*10)/10,",
"l:Math.round(r.left*10)/10,r:Math.round(r.right*10)/10};}",
"function vis(e){var s=e.querySelector('svg,img');if(!s)s=e.querySelector('span,div');",
"if(!s)return null;var r=s.getBoundingClientRect();",
"return {x:Math.round(r.left*10)/10,y:Math.round(r.top*10)/10,w:Math.round(r.width*10)/10,h:Math.round(r.height*10)/10,",
"cx:Math.round((r.left+r.width/2)*10)/10,cy:Math.round((r.top+r.height/2)*10)/10};}",
"function owner(x,y){if(x<0||y<0||x>window.innerWidth||y>window.innerHeight)return {owner:'OFFSCREEN',self:false};",
"var el=document.elementFromPoint(x,y);if(!el)return {owner:'none',self:false};",
"return {owner:el.tagName+'.'+cn(el).slice(0,44),self:false};}",
"var bs=document.querySelectorAll('button,[role=button]');",
"var rows=[];",
"for(var i=0;i<bs.length;i++){var e=bs[i];var r=e.getBoundingClientRect();",
"if(r.width<=0||r.height<=0)continue;if(r.top>150)continue;",
"var b=bx(e);var v=vis(e);",
"var vc=v?v.cx:b.cx,vy=v?v.cy:b.cy;",
"var el2=document.elementFromPoint(vc,vy);",
"var selfHit=!!(el2&&(el2===e||e.contains(el2)));",
"var el3=document.elementFromPoint(b.cx,b.cy);",
"var selfHitBox=!!(el3&&(el3===e||e.contains(el3)));",
"rows.push({aria:e.getAttribute('aria-label')||'',title:e.getAttribute('title')||'',",
"txt:(e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,18),cls:cn(e).slice(0,46),",
"box:b,vis:v,ownerAtVis:owner(vc,vy).owner,selfHitVis:selfHit,",
"ownerAtBox:owner(b.cx,b.cy).owner,selfHitBox:selfHitBox});}",
"var overlaps=[];",
"for(var a2=0;a2<rows.length;a2++)for(var b2=a2+1;b2<rows.length;b2++){",
"var p=rows[a2].box,q=rows[b2].box;",
"var ox=Math.min(p.r,q.r)-Math.max(p.l,q.l);",
"var oy=Math.min(p.y+p.h,q.y+q.h)-Math.max(p.y,q.y);",
"if(ox>0&&oy>0)overlaps.push({a:rows[a2].aria||rows[a2].txt,b:rows[b2].aria||rows[b2].txt,",
"overlapX:Math.round(ox*10)/10,overlapY:Math.round(oy*10)/10});}",
"var sb=document.querySelector('[class*=_root_]');",
"var sbs=document.querySelectorAll('[class*=_root_]');var wide=null;",
"for(var s=0;s<sbs.length;s++){var rr=sbs[s].getBoundingClientRect();",
"if(rr.width<=320&&rr.height>=300){if(!wide||rr.width*rr.height>wide.w*wide.h){",
"var cs=getComputedStyle(sbs[s]);var mm=RGX2.exec(cs.backgroundColor);",
"wide={cls:cn(sbs[s]).slice(0,60),w:Math.round(rr.width),h:Math.round(rr.height),",
"pos:cs.position,bg:cs.backgroundColor,alpha:(mm?(mm[4]===undefined?1:parseFloat(mm[4])):null),",
"inline:sbs[s].style.backgroundColor||'',prio:sbs[s].style.getPropertyPriority('background-color')||''};}}}",
"return JSON.stringify({vw:window.innerWidth,vh:window.innerHeight,rows:rows,overlaps:overlaps,sidebar:wide});",
"})()"
].join("\n").replace(/RGX2/g, RGX);

// ---------------- in-page: apply() batching hook (installed BEFORE the injection) ----------------
const HOOK = [
"(function(){",
"var H=window.__qaHook={setProps:0,applyRounds:0,rounds:[],t0:Math.round(performance.now())};",
"var proto=window.CSSStyleDeclaration.prototype;",
"var orig=proto.setProperty;",
"proto.setProperty=function(k,v,p){",
"try{if(k==='background-color'){H.setProps++;",
"if(this===document.documentElement.style){H.applyRounds++;",
"if(H.rounds.length<200)H.rounds.push({t:Math.round(performance.now()-H.t0),v:String(v).slice(0,20)});}}}",
"catch(e){}",
"return orig.apply(this,arguments);};",
"})()"
].join("\n");

const CAND = [
"(function(){",
"var vw=window.innerWidth,vh=window.innerHeight;",
"function cn(e){return (e.className||'').toString();}",
"var all=document.querySelectorAll('div,main,section,header,aside,nav,button,textarea,input,ul,li');",
"var cbOk=0,cbNo=0,elig=0,groups={},bigEls=0;",
"function cbn(t){var n=0;var ds=t.querySelectorAll('div,section,main,aside,article,pre,code,table,ul');",
"for(var q=0;q<ds.length;q++){if(ds[q]===t)continue;var rr=ds[q].getBoundingClientRect();",
"if(rr.width>vw*0.5&&rr.height>vh*0.5)n++;}return n;}",
"for(var i=0;i<all.length;i++){var e=all[i];",
"if(e.__cbOk===1)cbOk++;else if(e.__cbOk===0)cbNo++;",
"var r=e.getBoundingClientRect();var b=r.width>vw*0.5&&r.height>vh*0.5;",
"if(b){bigEls++;if(!/_root_/.test(cn(e))&&e.id!=='dsh-theme-veil'&&cbn(e)<=2)elig++;}",
"var iv=e.style.getPropertyValue('background-color');",
"if(iv){var key=iv.replace(/\\d+/g,'N');groups[key]=(groups[key]||0)+1;}",
"}",
"return JSON.stringify({cbOk:cbOk,cbNo:cbNo,eligibleCandidates:elig,bigEls:bigEls,",
"groups:groups,scanned:all.length,vw:vw,vh:vh});",
"})()"
].join("\n");

// ---------------- in-page: S8 boundary (attach a PRE as a DIRECT child of the chat root) ----------------
const S8_INFO = [
"(function(){",
"var vw=window.innerWidth,vh=window.innerHeight;",
"function cn(e){return (e.className||'').toString();}",
"var all=document.querySelectorAll('*');var root=null,ba=-1;",
"for(var i=0;i<all.length;i++){var e=all[i];var r=e.getBoundingClientRect();",
"if(!/(^|_)root(_|$)/.test(cn(e)))continue;if(!(r.width>vw*0.5&&r.height>vh*0.5))continue;",
"var a=r.width*r.height;if(a>ba){ba=a;root=e;}}",
"if(!root)return JSON.stringify({err:'no big _root_ element'});",
"window.__qaS8root=root;",
"var cs=getComputedStyle(root);var RGXS=" + RGX + ";",
"var m=RGXS.exec(cs.backgroundColor);",
"return JSON.stringify({cls:cn(root).slice(0,70),w:Math.round(root.getBoundingClientRect().width),",
"h:Math.round(root.getBoundingClientRect().height),pos:cs.position,bg:cs.backgroundColor,",
"alpha:(m?(m[4]===undefined?1:parseFloat(m[4])):null),inline:root.style.backgroundColor||'',",
"prio:root.style.getPropertyPriority('background-color')||'',",
"kids:root.children.length,childTags:Array.prototype.slice.call(root.children,0,10).map(function(c){return c.tagName+'.'+cn(c).slice(0,24);})});",
"})()"
].join("\n");
const S8_ATTACH = [
"(function(){",
"var root=window.__qaS8root;if(!root)return JSON.stringify({err:'no root handle'});",
"var old=document.getElementById('qa-s8-probe');if(old)old.parentNode.removeChild(old);",
"var d=document.createElement('div');d.id='qa-s8-probe';",
"var p=document.createElement('pre');p.textContent='QA S8 PROBE code block attached as a DIRECT child of the chat root';",
"d.appendChild(p);root.appendChild(d);",
"return JSON.stringify({attached:true,rootKids:root.children.length,tag:root.lastChild.tagName,preIsDirectChildOfRoot:(root.lastChild.tagName==='DIV'&&root.lastChild.firstChild&&root.lastChild.firstChild.tagName==='PRE')});",
"})()"
].join("\n");
const S8_DETACH = [
"(function(){",
"var old=document.getElementById('qa-s8-probe');",
"if(old&&old.parentNode)old.parentNode.removeChild(old);",
"return JSON.stringify({detached:!!old});",
"})()"
].join("\n");

// ---------------- node-side analysis ----------------
function classifyInline(v) {
  if (!v) return "NO_INLINE(injection not in effect / node swap)";
  if (v === "transparent") return "INJ_TRANSPARENT";
  if (/^rgb\(/.test(v)) return "INJ_OPAQUE";
  if (/^rgba\(/.test(v)) return "INJ_TRANSLUCENT";
  return "OTHER:" + v.slice(0, 20);
}
function analyze(samples) {
  const names = new Set();
  samples.forEach((s) => Object.keys(s.out || {}).forEach((n) => names.add(n)));
  const res = {};
  for (const n of Array.from(names)) {
    const series = samples.map((s) => (s.out && s.out[n]) || { absent: true });
    const bgs = series.map((x) => (x.absent ? "ABSENT" : x.bg));
    const changes = [];
    for (let i = 1; i < series.length; i++) {
      if (bgs[i] !== bgs[i - 1]) {
        changes.push({
          i: i, from: bgs[i - 1], to: bgs[i],
          fromInline: series[i - 1].inline || "", toInline: series[i].inline || "",
          fromClass: classifyInline(series[i - 1].inline), toClass: classifyInline(series[i].inline),
          nodeChanged: series[i].id !== series[i - 1].id,
          w: series[i].w, h: series[i].h
        });
      }
    }
    let injOpaque = 0, injFlip = 0, nodeSwap = 0;
    for (const c of changes) {
      if (c.toClass === "INJ_OPAQUE") injOpaque++;
      if (/^INJ_/.test(c.toClass)) injFlip++;
      if (c.toClass === "NO_INLINE(injection not in effect / node swap)") nodeSwap++;
    }
    res[n] = {
      present: series.filter((x) => !x.absent).length,
      series: series.map((x) => (x.absent ? { absent: true } : { bg: x.bg, alpha: x.alpha, inline: x.inline, prio: x.prio, id: x.id, w: x.w, h: x.h, pos: x.pos, cls: x.cls, tag: x.tag })),
      distinct: Array.from(new Set(bgs)),
      flips: changes.length, injOpaqueFlips: injOpaque, injectionFlips: injFlip, nodeSwapFlips: nodeSwap,
      changes: changes
    };
  }
  return res;
}
function shotAlive(name) {
  const before = pidofApp();
  const s = shot(name);
  const after = pidofApp();
  s.pidBefore = before; s.pidAfter = after; s.alive = /^\d+$/.test(before) && before.split(/\s+/)[0] === after.split(/\s+/)[0];
  log("SHOT_ALIVE " + name + " before=" + before + " after=" + after + " alive=" + s.alive);
  return s;
}
async function readSeries(n, gap) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const r = await evJ(READ);
    const cb = await evJ(CBSTATE(k === 0));
    r.cb = cb;
    r.d2 = await evJ(D2STATE);
    if (r.d2) {
      const b0 = (r.d2.blocks && r.d2.blocks[0]) || null;
      log("D2 bwW=" + (r.d2.bwW ? "SET" : "null") + " rail=" + r.d2.bwRailW +
        " sb=" + (r.d2.bwSbEl ? (r.d2.bwSbEl.w + "x" + r.d2.bwSbEl.h + " " + r.d2.bwSbEl.pos + " z" + r.d2.bwSbEl.z + " " + r.d2.bwSbEl.bg) : "null") +
        " blk0=" + (b0 ? (b0.w + "x" + b0.h + " over=" + b0.overHalf) : "-") +
        " centerCol=" + (r.d2.centerCol ? r.d2.centerCol.w : "-") +
        " obs=" + JSON.stringify(r.d2.obs));
    }
    if (cb && cb.card) {
      r.out.codeCard = { id: "Q" + (cb.card.nodeSeq === null ? "-" : cb.card.nodeSeq), tag: cb.card.tag, cls: cb.card.cls, bg: cb.card.bg, alpha: cb.card.alpha, inline: cb.card.inline, prio: cb.card.prio, pos: cb.card.pos, w: cb.card.w, h: cb.card.h, big: (cb.card.w > cb.vw * 0.5 && cb.card.h > cb.vh * 0.5), z: cb.card.z, gateOpen: true, text: "" };
    }
    if (cb && cb.bigPre) {
      r.out.codeCardPre = { id: "P" + (cb.bigPre.seq === null ? "-" : cb.bigPre.seq), tag: "PRE", cls: cb.bigPre.cls, bg: cb.bigPre.bg, alpha: null, inline: cb.bigPre.inline, prio: "", pos: "", w: cb.bigPre.w, h: cb.bigPre.h, big: false, z: "", gateOpen: true, text: "" };
    }
    log("CB qaN=" + (cb ? cb.qaN : "?") + " len=" + (cb ? cb.cbLen : "?") + " card=" + (cb && cb.card ? (cb.card.nodeSeq + " " + cb.card.bg + " inl=" + (cb.card.inline || "-") + " myCode=" + cb.card.myIsCode + " myIB=" + cb.card.myInnerBig + " injRec=" + JSON.stringify(cb.card.qaRec)) : "NONE"));
    out.push(r);
    const line = Object.keys(r.out).map((nm) => nm + "=" + (r.out[nm].bg || (r.out[nm].absent ? "ABSENT" : "?")) + (r.out[nm].inline ? "|inl=" + r.out[nm].inline : "")).join(" ");
    log("S" + k + " t=" + r.t0 + " " + line);
    if (k < n - 1) await sleep(gap);
  }
  return out;
}
async function clickByText(frag) {
  const js = [
    "(function(){var b=document.querySelectorAll('button,[role=button],a,[aria-label]');",
    "for(var i=0;i<b.length;i++){var t=((b[i].getAttribute('aria-label')||'')+' '+(b[i].title||'')+' '+(b[i].textContent||''));",
    "if(t.indexOf(" + JSON.stringify(frag) + ")>=0){var r=b[i].getBoundingClientRect();",
    "if(r.width<=0)return JSON.stringify({found:false,why:'zero-size'});",
    "return JSON.stringify({found:true,x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),",
    "aria:b[i].getAttribute('aria-label')||'',cls:(b[i].className||'').toString().slice(0,40)});}}",
    "return JSON.stringify({found:false,why:'not found'});})()"
  ].join("");
  const hit = await evJ(js);
  if (!hit.found) return hit;
  await clickAt(hit.x, hit.y);
  hit.clickedAt = [hit.x, hit.y];
  return hit;
}
async function dispatchClickByText(frag) {
  const js = [
    "(function(){var b=document.querySelectorAll('button,[role=button],a,[aria-label]');",
    "for(var i=0;i<b.length;i++){var t=((b[i].getAttribute('aria-label')||'')+' '+(b[i].title||'')+' '+(b[i].textContent||''));",
    "if(t.indexOf(" + JSON.stringify(frag) + ")>=0){b[i].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));",
    "return JSON.stringify({found:true,via:'dispatchEvent'});}}",
    "return JSON.stringify({found:false});})()"
  ].join("");
  return await evJ(js);
}
async function sidebarState() {
  const js = [
    "(function(){var s=document.querySelectorAll('[class*=_root_]');var best=null;",
    "for(var i=0;i<s.length;i++){var r=s[i].getBoundingClientRect();",
    "if(r.width<=320&&r.height>=300){if(!best||r.width*r.height>best.a){best={a:r.width*r.height,w:Math.round(r.width),h:Math.round(r.height),cls:(s[i].className||'').toString().slice(0,60),pos:getComputedStyle(s[i]).position};}}}",
    "return JSON.stringify(best?{expanded:best.w>200,sidebar:best}:{expanded:null,sidebar:null});})()"
  ].join("");
  return await evJ(js);
}

// ---------------- navigation helpers ----------------
async function blurActive() {
  return await ev("(function(){var a=document.activeElement;if(a&&a.blur)a.blur();return 'blurred='+(document.activeElement===document.body);})()");
}
async function sheetCount() {
  return await evJ([
    "(function(){var n=0;var ds=document.querySelectorAll('[role=dialog],[class*=sheet],[class*=Sheet],[class*=mask]');",
    "for(var i=0;i<ds.length;i++){var r=ds[i].getBoundingClientRect();",
    "if(r.width>100&&r.height>200&&getComputedStyle(ds[i]).visibility!=='hidden')n++;}",
    "return JSON.stringify({sheets:n});})()"
  ].join(""));
}
async function dismissSheets() {
  const before = await sheetCount();
  for (let k = 0; k < 2; k++) {
    for (const ty of ["keyDown", "keyUp"]) {
      await send("Input.dispatchKeyEvent", { type: ty, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    }
    await sleep(500);
  }
  const after = await sheetCount();
  log("DISMISS before=" + JSON.stringify(before) + " after=" + JSON.stringify(after));
  return { before, after };
}
async function openSidebar() {
  let r = await clickByText("Open sidebar");
  if (!r.found) r = await clickByText("展开侧边栏");
  if (!r.found) r = await clickByText("Open navigation");
  await sleep(2200);
  let st = await sidebarState();
  if (!st.expanded && r.found) {
    const d = await dispatchClickByText("Open sidebar");
    await sleep(2200);
    st = await sidebarState();
    return { click: r, fallback: d, state: st };
  }
  return { click: r, state: st };
}
async function openFirstSession() {
  const js = [
    "(function(){",
    "function cn(e){return (e.className||'').toString();}",
    "var cbtn=null;var bs=document.querySelectorAll('button,[aria-label]');",
    "for(var b=0;b<bs.length;b++){var al=(bs[b].getAttribute('aria-label')||'');",
    "if(al.indexOf('Collapse sidebar')>=0||al.indexOf('\u6536\u8d77\u4fa7\u8fb9\u680f')>=0){cbtn=bs[b];break;}}",
    "if(!cbtn)return JSON.stringify({found:false,why:'no collapse button (sidebar not expanded?)'});",
    "var sb=null,pp=cbtn;",
    "for(var w=0;w<12&&pp;w++){if(/(^|_)(root|sidebar)(_|$)/.test(cn(pp))){",
    "var rr0=pp.getBoundingClientRect();if(rr0.height>=300){sb=pp;break;}}pp=pp.parentElement;}",
    "if(!sb)return JSON.stringify({found:false,why:'no sidebar root ancestor'});",
    "var cand=sb.querySelectorAll('div,a,button,li');var rows=[];var raw=[];",
    "for(var j=0;j<cand.length;j++){var el=cand[j];var rr=el.getBoundingClientRect();",
    "if(rr.width<110||rr.height<20||rr.height>90)continue;",
    "var t=(el.textContent||'').replace(/\\s+/g,' ').trim();",
    "if(t.length<3||t.length>70)continue;",
    "if(/(Workspaces|New Se|Plugin|Setting|Open in|More ways|Agent Team|Standard mode|Full access|Default workspace|Ungrouped|cp_learn|3519dv)/i.test(t))continue;",
    "var isTime=/(\\d+\\s*[smhd]\\b|ago|yesterday)/i.test(t);",
    "raw.push({t:t.slice(0,44),time:isTime,y:Math.round(rr.top),w:Math.round(rr.width),h:Math.round(rr.height)});",
    "if(!isTime)continue;",
    "rows.push({t:t,x:Math.round(rr.left+rr.width/2),y:Math.round(rr.top+rr.height/2),w:Math.round(rr.width),h:Math.round(rr.height)});}",
    "if(!rows.length)return JSON.stringify({found:false,why:'no session rows',sbcls:cn(sb).slice(0,60),sbw:Math.round(sb.getBoundingClientRect().width),raw:raw.slice(0,25)});",
    "rows.sort(function(a,b){return a.y-b.y;});",
    "return JSON.stringify({found:true,rowCount:rows.length,text:rows[0].t,x:rows[0].x,y:rows[0].y,",
    "sbcls:cn(sb).slice(0,60),sbw:Math.round(sb.getBoundingClientRect().width),all:rows.slice(0,10),raw:raw.slice(0,25)});",
    "})()"
  ].join("");
  const hit = await evJ(js);
  if (!hit.found) return hit;
  const pick = Math.max(0, Math.min((hit.rowCount || 1) - 1, ROW_INDEX));
  const row = (hit.all && hit.all[pick]) || hit;
  hit.pickedIndex = pick; hit.pickedText = row.t;
  await clickAt(row.x, row.y);
  await sleep(3500);
  await blurActive();
  await sleep(1200);
  await clickAt(330, 300);
  await sleep(2000);
  await blurActive();
  await sleep(1000);
  if (process.env.QA_NOCOLLAPSE === "1") {
    hit.collapsed = { found: false, why: "QA_NOCOLLAPSE=1 (keep sidebar expanded for D2)" };
  } else {
    let col = await clickByText("Collapse sidebar");
    if (!col.found) col = await clickByText("\u6536\u8d77");
    hit.collapsed = col;
  }
  await sleep(2500);
  hit.chatBody = await evJ([
    "(function(){var RGXS=" + RGX + ";var all=document.querySelectorAll('div,pre');",
    "var body=null,pre=null,pa=-1,pta=-1;",
    "function cn(e){return (e.className||'').toString();}",
    "for(var i=0;i<all.length;i++){var e=all[i];var r=e.getBoundingClientRect();",
    "if(/(^|_)body(_|$)/.test(cn(e))&&r.width>180&&r.height>300){if(!body||r.width*r.height>pa){pa=r.width*r.height;body={cls:cn(e).slice(0,60),w:Math.round(r.width),h:Math.round(r.height)};}}",
    "if(e.tagName==='PRE'&&r.height>pta){pta=r.height;pre={cls:cn(e).slice(0,50),w:Math.round(r.width),h:Math.round(r.height),bg:getComputedStyle(e).backgroundColor,inline:e.style.backgroundColor||''};}}",
    "return JSON.stringify({body:body,biggestPre:pre,preCount:document.querySelectorAll('pre').length,",
    "vw:window.innerWidth,vh:window.innerHeight});})()"
  ].join(""));
  return hit;
}
async function openSlashMenu() {
  const f = await ev("(function(){var t=document.querySelector('textarea');if(!t)return 'NO_TEXTAREA';t.focus();return 'focused='+(document.activeElement===t);})()");
  let ins = "skip";
  try { await send("Input.insertText", { text: "/" }); ins = "ok"; } catch (e) { ins = "err:" + String(e.message).slice(0, 40); }
  await sleep(1600);
  const probe = await evJ([
    "(function(){var RGXS=" + RGX + ";",
    "var ms=document.querySelectorAll('[role=listbox],[role=menu],[role=option]');",
    "var rows=[];",
    "for(var i=0;i<ms.length;i++){var e=ms[i];var cs=getComputedStyle(e);var m=RGXS.exec(cs.backgroundColor);",
    "var r=e.getBoundingClientRect();",
    "rows.push({role:e.getAttribute('role'),tag:e.tagName,cls:(e.className||'').toString().slice(0,60),",
    "w:Math.round(r.width),h:Math.round(r.height),pos:cs.position,z:cs.zIndex,",
    "bg:cs.backgroundColor,alpha:(m?(m[4]===undefined?1:parseFloat(m[4])):null),",
    "inline:e.style.backgroundColor||'',prio:e.style.getPropertyPriority('background-color')||'',",
    "parent:(function(){var p=e.parentElement;if(!p)return'';var c=getComputedStyle(p);var mm=RGXS.exec(c.backgroundColor);",
    "return (p.className||'').toString().slice(0,40)+'|bg='+c.backgroundColor+'|inline='+(p.style.backgroundColor||'');})()});}",
    "return JSON.stringify({ta:(function(){var t=document.querySelector('textarea');return t?t.value:'NO_TA';})(),count:rows.length,rows:rows});})()"
  ].join(""));
  return { focus: f, insert: ins, menu: probe };
}
async function clearTextarea() {
  return await ev([
    "(function(){var t=document.querySelector('textarea');if(!t)return 'NO_TA';",
    "var d=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value');",
    "if(d&&d.set){d.set.call(t,'');}else{t.value='';}",
    "t.dispatchEvent(new Event('input',{bubbles:true}));return 'cleared='+(t.value==='');})()"
  ].join(""));
}
async function clickFileCard() {
  const js = [
    "(function(){",
    "function cn(e){return (e.className||'').toString();}",
    "var all=document.querySelectorAll('button,[role=button],a,div,span');",
    "var hits=[];",
    "for(var i=0;i<all.length;i++){var e=all[i];var t=((e.getAttribute&&e.getAttribute('aria-label'))||'')+' '+(e.title||'')+' '+(e.textContent||'');",
    "if(!/\\.(md|ts|js|kt|json|txt|py|tsx|jsx|sh|yml|yaml|diff|patch)\\b/i.test(t))continue;",
    "if(t.length>120)continue;var r=e.getBoundingClientRect();",
    "if(r.width<20||r.height<12||r.top<0||r.top>window.innerHeight)continue;",
    "hits.push({t:t.replace(/\\s+/g,' ').trim().slice(0,60),x:Math.round(r.left+Math.min(r.width/2,40)),y:Math.round(r.top+r.height/2),w:Math.round(r.width),h:Math.round(r.height),cls:cn(e).slice(0,40)});}",
    "for(var h2=0;h2<all.length;h2++){var e3=all[h2];var t3=(e3.textContent||'').replace(/\\s+/g,' ').trim();",
    "if(!/^(Edited \\d+ files|All \\d+ files|\\u5df2\\u7f16\\u8f91 \\d+ \\u4e2a\\u6587\\u4ef6|\\u5168\\u90e8 \\d+ \\u4e2a\\u6587\\u4ef6)/i.test(t3))continue;",
    "var r3=e3.getBoundingClientRect();if(r3.width<60||r3.height<14||r3.top<0)continue;",
    "hits.push({t:t3.slice(0,60),x:Math.round(r3.left+Math.min(r3.width/2,60)),y:Math.round(r3.top+r3.height/2),w:Math.round(r3.width),h:Math.round(r3.height),fallback:true});}",
    "if(!hits.length)return JSON.stringify({found:false,why:'no file-looking element'});",
    "return JSON.stringify({found:true,hits:hits.slice(0,8)});})()"
  ].join("");
  const hit = await evJ(js);
  if (!hit.found) return hit;
  await clickAt(hit.hits[0].x, hit.hits[0].y);
  await sleep(3000);
  return hit;
}

// ---------------- modes ----------------
async function main() {
  const t0 = Date.now();
  const shaBefore = EXPECTED ? apkSha() : "SKIP";
  if (EXPECTED && shaBefore !== EXPECTED) { log("HASH_GATE FAIL before=" + shaBefore + " expected=" + EXPECTED); process.exit(2); }
  log("HASH_GATE before=" + shaBefore);
  const pid = await startFresh();
  const res = { mode: MODE, url: URL.replace(/token=[^&]+/, "token=REDACTED"), tag: TAG, pid: pid, shaBefore: shaBefore, openSession: OPEN_SESSION, startedAt: new Date().toISOString() };
  if (OPEN_SESSION) {
    res.nav = { sidebar: await openSidebar(), session: await openFirstSession() };
    log("NAV " + JSON.stringify(res.nav).slice(0, 400));
    await blurActive();
    await sleep(2500);
  }

  if (MODE === "discover") {
    res.discover = await evJ(DISCOVER);
    res.read = await evJ(READ);
    res.shots = [shotAlive("qa-" + TAG + "-discover")];
  } else if (MODE === "sample") {
    res.samples = await readSeries(8, 700);
    res.analysis = analyze(res.samples);
    res.vw = res.samples[0].vw; res.vh = res.samples[0].vh;
    res.codeblocks = await evJ(CODEBLOCKS);
    res.docPanel = await evJ(DOC_PANEL);
    res.discover = await evJ(DISCOVER);
    res.shots = [shotAlive("qa-" + TAG + "-sample")];
  } else if (MODE === "perf") {
    res.reopen = await openSidebar();
    log("REOPEN " + JSON.stringify(res.reopen).slice(0, 200));
    await sleep(1500);
    res.hook = await evJ(PERF_HOOK);
    log("HOOK " + JSON.stringify(res.hook));
    res.perfSamples = [];
    for (let k = 0; k < 8; k++) {
      await scrollBurst();
      const s = await evJ(PERF_READ);
      res.perfSamples.push(s);
      log("PERF " + k + " " + JSON.stringify(s).slice(0, 240));
    }
    res.perfFinal = await evJ(PERF_READ);
    res.d2 = await evJ(D2STATE);
    res.shots = [shotAlive("qa-" + TAG + "-perf")];
  } else if (MODE === "d2e") {
    res.dismiss = await dismissSheets();
    res.reopen = await openSidebar();
    log("REOPEN " + JSON.stringify(res.reopen).slice(0, 300));
    await sleep(1500);
    res.samples = await readSeries(8, 700);
    res.analysis = analyze(res.samples);
    res.d2 = await evJ(D2STATE);
    res.codeblocks = await evJ(CODEBLOCKS);
    res.docPanel = await evJ(DOC_PANEL);
    res.shots = [shotAlive("qa-" + TAG + "-d2e")];
  } else if (MODE === "d2") {
    res.dismiss = await dismissSheets();
    res.samples = await readSeries(8, 700);
    res.analysis = analyze(res.samples);
    res.d2 = await evJ(D2STATE);
    res.codeblocks = await evJ(CODEBLOCKS);
    res.docPanel = await evJ(DOC_PANEL);
    res.discover = await evJ(DISCOVER);
    res.shots = [shotAlive("qa-" + TAG + "-d2")];
  } else if (MODE === "redline") {
    res.read = await evJ(READ);
    res.codeblocks = await evJ(CODEBLOCKS);
    res.docPanel = await evJ(DOC_PANEL);
    res.discover = await evJ(DISCOVER);
    res.shots = [shotAlive("qa-" + TAG + "-redline")];
  } else if (MODE === "menu") {
    res.menuOpen = await openSlashMenu();
    res.read = await evJ(READ);
    res.shots = [shotAlive("qa-" + TAG + "-menu")];
    res.samples = await readSeries(8, 700);
    res.analysis = analyze(res.samples);
    res.clear = await clearTextarea();
  } else if (MODE === "docpanel") {
    if (OPEN_SESSION) {
      res.nav = { sidebar: await openSidebar(), session: await openFirstSession() };
      log("NAV " + JSON.stringify(res.nav).slice(0, 260));
      await blurActive();
      await sleep(2500);
    }
    res.fileCard = await clickFileCard();
    res.read = await evJ(READ);
    res.docPanel = await evJ(DOC_PANEL);
    res.discover = await evJ(DISCOVER);
    res.shots = [shotAlive("qa-" + TAG + "-docpanel")];
    res.samples = await readSeries(8, 700);
    res.analysis = analyze(res.samples);
  } else if (MODE === "closepanel") {
    res.before = await evJ(DOC_PANEL);
    for (const ty of ["keyDown", "keyUp"]) {
      await send("Input.dispatchKeyEvent", { type: ty, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    }
    await sleep(1500);
    res.afterEsc = await evJ(DOC_PANEL);
    const js = [
      "(function(){",
      "function cn(e){return (e.className||'').toString();}",
      "var all=document.querySelectorAll('[aria-label],[title],button');",
      "var hits=[];",
      "for(var i=0;i<all.length;i++){var e=all[i];",
      "var t=((e.getAttribute&&e.getAttribute('aria-label'))||'')+' '+(e.title||'');",
      "if(!/close|\\u5173\\u95ed/i.test(t))continue;var r=e.getBoundingClientRect();",
      "if(r.width<8||r.height<8||r.top<0||r.top>window.innerHeight)continue;",
      "hits.push({t:t.trim().slice(0,40),cls:cn(e).slice(0,40),inPane:cn(e).indexOf('6nhg2')>=0||!!e.closest('[class*=_pane_]'),",
      "x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),w:Math.round(r.width),h:Math.round(r.height)});}",
      "hits.sort(function(a,b){return (b.inPane?1:0)-(a.inPane?1:0);});",
      "return JSON.stringify({found:hits.length>0,hits:hits.slice(0,6)});})()"
    ].join("");
    const hit = await evJ(js);
    res.closeHits = hit;
    if (hit.found) {
      await clickAt(hit.hits[0].x, hit.hits[0].y);
      await sleep(2500);
    }
    res.after = await evJ(DOC_PANEL);
    res.read = await evJ(READ);
    res.shots = [shotAlive("qa-" + TAG + "-closed")];
  } else if (MODE === "applycount") {
    await send("Page.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK });
    await send("Page.reload", { ignoreCache: true });
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
      await sleep(2000);
      try { ready = !!(await ev("(document.documentElement.style.backgroundColor==='transparent'&&document.body&&document.body.children.length>0)")); } catch {}
    }
    res.readyAfterReload = ready;
    await sleep(6000);
    res.hook = await evJ("JSON.stringify(window.__qaHook||null)");
    res.cand = await evJ(CAND);
    await sleep(4000);
    res.hook2 = await evJ("JSON.stringify(window.__qaHook||null)");
    res.cand2 = await evJ(CAND);
    res.read = await evJ(READ);
    res.shots = [shotAlive("qa-" + TAG + "-applycount")];
  } else if (MODE === "s8") {
    if (OPEN_SESSION) {
      res.nav = { sidebar: await openSidebar(), session: await openFirstSession() };
      log("NAV " + JSON.stringify(res.nav).slice(0, 300));
      await blurActive();
      await sleep(2500);
    }
    res.rootBefore = await evJ(S8_INFO);
    res.attach = await evJ(S8_ATTACH);
    await sleep(2500);
    res.rootWithPre = await evJ(S8_INFO);
    res.readWithPre = await evJ(READ);
    await sleep(2500);
    res.rootWithPre2 = await evJ(S8_INFO);
    res.shots = [shotAlive("qa-" + TAG + "-s8-withpre")];
    res.detach = await evJ(S8_DETACH);
    await sleep(2500);
    res.rootAfter = await evJ(S8_INFO);
  } else if (MODE === "a14") {
    res.collapsed = await sidebarState();
    res.a14Collapsed = await evJ(A14);
    res.shots = [shotAlive("qa-" + TAG + "-a14-collapsed")];
    let open = await clickByText("Open sidebar");
    if (!open.found) open = await clickByText("展开");
    res.openClick = open;
    await sleep(2500);
    res.expandedState = await sidebarState();
    if (!res.expandedState.expanded && open.found) {
      res.openClick2 = await dispatchClickByText("Open sidebar");
      await sleep(2500);
      res.expandedState = await sidebarState();
    }
    res.a14Expanded = await evJ(A14);
    res.shots.push(shotAlive("qa-" + TAG + "-a14-expanded"));
    res.samplesExpanded = await readSeries(8, 700);
    res.analysisExpanded = analyze(res.samplesExpanded);
    let close = await clickByText("Collapse sidebar");
    if (!close.found) close = await clickByText("收起");
    res.closeClick = close;
    await sleep(2000);
    res.afterClose = await sidebarState();
  } else {
    throw new Error("unknown mode " + MODE);
  }

  res.shaAfter = EXPECTED ? apkSha() : "SKIP";
  res.pidAfter = pidofApp();
  res.elapsedMs = Date.now() - t0;
  res.finishedAt = new Date().toISOString();
  if (OUT) { fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(res, null, 1), "utf8"); }
  log("WROTE " + OUT + " shaAfter=" + res.shaAfter + " shaMatch=" + (res.shaBefore === res.shaAfter));
  if (ws) { try { ws.close(); } catch {} }
}
main().catch((e) => { log("FATAL " + String((e && e.stack) || e).slice(0, 500)); process.exit(3); });