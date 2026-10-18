// 窄屏注入的「宿主 x 收起/展开」四态几何矩阵（v1.32.18 之后成为发布第 10 项检查）。
// 为什么要有它：v1.32.17 那个 P1（聊天列被钉成 56px、正文一字一行）穿过了 9/9，
// 因为流水线里**一个列宽断言都没有**（只测卡片底色与壁纸红线）。见 GLASS-OVERLAY.md 11.14。
//
// 用法：node verify/geom-matrix.mjs [--hot] [--json] [--shots DIR] [--adb PATH] [--serial S] [--prefs FILE] [--hosts 名,名] [--states 状态,状态] [--noshot]
//   最快内环（改完注入段只想看一眼）：node verify/geom-matrix.mjs --hot --noshot --states collapsed  ≈8s
//   冷跑（默认）：force-stop + am start 打开宿主，测两态 —— 这是**真机口径**，发版用它。
//   热跑（--hot）：**只是烟雾测，不能当闸门**（2026-10-16 反向对照实测）。
//     做法：不重新打包，把当前源码里的注入 JS 抽出来，导航到宿主后在页面上再求值一遍。
//     为什么不能当闸门：已装 apk 的注入段**自带 MutationObserver 在持续纠页**，而且段内有
//     `if(window.__bwPanelClose)return;` 这类幂等闸门 ⇒ 第二次求值的**坏**代码会被已装的正确代码
//     当场修回去。反向对照：把 v1.32.18 的两道闸**全拆掉**（=D11 原样，正是那个把聊天列钉成 56px 的
//     版本），热跑仍读 304/PASS；同一天所有热跑数字与冷跑**逐格相同** ⇒ 它测的其实是已装包的行为。
//     结论：改注入段要判对错，**只有冷跑（重新打包装机）算数**；热跑只用来快速看「页面还在不在、
//     几何有没有明显异常」。
// 退出码：0 = PASS，1 = FAIL，2 = 环境/连接问题。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.indexOf(n) >= 0;
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const ADB = opt('--adb', 'G:/Android/Sdk/platform-tools/adb.exe');
const SER = opt('--serial', 'emulator-5554');
const SHOTS = opt('--shots', here);
const HOT = flag('--hot');
const JSONOUT = flag('--json');
const HOSTNAMES = (opt('--hosts', '笔电,测试VM1')).split(',');
// 开发内环用：--states collapsed 只测一个状态、--noshot 不截图（截图 4 张 ≈8s 是内环最大开销）
const STATES = (opt('--states', 'collapsed,expanded')).split(',');
const NOSHOT = flag('--noshot');
const PKG = 'xyz.cpyh.dshpush';
const PORT = 9223;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (a, enc) => execFileSync(ADB, ['-s', SER].concat(a), { encoding: enc === undefined ? 'utf8' : enc, maxBuffer: 64e6 });
function hostsFromPrefs() {
  let f = opt('--prefs', '');
  if (!f) {
    try { adb(['root']); } catch {}
    f = (process.env.TEMP || '/tmp') + '/geom-prefs-' + SER + '.xml';
    adb(['pull', '/data/data/' + PKG + '/shared_prefs/dshpush.xml', f]);
  }
  let t = fs.readFileSync(f, 'utf8');
  t = t.split('&quot;').join(String.fromCharCode(34)).split('&apos;').join(String.fromCharCode(39)).split('&lt;').join('<').split('&gt;').join('>').split('&amp;').join('&');
  const m = t.match(new RegExp('name=' + String.fromCharCode(34) + 'hosts' + String.fromCharCode(34) + '[^>]*>([\\s\\S]*?)</string>'));
  if (!m) throw new Error('prefs 里没有 hosts');
  const arr = JSON.parse(m[1]);
  return HOSTNAMES.map((n) => {
    const h = arr.filter((x) => String(x.name).indexOf(n) >= 0)[0];
    if (!h) throw new Error('宿主 ' + n + ' 不在 prefs 里（现有：' + arr.map((x) => x.name).join('/') + '）');
    return { name: h.name, url: h.url || h.baseUrl };
  });
}
const PROBE = "(" + "function(){var J=JSON.stringify;function R(n){if(!n)return null;var r=n.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.left)}}function A(n){if(!n)return null;var cs=getComputedStyle(n);var m=(n.getAttribute('style')||'').match(/background-color:[^;]+/);return {bg:cs.backgroundColor,inline:m?m[0].slice(0,60):''}}var o={};o.vw=window.innerWidth;o.vh=window.innerHeight;o.host=location.host;o.pinned=!!window.__bwW;o.sbPub=!!window.__bwSbEl;var fc=document.querySelector('[class*=centerCol]');o.centerCol=R(fc);o.convVar=fc?String(getComputedStyle(fc).getPropertyValue('--dsh-conversation-column-width')).trim():'';var sb=window.__bwSbEl||null;var list=document.querySelectorAll('div,section,aside');var best=null;for(var i=0;i<list.length;i++){var q=list[i];var cls=String(q.className);if(cls.indexOf('_root')<0)continue;var r=q.getBoundingClientRect();if(r.height<o.vh*0.6||r.left>2)continue;if(!best||r.width<best.getBoundingClientRect().width)best=q}sb=sb||best||document.querySelector('[class*=_root]');o.sbFromCls=!!window.__bwSbEl?'__bwSbEl':'fallback';o.sbCls=sb?String(sb.className).slice(0,60):null;o.sbRect=R(sb);o.sbBg=A(sb);var de=getComputedStyle(document.documentElement);o.docBg=de.backgroundColor;o.bodyBg=document.body?getComputedStyle(document.body).backgroundColor:null;return J(o)})()";
let ws = null, id = 0; const pend = new Map();
const send = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); setTimeout(() => { if (pend.delete(i)) rej(new Error('CDP 超时 ' + m)); }, 30000); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('JS:' + JSON.stringify(r.exceptionDetails).slice(0, 200)); return r.result && r.result.value; };
async function connect() {
  let pid = '';
  for (let a = 1; a <= 15; a++) {
    try { pid = String(adb(['shell', 'pidof', PKG])).trim().split(/\s+/)[0]; } catch {}
    if (/^\d+$/.test(pid)) break;
    await sleep(1500);
  }
  if (!/^\d+$/.test(pid)) throw new Error('拿不到 App pid');
  try { adb(['forward', '--remove-all']); } catch {}
  adb(['forward', 'tcp:' + PORT, 'localabstract:webview_devtools_remote_' + pid]);
  let page = null;
  for (let a = 1; a <= 10 && !page; a++) {
    try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); page = l.filter((t) => t.type === 'page').pop(); } catch {}
    if (!page) await sleep(1500);
  }
  if (!page) throw new Error('没有 page target');
  if (ws) { try { ws.close(); } catch {} }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  id = 0; pend.clear();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error('cdp')) : p.res(m.result); } });
}
// 就绪判据（替掉今天那种 16s + 9s 的固定 sleep：实测第一次尝试就连上、页面远早于 16s 就绪）
async function waitReady(capMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < capMs) {
    let ok = false;
    try { ok = await ev("(function(){var c=document.querySelector('[class*=centerCol]');return !!(c&&c.getBoundingClientRect().width>0&&document.body&&document.body.innerText.length>20)})()"); } catch {}
    if (ok) { await sleep(1500); return Math.round(Date.now() - t0); }
    await sleep(1000);
  }
  return -1;
}
async function openCold(url) {
  try { adb(['shell', 'am', 'force-stop', PKG]); } catch {}
  await sleep(1000);
  adb(['shell', 'am', 'start', '-n', PKG + '/.WebActivity', '--es', 'url', url]);
  await sleep(2500);
  await connect();
  return waitReady(30000);
}
async function openHot(url) {
  await connect();
  await send('Page.enable');
  await send('Page.navigate', { url });
  await sleep(2000);
  return waitReady(30000);
}
async function toggle() {
  // 先关右面板（若在开）：右面板是 absolute 满屏透明浮层，会吞掉左栏开关的点击
  // （2026-10-18 VM1 实测：右面板开着时点 "Open sidebar" 落在浮层上，左栏永远展不开，expanded 格恒读 56/0.45）
  const rp = await ev("(function(){var b=document.querySelectorAll('button,[role=button]');for(var i=0;i<b.length;i++){var a=(b[i].getAttribute('aria-label')||'')+' '+(b[i].title||'');if(a.indexOf('Collapse right sidebar')>=0||a.indexOf('收起右侧边栏')>=0){var r=b[i].getBoundingClientRect();if(r.width>0)return JSON.stringify([Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)])}}return null})()");
  if (rp) {
    const p = JSON.parse(rp);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p[0], y: p[1], button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p[0], y: p[1], button: 'left', clickCount: 1 });
    await sleep(1200);
  }
  const pos = await ev("(function(){var b=document.querySelectorAll('button,[role=button]');for(var i=0;i<b.length;i++){var a=(b[i].getAttribute('aria-label')||'')+' '+(b[i].title||'');if(a.indexOf('Open sidebar')>=0||a.indexOf('Collapse sidebar')>=0){var r=b[i].getBoundingClientRect();if(r.width>0&&r.width<90&&r.top<300)return JSON.stringify([Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)])}}return null})()");
  if (!pos) return false;
  const xy = JSON.parse(pos);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: xy[0], y: xy[1], button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: xy[0], y: xy[1], button: 'left', clickCount: 1 });
  await sleep(1800);
  return true;
}
async function shot(tag) {
  try {
    const buf = execFileSync(ADB, ['-s', SER, 'exec-out', 'screencap', '-p'], { encoding: 'buffer', maxBuffer: 64e6 });
    const p = path.join(SHOTS, 'geom-' + tag + '.png');
    fs.writeFileSync(p, buf);
    return p + ' ' + buf.length + 'B';
  } catch (e) { return '截图失败 ' + String(e.message).slice(0, 40); }
}
function alphaOf(bg) { const m = String(bg || '').match(/rgba?\(([^)]*)\)/); if (!m) return null; const p = m[1].split(','); return p.length >= 4 ? Number(p[3]) : 1; }
function judge(tag, o) {
  const bad = [];
  const cw = o.centerCol ? o.centerCol.w : 0;
  const min = Math.round(o.vw * 0.8);
  if (cw < min) bad.push('聊天列 ' + cw + ' < 0.8vw(' + min + ')');
  const a = alphaOf(o.sbBg && o.sbBg.bg);
  const want = tag.indexOf('expanded') >= 0 ? [0.87, 0.97] : [0.4, 0.5];
  if (a === null) bad.push('读不到侧栏 alpha');
  else if (a < want[0] || a > want[1]) bad.push('侧栏 alpha ' + a + ' 不在 [' + want[0] + ',' + want[1] + ']');
  const tr = String(o.docBg).indexOf('rgba(0, 0, 0, 0)') >= 0 || String(o.docBg) === 'transparent';
  if (!tr) bad.push('页面不透明(壁纸红线) html=' + o.docBg);
  return bad;
}
const rows = [];
let envErr = null;
try {
  const hosts = hostsFromPrefs();
  // 复用入库的抽取器（单一真值），用 process.execPath ⇒ 不写死 node 路径
  const js = HOT ? execFileSync(process.execPath, [path.join(here, 'extract-injected-js.mjs')], { encoding: 'utf8', maxBuffer: 16e6 }).trim() : null;
  for (const h of hosts) {
    const key = h.name.replace(/[\\/:*?"<>|\s]+/g, '') || 'host';
    let ready;
    if (HOT) { ready = await openHot(h.url); await ev(js); await sleep(1200); }
    else { ready = await openCold(h.url); }
    for (const state of STATES) {
      if (state === 'expanded') { const t = await toggle(); if (!t) { rows.push({ host: h.name, state, ready, fail: ['找不到侧栏切换按钮'] }); continue; } }
      const o = JSON.parse(await ev(PROBE));
      const fail = judge(state, o);
      const s = NOSHOT ? '(略)' : await shot(key + '-' + state);
      rows.push({ host: h.name, state, ready, cw: o.centerCol ? o.centerCol.w : 0, vw: o.vw, sbw: o.sbRect ? o.sbRect.w : 0, alpha: alphaOf(o.sbBg && o.sbBg.bg), pinned: o.pinned, sbPub: o.sbPub, docBg: o.docBg, shot: s, fail });
    }
  }
} catch (e) { envErr = String(e && e.message).slice(0, 160); }
if (!JSONOUT) {
  console.log('模式 = ' + (HOT ? '热跑(仅烟雾测，不能当闸门)' : '冷跑(真机口径)'));
  if (HOT) console.log('  ⚠ 热跑测的是已装包的行为：已装注入段的观察者在持续纠页，会把你第二次求值的坏代码修回去。');
  for (const r of rows) {
    console.log('  ' + r.host.padEnd(10) + ' ' + r.state.padEnd(9) + ' 就绪=' + String(r.ready).padEnd(6) + ' 聊天列=' + String(r.cw).padEnd(5) + ' 侧栏=' + String(r.sbw).padEnd(5) + ' alpha=' + String(r.alpha).padEnd(5) + ' 钉住=' + r.pinned + ' 截图=' + r.shot);
    if (r.fail && r.fail.length) console.log('      ✗ ' + r.fail.join(' ; '));
  }
}
const fails = rows.filter((r) => r.fail && r.fail.length);
const verdict = envErr ? 'ENV' : (rows.length === 0 ? 'ENV' : (fails.length ? 'FAIL' : 'PASS'));
const payload = JSON.stringify({ mode: HOT ? 'hot' : 'cold', verdict, envErr, states: rows.length, fails: fails.map((r) => r.host + '/' + r.state + ': ' + r.fail.join('; ')) });
// --json-out：把结论写进文件。发布流水线靠这个文件取结论，不依赖 stdout 捕获
// （cmd /c 在多对引号的命令行上会剥掉最外层引号，曾把看门狗的 > 重定向变成 node 的参数，输出全丢）。
const jout = opt('--json-out', '');
if (jout) fs.writeFileSync(jout, payload);
if (JSONOUT) console.log(payload);
console.log('VERDICT: ' + verdict + (envErr ? '  env=' + envErr : '') + '  states=' + rows.length + ' fails=' + fails.length);
if (ws) { try { ws.close(); } catch {} }
process.exit(verdict === 'PASS' ? 0 : verdict === 'FAIL' ? 1 : 2);
