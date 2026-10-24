// 果冻波动回归（用户 m03761）：页面最底部、顶栏未隐藏时来回上下滑，页面果冻波动。
// 根因（探针抓到）：栏切换改 WebView 高度 25px，聊天页"钉底"自动补偿 scrollTop，
// 这记孤立单跳回声（±25、延迟 ~490ms）被 QR 当手势 → hide↔show 自激（无触摸自振 8 次）。
// 修法：连续两帧同向增量才切换 + 450ms 冷却锁。
// 信号：window.innerHeight（显示 710 / 收起 735，相对冷启动读数 H0 判定）。
// 退出码 0=PASS 1=FAIL 2=ENV。用法：node C:/Temp/jelly-test.mjs
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const ADB = 'G:/Android/Sdk/platform-tools/adb.exe', SER = 'emulator-5554', PKG = 'xyz.cpyh.dshpush', PORT = 9223;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (a) => execFileSync(ADB, ['-s', SER].concat(a), { encoding: 'utf8', maxBuffer: 64e6 });
let ws = null, id = 0; const pend = new Map();
const send = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); setTimeout(() => { if (pend.delete(i)) rej(new Error('CDP 超时 ' + m)); }, 30000); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('JS:' + JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result && r.result.value; };

function hostUrl() {
  try { adb(['root']); } catch {}
  const f = 'C:/Temp/jelly-prefs.xml';
  adb(['pull', '/data/data/' + PKG + '/shared_prefs/dshpush.xml', f]);
  let t = fs.readFileSync(f, 'utf8')
    .split('&quot;').join('"').split('&apos;').join("'").split('&lt;').join('<').split('&gt;').join('>').split('&amp;').join('&');
  const m = t.match(/name="hosts"[^>]*>([\s\S]*?)<\/string>/);
  const h = JSON.parse(m[1]).filter((x) => String(x.name).indexOf('笔电') >= 0)[0];
  if (!h) throw new Error('宿主 笔电 不在 prefs');
  return h.url || h.baseUrl;
}
try { adb(['shell', 'am', 'force-stop', PKG]); } catch {}
await sleep(800);
adb(['shell', 'am', 'start', '-n', PKG + '/.WebActivity', '--es', 'url', hostUrl()]);
let pid = '';
for (let a = 1; a <= 15; a++) { try { pid = String(adb(['shell', 'pidof', PKG])).trim().split(/\s+/)[0]; } catch {} if (/^\d+$/.test(pid)) break; await sleep(1500); }
if (!/^\d+$/.test(pid)) { console.log('ENV: 没拿到 pid'); process.exit(2); }
try { adb(['forward', '--remove-all']); } catch {}
adb(['forward', 'tcp:' + PORT, 'localabstract:webview_devtools_remote_' + pid]);
let page = null;
for (let a = 1; a <= 12 && !page; a++) { try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); page = l.filter((t) => t.type === 'page').pop(); } catch {} if (!page) await sleep(1500); }
if (!page) { console.log('ENV: 没有 page target'); process.exit(2); }
ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error('cdp')) : p.res(m.result); } });
async function waitReady(capMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < capMs) {
    let rdy = false;
    try { rdy = await ev("(function(){var c=document.querySelector('[class*=centerCol]');return !!(c&&c.getBoundingClientRect().width>0&&document.getElementById('bw-whale-fab'))})()"); } catch {}
    if (rdy) { await sleep(1500); return Math.round(Date.now() - t0); }
    await sleep(1000);
  }
  return -1;
}
if ((await waitReady(60000)) < 0) { console.log('ENV: 页面没就绪'); process.exit(2); }

const H0 = await ev('window.innerHeight'); // 冷启动=栏显示
const state = async () => { const h = await ev('window.innerHeight'); return h >= H0 + 12 ? 'hide' : h <= H0 + 6 ? 'show' : 'mid'; };
const touch = (type, x, y) => send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 8, radiusY: 8, force: 1 }] });
async function drag(x, y1, y2, steps = 8) {
  await touch('touchStart', x, y1);
  for (let i = 1; i <= steps; i++) { await touch('touchMove', x, Math.round(y1 + ((y2 - y1) * i) / steps)); await sleep(16); }
  await sleep(60); await touch('touchEnd', x, y2); await sleep(120);
}
const toBottom = () => ev('(function(){var all=document.querySelectorAll("*"),best=null;for(var i=0;i<all.length;i++){var e=all[i];if(e.clientHeight>=400&&e.scrollHeight>e.clientHeight+200&&(!best||e.scrollHeight>best.scrollHeight))best=e;}window.__qrT=best;best.scrollTop=best.scrollHeight;return !!best})()');
const stable = async (ms1, ms2) => { const a = await state(); await sleep(ms1); const b = await state(); await sleep(ms2); const c = await state(); return a === b && b === c; };
let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) fails++; };

ok('主滚动容器存在且置底', !!(await toBottom()));
await sleep(3200); // 过 2.5s 加载宽限窗

// 1) 核心回归：底部静置 3s，不得有无触摸自振（旧版此处自振 8 次）
ok('底部静置 3s 无自振（果冻根因）', await stable(1000, 1000), 'states 3 次采样');

// 2) 底部上滑（到底了内容不动）：栏态不变
const s0 = await state();
await drag(180, 500, 150);
await sleep(800);
ok('底部上滑（无位移）栏态不变', (await state()) === s0, 's0=' + s0);

// 3) 下滑离开底部（scroll up）：show 是无操作，栏应保持显示
await drag(180, 150, 500);
await sleep(800);
ok('下滑离开底部栏仍显示', (await state()) === 'show');

// 4) 上滑回底部（scroll down）：收起一次，且之后 1.5s 稳定不回翻
await drag(180, 500, 150);
await sleep(800);
ok('上滑回底部收起顶栏', (await state()) === 'hide');
ok('收起后 1.5s 稳定（无回声回翻）', await stable(800, 700));

// 5) 用户手势：回底部后快速来回上下滑 4 轮，每次手势后状态必须稳定（无波动）
await toBottom(); await sleep(600);
let wob = 0;
for (let i = 0; i < 4; i++) {
  await drag(180, 500, 150, 6); if (!(await stable(600, 600))) wob++;
  await drag(180, 150, 500, 6); if (!(await stable(600, 600))) wob++;
}
ok('来回上下滑无果冻波动（4 轮全稳定）', wob === 0, 'wob=' + wob);

console.log(fails ? 'JELLY FAIL ' + fails : 'JELLY PASS 6/6');
process.exit(fails ? 1 : 0);
