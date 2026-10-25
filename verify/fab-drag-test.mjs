// FAB 拖动/吸附/半隐 验收（v1.33.30，用户 m02856）。真机口径：冷跑 WebActivity，
// 用 CDP Input.dispatchTouchEvent（真触摸语义：隐式 pointer capture + click 合成）驱动。
// 断言链：默认左吸附(-22 露1/2 半透) → 点钮展开(钮全显 6 全透) → 再点收起(回 -22) →
//   拖到右侧中部 → 右吸附(vw-22, y 跟手, 半透) + localStorage 记 side=right →
//   点右缘露出的半圆展开(钮 vw-50) → 再点收起(回 vw-22) → 刷新页面位置仍在。
// 退出码 0=PASS 1=FAIL 2=ENV。用法：node verify/fab-drag-test.mjs [--hosts 笔电]
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const ADB = opt('--adb', 'G:/Android/Sdk/platform-tools/adb.exe');
const SER = opt('--serial', 'emulator-5554');
const HOSTNAME = opt('--hosts', '笔电');
const PKG = 'xyz.cpyh.dshpush';
const PORT = 9223;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (a) => execFileSync(ADB, ['-s', SER].concat(a), { encoding: 'utf8', maxBuffer: 64e6 });
let fails = 0;
const ck = (name, cond, got) => { console.log((cond ? '  ok  ' : '  FAIL') + ' ' + name + '  ' + JSON.stringify(got)); if (!cond) fails++; };

function hostUrl() {
  try { adb(['root']); } catch {}
  const f = (process.env.TEMP || '/tmp') + '/fab-prefs.xml';
  adb(['pull', '/data/data/' + PKG + '/shared_prefs/dshpush.xml', f]);
  let t = fs.readFileSync(f, 'utf8')
    .split('&quot;').join('"').split('&apos;').join("'").split('&lt;').join('<').split('&gt;').join('>').split('&amp;').join('&');
  const m = t.match(/name="hosts"[^>]*>([\s\S]*?)<\/string>/);
  const h = JSON.parse(m[1]).filter((x) => String(x.name).indexOf(HOSTNAME) >= 0)[0];
  if (!h) throw new Error('宿主 ' + HOSTNAME + ' 不在 prefs');
  return h.url || h.baseUrl;
}
let ws = null, id = 0; const pend = new Map();
const send = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); setTimeout(() => { if (pend.delete(i)) rej(new Error('CDP 超时 ' + m)); }, 30000); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('JS:' + JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result && r.result.value; };
async function connect() {
  let pid = '';
  for (let a = 1; a <= 15; a++) { try { pid = String(adb(['shell', 'pidof', PKG])).trim().split(/\s+/)[0]; } catch {} if (/^\d+$/.test(pid)) break; await sleep(1500); }
  try { adb(['forward', '--remove-all']); } catch {}
  adb(['forward', 'tcp:' + PORT, 'localabstract:webview_devtools_remote_' + pid]);
  let page = null;
  for (let a = 1; a <= 10 && !page; a++) { try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); page = l.filter((t) => t.type === 'page').pop(); } catch {} if (!page) await sleep(1500); }
  if (!page) throw new Error('没有 page target');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  id = 0; pend.clear();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error('cdp')) : p.res(m.result); } });
}
async function waitReady(capMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < capMs) {
    let ok = false;
    try { ok = await ev("(function(){var c=document.querySelector('[class*=centerCol]');return !!(c&&c.getBoundingClientRect().width>0&&document.getElementById('bw-whale-fab'))})()"); } catch {}
    if (ok) { await sleep(1500); return Math.round(Date.now() - t0); }
    await sleep(1000);
  }
  return -1;
}
const FABR = "(function(){var f=document.getElementById('bw-whale-fab');if(!f)return null;var r=f.getBoundingClientRect();return {x:Math.round(r.left),y:Math.round(r.top),op:parseFloat(getComputedStyle(f).opacity),cx:Math.round(r.left+r.width/2),cy:Math.round(r.top+r.height/2)}})()";
const SBW = "(function(){var s=document.querySelector(\"[class*='_sidebarCol'] [class*='_root']:not([class*='_collapsed'])\");return s?Math.round(s.getBoundingClientRect().width):0})()";
const LS = "localStorage.getItem('bwFabPos')";
async function tap(x, y) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(60);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(900);
}
async function drag(x0, y0, x1, y1) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 12; i++) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(x0 + (x1 - x0) * i / 12), y: Math.round(y0 + (y1 - y0) * i / 12) }] });
    await sleep(40);
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(700);
}
(async () => {
  const url = hostUrl();
  try { adb(['shell', 'am', 'force-stop', PKG]); } catch {}
  await sleep(1000);
  adb(['shell', 'am', 'start', '-n', PKG + '/.WebActivity', '--es', 'url', url]);
  await sleep(2500);
  await connect();
  const ready = await waitReady(35000);
  if (ready < 0) { console.log('ENV: 页面未就绪'); process.exit(2); }
  console.log('就绪 ' + ready + 'ms');
  // 清掉上一轮测试留下的位置，重载一次回到出厂默认（左缘垂直居中）
  await send('Page.enable');
  await ev("localStorage.removeItem('bwFabPos');'ok'");
  await send('Page.navigate', { url });
  await sleep(2500);
  if (await waitReady(35000) < 0) { console.log('ENV: 重载未就绪'); process.exit(2); }
  const geo = await ev("(function(){return {vw:window.innerWidth,vh:window.innerHeight}})()");
  const { vw, vh } = geo;
  let r = await ev(FABR);
  // v1.33.42（用户 m08310）：吸附露出比例 1/3 → 1/2，左吸附 left=-22、右吸附 left=vw-22，
  //   可见带半宽 22px。钮中心 cx=0（左）/ vw（右）仍恰好落在屏边，所以照旧点「露出带内」。
  ck('默认左吸附 left=-22 露1/2 且半透', r && Math.abs(r.x + 22) <= 2 && Math.abs(r.cy - vh / 2) <= 4 && r.op > 0.4 && r.op < 0.6, r);
  // 点露出的半圆 → 展开。取露出带内 x=8（真用户的点法）。
  await tap(Math.max(8, r.x + 8), r.cy);
  let sbw = await ev(SBW); let r2 = await ev(FABR);
  ck('点钮展开 sb=280 且钮全显 left=6 全透', sbw === 280 && r2 && Math.abs(r2.x - 6) <= 2 && r2.op > 0.95, { sbw, r2 });
  // 再点 → 收起（钮此刻全显在 6..50，点它自己的中心）
  await tap(r2.cx, r2.cy);
  sbw = await ev(SBW); r2 = await ev(FABR);
  ck('再点收起 sb=0 钮回 -22', sbw === 0 && r2 && Math.abs(r2.x + 22) <= 2, { sbw, r2 });
  // 拖到右侧中部
  await drag(6, vh / 2, 300, 200);
  r = await ev(FABR); const ls = await ev(LS);
  ck('拖后右吸附 left=vw-22 top≈178 半透', r && Math.abs(r.x - (vw - 22)) <= 3 && Math.abs(r.y - 178) <= 8 && r.op > 0.4 && r.op < 0.6, r);
  ck('localStorage 记 right', ls && /right/.test(ls), ls);
  // 点右缘露出的半圆 → 展开（钮应全显 vw-50）
  await tap(vw - 8, 200);
  sbw = await ev(SBW); r2 = await ev(FABR);
  ck('右缘点钮展开 sb=280 钮 vw-50', sbw === 280 && r2 && Math.abs(r2.x - (vw - 50)) <= 2, { sbw, r2 });
  await tap(r2.cx, r2.cy);
  sbw = await ev(SBW); r2 = await ev(FABR);
  ck('再点收起 钮回 vw-22', sbw === 0 && r2 && Math.abs(r2.x - (vw - 22)) <= 2, { sbw, r2 });
  // 刷新持久化
  await send('Page.enable');
  await send('Page.navigate', { url });
  await sleep(2500);
  const ready2 = await waitReady(35000);
  r = await ev(FABR);
  ck('刷新后位置仍在 right 吸附', ready2 >= 0 && r && Math.abs(r.x - (vw - 22)) <= 3 && Math.abs(r.y - 178) <= 8, r);
  console.log(fails === 0 ? 'VERDICT: PASS' : 'VERDICT: FAIL ' + fails);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.log('ENV/ERR: ' + (e && e.message)); process.exit(2); });
