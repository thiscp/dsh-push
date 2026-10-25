// state.mjs - one-shot machine-readable snapshot of the dsh-push WebView, plus waitFor().
//
// Why this exists: the 2026-10-25 session wrote six different scripts (who.mjs, cur-session.mjs,
// sess-state.mjs, sess-info.mjs, ls-probe.mjs, sess-switch.mjs) that all answered the same
// question "which conversation is on screen right now", and one of them silently swallowed the
// CDP error and reported the wrong answer. This is that question, asked once.
//
// Usage:
//   import { connect } from './cdp.mjs';
//   import { snapshot, waitFor } from './state.mjs';
//   const c = await connect();
//   console.log(JSON.stringify(await snapshot(c)));
//   await waitFor(c, s => s.sess === 'session-xxx', 8000);
import { sleep } from './cdp.mjs';

// DOM facts (all verified 2026-10-25 against the shipped WebView):
//  * the conversation id lives ONLY on [data-conversation-session], exactly 1 node, value
//    "session-<uuid>"; the URL hash is wiped by host-plugin's revealFromHash (replaceState).
//  * [data-row-key] sidebar rows do not exist while the sidebar is collapsed (display:none).
//  * the injected whale FAB is #bw-whale-fab; when snapped to the edge its rect.x is negative.
const SNAP_JS = `(function(){
  var out={};
  out.url=location.href;out.hash=location.hash;out.hidden=document.hidden;
  out.title=document.title;
  var e=document.querySelector('[data-conversation-session]');
  out.sess=e?String(e.getAttribute('data-conversation-session')||''):'';
  out.sessCount=document.querySelectorAll('[data-conversation-session]').length;
  var f=document.getElementById('bw-whale-fab');
  if(f){var r=f.getBoundingClientRect();out.fab={x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),vis:getComputedStyle(f).display!=='none'};}
  else out.fab=null;
  var sb=document.querySelector('[class*="sidebarCol"]')||document.querySelector('[class*="sidebar"]');
  if(sb){var q=sb.getBoundingClientRect();out.side={w:Math.round(q.width),x:Math.round(q.x),disp:getComputedStyle(sb).display};}
  else out.side=null;
  out.rows=document.querySelectorAll('[data-row-key]').length;
  out.sessRows=document.querySelectorAll('[data-row-key^="session:"]').length;
  out.innerH=window.innerHeight;out.innerW=window.innerWidth;
  out.nodes=document.querySelectorAll('*').length;
  out.ver=(document.body&&document.body.getAttribute('data-app-ver'))||'';
  return out;})()`;

export async function snapshot(c) {
  const r = await c.ev(SNAP_JS);
  if (r && r.__err) throw new Error('snapshot failed in page: ' + r.__err);
  return r;
}

// Poll snapshot() until pred(snap) is true. Returns the snapshot; throws on timeout with the
// last snapshot attached (so a failure message shows what WAS on screen, not just "timed out").
export async function waitFor(c, pred, timeoutMs = 10000, everyMs = 400) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    try { last = await snapshot(c); } catch (e) { last = { __err: String(e && e.message) }; }
    let ok = false;
    try { ok = !!pred(last); } catch { ok = false; }
    if (ok) return last;
    await sleep(everyMs);
  }
  const err = new Error('waitFor timed out after ' + timeoutMs + 'ms; last snapshot = ' + JSON.stringify(last));
  err.last = last;
  throw err;
}

// Wait until the WebView has actually loaded a page (title set and at least one body node),
// then until the conversation hook appears. The page paints in stages: session hook can show up
// ~1s after the first paint, so callers that need the id should use waitForSess().
export async function waitReady(c, timeoutMs = 20000) {
  return waitFor(c, (s) => s && !s.__err && s.innerW > 100 && s.nodes > 20, timeoutMs, 300);
}
export async function waitSess(c, timeoutMs = 20000) {
  return waitFor(c, (s) => s && !s.__err && /^session-/.test(s.sess || ''), timeoutMs, 400);
}
