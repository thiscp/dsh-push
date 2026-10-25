// ui.mjs - drive the native Android UI by MEANING, not by pixel coordinates.
//
// Why this exists: the 2026-10-25 session did 19 hand-computed `input tap` calls, 5 uiautomator
// dumps to recompute them and 9 screenshots to eyeball the result. Every layout change invalidated
// all of it (and one tap at 1310,108 landed on a GMS "add account" error page instead of the
// close button). uiautomator already reports bounds in PHYSICAL pixels - which is exactly what
// `input tap` consumes - so matching a node by text/label removes both the arithmetic and the
// CSS x dpr confusion in one step.
//
// Usage:
//   import { dump, tapText, tapDesc, waitText } from './ui.mjs';
//   await tapText(/DSH/, 8000);      // taps the first node whose text matches
//   await tapText('笔电');            // exact-ish: contains
//   await tapDesc(/close/i);
//
// Matching notes:
//  * Read the XML as utf8 in Node - the GBK garbage people see comes from PowerShell reading it.
//  * Text matching is `String.includes`, so pass a plain substring; regexes are also accepted.
//  * Some nodes have no text but a content-desc (icon buttons); use tapDesc for those.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ADB, SERIAL, adb, adbTry, sleep } from './cdp.mjs';

function localTmp(name) { return path.join(os.tmpdir(), name); }

// Pull the current UI hierarchy as parsed nodes with physical-pixel bounds.
export function dump() {
  const remote = '/sdcard/ui-dump.xml';
  const r = adbTry(['shell', 'uiautomator', 'dump', remote]);
  if (!r.ok || !/dumped to/i.test(r.out + r.err)) {
    throw new Error('uiautomator dump failed: ' + (r.err || r.out || '(no output)'));
  }
  const local = localTmp('ui-dump.xml');
  fs.rmSync(local, { force: true });
  // stderr is swallowed: adb pull prints "1 file pulled ..." progress there and PowerShell
  // turns any stderr line from a native command into a noisy NativeCommandError.
  try {
    execFileSync(ADB, ['-s', SERIAL, 'pull', remote, local], { stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    throw new Error('adb pull of the ui dump failed: ' + String((e && e.stderr) || (e && e.message) || e));
  }
  const xml = fs.readFileSync(local, 'utf8');
  const nodes = [];
  const re = /<node\b([^>]*)\/?>/g;
  let m;
  while ((m = re.exec(xml))) {
    const a = m[1];
    const attr = (n) => {
      const q = new RegExp(n + '="([^"]*)"').exec(a);
      return q ? q[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : '';
    };
    const b = /bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/.exec(a);
    if (!b) continue;
    const [x1, y1, x2, y2] = [Number(b[1]), Number(b[2]), Number(b[3]), Number(b[4])];
    if (x2 <= x1 || y2 <= y1) continue;
    nodes.push({
      text: attr('text'), desc: attr('content-desc'), cls: attr('class'),
      id: attr('resource-id'), clickable: attr('clickable') === 'true',
      x1, y1, x2, y2, cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2),
    });
  }
  return nodes;
}

function matcher(pat) {
  if (pat instanceof RegExp) return (s) => pat.test(s || '');
  return (s) => String(s || '').includes(String(pat));
}

export function findText(pat, nodes) {
  const t = matcher(pat);
  const list = nodes || dump();
  return list.filter((n) => t(n.text))[0] || null;
}
export function findDesc(pat, nodes) {
  const t = matcher(pat);
  const list = nodes || dump();
  return list.filter((n) => t(n.desc))[0] || null;
}
export function findAllText(pat, nodes) {
  const t = matcher(pat);
  return (nodes || dump()).filter((n) => t(n.text));
}

// Tap the center of a node in physical pixels (input tap consumes physical pixels).
export function tapNode(n) {
  if (!n) throw new Error('tapNode: nothing to tap');
  adb(['shell', 'input', 'tap', String(n.cx), String(n.cy)]);
  return n;
}
export function tapRaw(x, y) { adb(['shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))]); }

// Wait until a matching node shows up, then tap it. Throws with the visible texts on timeout -
// that single line is usually enough to tell "wrong screen" from "wrong matcher".
export async function waitText(pat, timeoutMs = 8000, everyMs = 400) {
  const t0 = Date.now();
  let last = [];
  while (Date.now() - t0 < timeoutMs) {
    try { last = dump(); } catch (e) { last = []; }
    const hit = findText(pat, last);
    if (hit) return hit;
    await sleep(everyMs);
  }
  const seen = last.map((n) => n.text).filter(Boolean).slice(0, 25).join(' | ');
  throw new Error('waitText(' + String(pat) + ') timed out after ' + timeoutMs + 'ms; visible texts: ' + (seen || '(none)'));
}
export async function tapText(pat, timeoutMs = 8000) {
  return tapNode(await waitText(pat, timeoutMs));
}
export async function tapDesc(pat, timeoutMs = 8000) {
  const t0 = Date.now();
  let last = [];
  while (Date.now() - t0 < timeoutMs) {
    try { last = dump(); } catch (e) { last = []; }
    const hit = findDesc(pat, last);
    if (hit) return tapNode(hit);
    await sleep(400);
  }
  const seen = last.map((n) => n.desc).filter(Boolean).slice(0, 25).join(' | ');
  throw new Error('tapDesc(' + String(pat) + ') timed out; visible descs: ' + (seen || '(none)'));
}

// ---- app-specific anchors (verified coordinates are NOT used: everything is looked up) ----
// MainActivity: the "DSH 入口" chip. Matched on the ASCII part so it survives encoding issues.
export async function openDshEntry(timeoutMs = 10000) {
  const nodes = await (async () => { const t0 = Date.now(); while (Date.now() - t0 < timeoutMs) { try { const n = dump(); if (n.length) return n; } catch { } await sleep(400); } return []; })();
  const hit = nodes.filter((n) => /DSH/.test(n.text) && n.clickable)[0]
    || nodes.filter((n) => /DSH/.test(n.text))[0];
  if (!hit) throw new Error('openDshEntry: no node with text ~ /DSH/ on the main screen; visible: ' + nodes.map((n) => n.text).filter(Boolean).slice(0, 20).join(' | '));
  return tapNode(hit);
}

// Instance picker (AlertDialog setItems): tap the row whose label contains the host name.
export async function pickInstance(namePart, timeoutMs = 8000) {
  return tapText(namePart, timeoutMs);
}

// WebActivity: the title-bar close button is an icon button (content-desc or 关闭).
export async function closeWeb(timeoutMs = 8000) {
  try { return await tapDesc(/close|关闭/i, timeoutMs); } catch (e) { return tapText(/关闭/, timeoutMs); }
}

// Current focused component as "pkg/Activity", e.g. xyz.cpyh.dshpush/.MainActivity
// (dumpsys prints component names without the package prefix for same-package activities).
export function focus() {
  const r = adbTry(['shell', 'dumpsys', 'window', 'displays']);
  const t = (r.out || '') + (r.err || '');
  for (const line of t.split(/\r?\n/)) {
    if (!/mCurrentFocus|mFocusedApp/.test(line)) continue;
    const m = /([A-Za-z0-9_.]+)\/([A-Za-z0-9_.$]+)/.exec(line);
    if (m) return m[1] + '/' + m[2];
  }
  return '';
}
export async function waitFocus(re, timeoutMs = 10000) {
  const t0 = Date.now();
  let f = '';
  while (Date.now() - t0 < timeoutMs) {
    f = focus();
    if (re.test(f)) return f;
    await sleep(400);
  }
  throw new Error('waitFocus(' + String(re) + ') timed out; last focus = ' + (f || '(none)'));
}

export { sleep, adb, adbTry, ADB, SERIAL };
export const _internal = { execFileSync };
