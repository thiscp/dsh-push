// P02 driver: production settings page, READ-ONLY assertions on the
// "phone answer mode" row. No clicks on the toggle button.
// Run: ELECTRON_RUN_AS_NODE=1 "D:\programs\dsh\DeepSeek Harness.exe" p02-driver.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9224;
const PROFILE = "F:\\work\\work_dsh\\tmp\\p0x\\edge-profile";
const SHOTS = "F:\\work\\work_dsh\\tmp\\shots\\p0x";
const OUTDIR = "F:\\work\\work_dsh\\tmp\\p0x";

// token: last match in the production web.log (lead's token must equal this)
const log = fs.readFileSync(path.join(os.homedir(), ".dsh", "web.log"), "utf8");
const matches = [...log.matchAll(/dsh web: http:\/\/[0-9.]+:[0-9]+\/\?token=(\S+)/g)];
const token = matches[matches.length - 1][1];
console.log("token-from-log:", token.slice(0, 8) + "...");

const url = `http://127.0.0.1:3080/?token=${token}`;
function edge_bat() {
  const bat = path.join(OUTDIR, "p02-edge.cmd");
  fs.writeFileSync(bat, `"${EDGE}" --headless=new --remote-debugging-port=${PORT} --user-data-dir="${PROFILE}" --window-size=1440,900 --no-first-run --no-default-browser-check "${url}"\r\n`);
  return bat;
}
spawnSync("cmd.exe", ["/c", "start", "", edge_bat()], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(1000);
  }
  throw new Error("no page target");
}

let idc = 0;
let ws;
function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++idc;
    const onmsg = (ev) => {
      const m = JSON.parse(ev.data.toString());
      if (m.id === id) {
        ws.removeEventListener("message", onmsg);
        if (m.error) reject(new Error(JSON.stringify(m.error)));
        else resolve(m.result);
      }
    };
    ws.addEventListener("message", onmsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("page ex: " + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
}
async function clickAt(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, "base64"));
  console.log("shot:", name);
}

(async () => {
  const wsUrl = await getWs();
  ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  await sleep(4000);

  // 1. open settings modal via the sidebar trigger button
  const btn = JSON.parse(await evalJs(`(function(){
    for (const b of document.querySelectorAll("button")) {
      const t = (b.textContent || "").trim();
      if (t === "\\u8bbe\\u7f6e") { const r = b.getBoundingClientRect(); return JSON.stringify({x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)}); }
    }
    return "null";
  })()`));
  if (!btn) throw new Error("settings trigger button not found");
  await clickAt(btn.x, btn.y);
  await sleep(2500);

  // 2. locate the phone-answer-mode row: find its action button, walk up to the row container
  const row = await evalJs(`(function(){
    const want = "\\u624b\\u673a\\u4f5c\\u7b54\\u6a21\\u5f0f";
    let btn = null;
    for (const b of document.querySelectorAll("button")) {
      const t = (b.textContent || "").trim();
      if (t.includes("\\u5df2\\u5f00\\u542f") || t.includes("\\u542f\\u7528")) {
        let p = b.parentElement;
        for (let i = 0; i < 8 && p; i++, p = p.parentElement) {
          if ((p.textContent || "").includes(want)) { btn = b; break; }
        }
        if (btn) break;
      }
    }
    if (!btn) {
      // fall back: any container with the label AND a status word
      for (const el of document.querySelectorAll("div")) {
        const t = (el.textContent || "").trim();
        if (t.includes(want) && (t.includes("timed") || t.includes("legacy")) && t.length < 900) {
          el.scrollIntoView({block: "center"});
          const bs = [...el.querySelectorAll("button")].map(b => ({text: (b.textContent||"").trim(), disabled: b.disabled}));
          return JSON.stringify({found: true, text: t, buttons: bs, via: "container"});
        }
      }
      return JSON.stringify({found: false});
    }
    let row = btn.parentElement;
    for (let i = 0; i < 8 && row; i++, row = row.parentElement) {
      const t = (row.textContent || "").trim();
      if (t.includes(want) && t.includes("\\u5df2\\u5f00\\u542f\\uff1a") || (t.includes(want) && t.includes("\\u672a\\u5f00\\u542f\\uff1a"))) {
        if (t.length < 900) {
          row.scrollIntoView({block: "center"});
          const bs = [...row.querySelectorAll("button")].map(b => ({text: (b.textContent||"").trim(), disabled: b.disabled}));
          return JSON.stringify({found: true, text: t, buttons: bs, via: "button"});
        }
      }
    }
    const r0 = btn.closest("div");
    r0.scrollIntoView({block: "center"});
    return JSON.stringify({found: true, text: (r0.textContent||"").trim(), buttons: [{text: (btn.textContent||"").trim(), disabled: btn.disabled}], via: "button-shallow"});
  })()`);
  console.log("row:", row);
  if (JSON.parse(row).found === false) {
    const dbg = await evalJs(`(function(){
      const bs = [...document.querySelectorAll("button")].map(b => (b.textContent||"").trim()).filter(t => t && t.length < 30);
      return JSON.stringify({url: location.href, buttons: [...new Set(bs)].slice(0, 40)});
    })()`);
    console.log("debug:", dbg);
    await shot("p02-debug-nomodal.png");
  }
  fs.writeFileSync(path.join(SHOTS, "p02-row-dom.txt"), row, "utf8");
  await sleep(600);
  await shot("p02-settings.png");

  // 3. full settings modal text dump for evidence (symbol-validity check)
  const modal = await evalJs(`(function(){
    for (const el of document.querySelectorAll("div")) {
      const t = (el.textContent || "").trim();
      if (t.startsWith("\\u8bbe\\u7f6e") && t.length > 200 && t.length < 8000) return t;
    }
    return "";
  })()`);
  fs.writeFileSync(path.join(SHOTS, "p02-modal-text.txt"), modal, "utf8");
  console.log("modal-text-bytes:", Buffer.byteLength(modal));

  console.log("DONE-P02");
  process.exit(0);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
