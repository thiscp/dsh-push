// 新建对话无内容 → 不可滚 → 顶栏收起后回不来的回归（用户 m03906）。
// 场景：长对话下滑收起顶栏 → 侧栏点「新建对话」→ 看门狗应在 ~1.5s 内把顶栏复位。
// 信号：window.innerHeight（显示 H0 / 收起 H0+25）。退出码 0=PASS 1=FAIL 2=ENV。
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
const H0 = await ev('window.innerHeight');
const IH = () => ev('window.innerHeight');
const touch = (type, x, y) => send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 8, radiusY: 8, force: 1 }] });
async function tap(x, y) { await touch('touchStart', x, y); await sleep(80); await touch('touchEnd', x, y); await sleep(200); }
async function drag(x, y1, y2, steps = 8) {
  await touch('touchStart', x, y1);
  for (let i = 1; i <= steps; i++) { await touch('touchMove', x, Math.round(y1 + ((y2 - y1) * i) / steps)); await sleep(16); }
  await sleep(60); await touch('touchEnd', x, y2); await sleep(120);
}
let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) fails++; };

// 1) 长对话里下滑收起顶栏（冷启动落在底部：先下滑离开底部，再上滑 scroll down 才收起）
const sc = await ev('(function(){var all=document.querySelectorAll("*"),best=null;for(var i=0;i<all.length;i++){var e=all[i];if(e.clientHeight>=400&&e.scrollHeight>e.clientHeight+200&&(!best||e.scrollHeight>best.scrollHeight))best=e;}window.__qrT=best;return best?{sh:best.scrollHeight,ch:best.clientHeight}:null})()');
ok('长对话可滚', !!sc, JSON.stringify(sc));
await sleep(3200);
await drag(180, 150, 500); // 离开底部（scroll up，show 无操作）
await sleep(500);
await drag(180, 500, 150); await sleep(400); await drag(180, 500, 150); // scroll down → 收起
await sleep(800);
ok('下滑收起顶栏', (await IH()) >= H0 + 12, 'H0=' + H0 + ' IH=' + await IH());

// 2) 点 FAB 开侧栏，找「新建对话」钮（真 touch 点它）
const fab = await ev("(function(){var r=document.getElementById('bw-whale-fab').getBoundingClientRect();return {x:Math.round(r.left+4),y:Math.round(r.top+r.height/2)}})()");
await tap(fab.x, fab.y);
await sleep(900);
const nb = await ev(`(function(){var b=document.querySelectorAll('button,[role=button],a');for(var i=0;i<b.length;i++){var s=(b[i].getAttribute('aria-label')||'')+'|'+(b[i].title||'')+'|'+(b[i].textContent||'');if(/新建|新会话|新对话|New (chat|conversation|session)/i.test(s)){var r=b[i].getBoundingClientRect();if(r.width>0&&r.left<300)return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),label:s.slice(0,40)};}}return null})()`);
ok('侧栏里找到新建对话钮', !!nb, JSON.stringify(nb));
if (nb) { await tap(nb.x, nb.y); }
await sleep(2500); // 看门狗 800ms 一轮，给两轮余量

// 3) 新对话不可滚 → 顶栏必须已被复位。
//    注意：新建对话会聚焦输入框弹键盘，viewport 缩到 ~435 会混淆读数——
//    先用 uiautomator 查原生「关闭」钮（不受键盘影响），再 BACK 收键盘验 innerHeight 回基线。
const cbh = () => {
  try {
    adb(['shell', 'uiautomator', 'dump', '/sdcard/n.xml']);
    const t = adb(['shell', 'cat', '/sdcard/n.xml']);
    const m = t.match(/text="关闭"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    return m ? Number(m[4]) - Number(m[2]) : -1;
  } catch { return -2; }
};
const cbh1 = cbh();
ok('新建对话后原生顶栏已复位（关闭钮在）', cbh1 > 0, '关闭钮高=' + cbh1);
try { adb(['shell', 'input', 'keyevent', '4']); } catch {} // BACK 收键盘
await sleep(1200);
const IHn = await IH();
ok('收键盘后 innerHeight 回基线', IHn <= H0 + 6, 'IH=' + IHn + ' H0=' + H0);
const scrollable = await ev('(function(){var all=document.querySelectorAll("*"),best=null;for(var i=0;i<all.length;i++){var e=all[i];if(e.clientHeight>=400&&e.scrollHeight>e.clientHeight+50&&(!best||e.clientHeight>best.clientHeight))best=e;}return best?1:0})()');
ok('新对话确实不可滚（场景成立）', scrollable === 0, 'scrollable=' + scrollable);

// 4) 复位后再进长对话下滑，仍能正常收起（看门狗不干扰正常 QR）
const fab2 = await ev("(function(){var r=document.getElementById('bw-whale-fab').getBoundingClientRect();return {x:Math.round(r.left+4),y:Math.round(r.top+r.height/2)}})()");
await tap(fab2.x, fab2.y); await sleep(800);
const sess = await ev(`(function(){var a=document.querySelectorAll('[class*=sidebarCol] a,[class*=sidebarCol] [role=button],button');for(var i=0;i<a.length;i++){var r=a[i].getBoundingClientRect();if(r.width>0&&r.left<300&&r.top>140&&/2026|对话|session|chat/i.test(a[i].textContent||'')){return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}}}return null})()`);
if (sess) { await tap(sess.x, sess.y); await sleep(2500); }
await drag(180, 500, 150); await sleep(400); await drag(180, 500, 150); await sleep(800);
ok('回到长对话下滑仍能收起', (await IH()) >= H0 + 12 || !sess, 'IH=' + await IH());

console.log(fails ? 'NEWCHAT FAIL ' + fails : 'NEWCHAT PASS');
process.exit(fails ? 1 : 0);
