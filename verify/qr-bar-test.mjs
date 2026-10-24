// 原生顶栏 Quick Return 验收（v1.33.32，用户 m03322/m03479）。
// 信号：顶栏是原生 View，收起/展开会改变 WebView 视口 —— CDP 里 window.innerHeight
// 随之增减，这就是无歧义的收起/展开读数（uiautomator 里「关闭」钮 bounds 作旁证）。
// 断言链：冷启动栏在(H0) → 主滚动区下滑过阈值 innerHeight 变大(栏收起) →
//   上滑 innerHeight 复原(栏回来) → 顶部 120px 内下滑不收 → 小滚动区(代码块)滑动不收 →
//   收起态点 FAB 展开侧栏仍正常（与 QR 无串扰）。
// 退出码 0=PASS 1=FAIL 2=ENV。用法：node verify/qr-bar-test.mjs
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
  const f = (process.env.TEMP || '/tmp') + '/qr-prefs.xml';
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
// 主聊天滚动容器（与注入段同判据：clientHeight≥400 的最大滚动区）
const SCROLLER = "(function(){var best=null,all=document.querySelectorAll('*');for(var i=0;i<all.length;i++){var e=all[i];if(e.scrollHeight>e.clientHeight+50&&e.clientHeight>=400){if(!best||e.clientHeight>best.clientHeight)best=e;}}return best?1:0})()";
const IH = "window.innerHeight";
// 在页内对主滚动器做一串真滚动（scrollTop 步进 + 派发 scroll 捕获事件）
function scrollStep(dy, from) {
  return "(function(){var all=document.querySelectorAll('*'),best=null;for(var i=0;i<all.length;i++){var e=all[i];if(e.scrollHeight>e.clientHeight+50&&e.clientHeight>=400){if(!best||e.clientHeight>best.clientHeight)best=e;}}if(!best)return -1;" +
    "var y0=" + from + ";best.scrollTop=y0;best.dispatchEvent(new Event('scroll',{bubbles:true}));" +
    "var y1=y0+" + dy + ";best.scrollTop=y1;best.dispatchEvent(new Event('scroll',{bubbles:true}));return Math.round(best.scrollTop)})()";
}
// uiautomator 旁证：「关闭」钮 bounds 高度（收起态应为 0 或节点消失）
function closeBtnH() {
  try {
    adb(['shell', 'uiautomator', 'dump', '/sdcard/q.xml']);
    const t = adb(['shell', 'cat', '/sdcard/q.xml']);
    const m = t.match(/text="关闭"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    return m ? Number(m[4]) - Number(m[2]) : -1;
  } catch { return -2; }
}
(async () => {
  const url = hostUrl();
  try { adb(['shell', 'am', 'force-stop', PKG]); } catch {}
  await sleep(1000);
  adb(['shell', 'am', 'start', '-n', PKG + '/.WebActivity', '--es', 'url', url]);
  await connect();
  const ready = await waitReady(90000);
  if (ready < 0) { console.log('ENV: 页面未就绪'); process.exit(2); }
  console.log('ready ' + ready + 'ms');
  await sleep(2500); // QR 加载宽限窗（2.5s）过完再测，否则第一次滚动被吞

  const h0 = await ev(IH);
  const hasSc = await ev(SCROLLER);
  ck('主滚动容器存在', hasSc === 1, { hasSc });
  ck('冷启动顶栏在（innerHeight 基线）', h0 > 400, { h0 });

  // 1) 下滑过阈值 → 栏收起：innerHeight 应变大
  await ev(scrollStep(200, 0)); await sleep(600);
  const h1 = await ev(IH);
  const dh = h1 - h0;
  ck('下滑收起顶栏（innerHeight 增大）', dh >= 16 && dh <= 120, { h0, h1, dh });
  const cbh = closeBtnH();
  ck('旁证：收起态「关闭」钮高度归零', cbh === 0 || cbh === -1, { cbh });

  // 2) 上滑 → 栏回来
  await ev(scrollStep(-100, 200)); await sleep(600);
  const h2 = await ev(IH);
  ck('上滑顶栏复原（innerHeight 回基线）', Math.abs(h2 - h0) <= 2, { h0, h2 });

  // 3) 顶部 120px 内下滑不收（y 从 0 滑到 60，未过 y>120 门）
  await ev(scrollStep(60, 0)); await sleep(600);
  const h3 = await ev(IH);
  ck('顶部 120px 内下滑不收', Math.abs(h3 - h0) <= 2, { h0, h3 });

  // 4) 收起态点 FAB 展开侧栏（QR 与 FAB 无串扰）
  await ev(scrollStep(200, 0)); await sleep(600);
  const hc = await ev(IH);
  const fab = await ev("(function(){var f=document.getElementById('bw-whale-fab');var r=f.getBoundingClientRect();return {cx:Math.round(r.left+r.width/2),cy:Math.round(r.top+r.height/2),vw:window.innerWidth}})()");
  // 吸附态钮中心可能半隐在屏外（右吸附 cx=vw+7），点露出的那一条：cx 夹进屏内
  const tx = Math.max(6, Math.min(fab.cx, fab.vw - 6));
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx, y: fab.cy }] });
  await sleep(60);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(900);
  const sbw = await ev("(function(){var s=document.querySelector(\"[class*='_sidebarCol'] [class*='_root']:not([class*='_collapsed'])\");return s?Math.round(s.getBoundingClientRect().width):0})()");
  ck('收起态点 FAB 展开侧栏', sbw >= 200, { hc, sbw });

  console.log(fails ? 'VERDICT: FAIL ' + fails : 'VERDICT: PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('ENV/ERR: ' + (e && e.message)); process.exit(2); });
