// smoke: prove the new verify modules (cdp.mjs / state.mjs / ui.mjs) work end-to-end.
// Run: node verify/smoke-kit.mjs
import { connect, shot } from './cdp.mjs';
import { snapshot, waitReady } from './state.mjs';
import { dump, focus, waitText } from './ui.mjs';

const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';

const f = focus();
console.log('focus      ' + (f || '(none)') + '   @' + el());

let c;
try {
  c = await connect();
  console.log('connect    pid=' + c.pid + ' port=' + c.port + '   @' + el());
  const s = await waitReady(c, 15000);
  console.log('waitReady  nodes=' + s.nodes + ' ' + s.innerW + 'x' + s.innerH + '   @' + el());
  const s2 = await snapshot(c);
  console.log('snapshot   ' + JSON.stringify(s2).slice(0, 400));
  console.log('sess       ' + (s2.sess || '(none)') + '  count=' + s2.sessCount + '  rows=' + s2.rows);
  c.close();
} catch (e) {
  console.log('CDP STAGE FAILED: ' + e.message);
}

try {
  const t1 = Date.now();
  const n = dump();
  console.log('dump       ' + n.length + ' nodes in ' + (Date.now() - t1) + 'ms   @' + el());
  const texts = n.map((x) => x.text).filter(Boolean).slice(0, 12);
  console.log('texts      ' + JSON.stringify(texts));
  const descs = n.map((x) => x.desc).filter(Boolean).slice(0, 10);
  console.log('descs      ' + JSON.stringify(descs));
} catch (e) {
  console.log('DUMP STAGE FAILED: ' + e.message);
}

// waitText should resolve instantly for something on screen and fail fast (with the visible
// texts) for something that is not - that failure line is the whole point of the helper.
try {
  const t2 = Date.now();
  const hit = await waitText('关闭', 4000);
  console.log('waitText   hit ' + JSON.stringify(hit.text) + ' at ' + hit.cx + ',' + hit.cy + ' in ' + (Date.now() - t2) + 'ms');
  const t3 = Date.now();
  try {
    await waitText('this-text-does-not-exist-xyz', 1500);
    console.log('waitText   UNEXPECTED: matched a bogus string');
  } catch (e) {
    console.log('waitText   negative case ok in ' + (Date.now() - t3) + 'ms: ' + e.message.slice(0, 120));
  }
} catch (e) {
  console.log('WAITTEXT STAGE FAILED: ' + e.message);
}

// shot() must write a real PNG (magic 89 50 4e 47) and reject 0-byte results.
try {
  const p = (process.env.TEMP || '/tmp') + '/smoke-shot.png';
  const n = shot(p);
  console.log('shot       ' + n + ' bytes -> ' + p);
} catch (e) {
  console.log('SHOT STAGE FAILED: ' + e.message);
}
