# verify-card-layout.ps1 - reproduce the WebView question-card layout on the emulator.
#
# What it does (all on the emulator host, no interaction needed):
#   1. push the APK (default: the staged one) and install it
#   2. launch WebActivity at the DSH Web URL
#   3. attach to the WebView via adb + CDP and:
#        - open a session from the sidebar search (the sidebar expansion itself is part
#          of the reproduction: the centre column shrinks and old builds collapse the card)
#        - measure the question card (heading/title/option widths and heights)
#        - write the DOM report to card-layout-report.json
#        - screenshot the WebView to -Shot
#
# Hard facts baked in (see verify/README.md):
#   - the emulator host is reachable over tailscale (the LAN IP gets firewalled);
#     set $EmuHost to the LAN IP if you are on the same subnet
#   - the app WebView is not exported, so use `am start -n <pkg>/.WebActivity --es url <url>`
#   - WebView devtools socket only appears after the app has loaded a page; the adb
#     forward must be (re)applied afterwards
#   - adb forward rules live on the emulator host, so CDP must run there too
#
# Usage:
#   powershell -File verify\card-layout-verify.ps1 -DshWebUrl "http://<tailnet-windows>:3080/?token=..."
# Options:
#   -Apk <path on the emulator host>   default G:\Android\dsh-push.apk
#   -Shot <local png path>             default .\card-layout.png
#   -Report <local json path>          default .\card-layout-report.json
#   -SessionQuery <text>               default "GitHub openspec" (a session that holds a card)
#   -SkipInstall                       reuse the installed APK
#   -KeepSidebar                       do not collapse the sidebar before the shot
param(
    [string]$DshWebUrl = "",
    [string]$Apk       = "G:\Android\dsh-push.apk",
    [string]$Shot      = ".\card-layout.png",
    [string]$Report    = ".\card-layout-report.json",
    [string]$SessionQuery = "GitHub openspec",
    [string]$EmuHost   = "user@<tailnet-laptop>",
    [string]$EmuRoot   = "G:\Android",
    [string]$Node      = "D:\Program\nodejs\node.exe",
    [switch]$SkipInstall,
    [switch]$KeepSidebar
)

$ErrorActionPreference = "Stop"

$ssh = @("-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=15")
$stage = Join-Path $env:TEMP "dsh-card-layout"
New-Item -ItemType Directory -Force $stage | Out-Null

if (-not $DshWebUrl) {
    # token rotates on every DSH restart: take the last one the server printed
    $m = Select-String -Path "$env:USERPROFILE\.dsh\web.log" -Pattern 'dsh web: http://[0-9.]+:[0-9]+/\?token=([^\s]+)' |
         Select-Object -Last 1
    if (-not $m) { throw "no 'dsh web: ...?token=' line in $env:USERPROFILE\.dsh\web.log - pass -DshWebUrl" }
    $tok = $m.Matches[0].Groups[1].Value
    $DshWebUrl = "http://<tailnet-windows>:3080/?token=$tok"
    Write-Host "token from web.log -> $DshWebUrl"
}

# ---------- 1. CDP driver (runs on the emulator host) ----------
$driver = @'
// cdp-card.mjs - attach to the app WebView on this host and measure the question card.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const ADB = "G:\\Android\\Sdk\\platform-tools\\adb.exe";
const PORT = "9222";
const URL = process.argv[2];
const SESSION_QUERY = process.argv[3];
const SHOT = process.argv[4];
const REPORT = process.argv[5];
const KEEP_SIDEBAR = process.argv[6] === "1";

function adb(args) { return execFileSync(ADB, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }); }
function findPids() {
  const unix = adb(["shell", "cat", "/proc/net/unix"]);
  return [...new Set([...unix.matchAll(/webview_devtools_remote_(\d+)/g)].map((m) => m[1]))];
}
// The wrapper script has already launched WebActivity, so the devtools socket must exist.
// Re-apply the forward here: adb root restarts the server and drops previous forwards.
const pids = findPids();
if (!pids.length) throw new Error("no webview devtools socket - did WebActivity load a page?");
try { adb(["forward", "--remove-all"]); } catch {}
adb(["forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pids[0]}`]);
console.log("FORWARDED pid=" + pids[0]);

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url); this.id = 0; this.pending = new Map();
    this.ready = new Promise((res, rej) => { this.ws.addEventListener("open", () => res()); this.ws.addEventListener("error", () => rej(new Error("ws error"))); });
    this.ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    });
  }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  close() { try { this.ws.close(); } catch {} }
}

// (WebActivity is launched by the wrapper script: adb root first, then am start -n with
// the url extra - the activity is not exported)

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) throw new Error("no CDP page target: " + JSON.stringify(list.map((t) => t.type)));
const c = new CDP(page.webSocketDebuggerUrl);
await c.ready;
await c.send("Page.enable"); await c.send("Runtime.enable");

const measure = `(async()=>{
 const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
 const g=(s)=>document.querySelector(s);
 const w=(e)=>e?+e.getBoundingClientRect().width.toFixed(1):null;
 const h=(e)=>e?+e.getBoundingClientRect().height.toFixed(1):null;
 const byLabel=(t)=>[...document.querySelectorAll("button,[role=button]")].find(b=>(b.getAttribute("aria-label")||"").includes(t));
 const SESSION_QUERY='SESSION_QUERY_PLACEHOLDER'.split('|').map((c)=>c?String.fromCharCode(parseInt(c,16)):'').join('');
 // wait for the real DSH Web shell: right after launch the WebView can still be blank, or
 // hold a network error page when the emulator just booted
 for(let i=0;i<25;i++){
   if(g("[class*='BynINW_frame']"))break;
   if(i===0||i%4===3){try{location.href=location.href;}catch(e){}}
   await sleep(2000);
 }
 await sleep(1500);
 const open=byLabel("Search");
 if(open){open.click();await sleep(900);}
 const inp=document.querySelector("input[type=search],input");
 if(inp){const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;
   set.call(inp,SESSION_QUERY);inp.dispatchEvent(new Event("input",{bubbles:true}));await sleep(2200);}
 const rows=[...document.querySelectorAll("*")].filter(e=>(e.textContent||"").trim().startsWith(SESSION_QUERY));
 rows.sort((a,b)=>a.textContent.length-b.textContent.length);
 if(rows.length)rows[0].click();
 await sleep(5000);
 const sb=g("[class*='_2H3hWW_root']");
 const title=g("[class*='mAtvLq_title']");
 const frame=g("[class*='BynINW_frame']");
 // collapse the sidebar (a manual expand is part of the reproduction) unless asked to keep it
 if("${COLLAPSE}"==="1" && sb && w(sb)>100){
   const t=byLabel("Collapse sidebar")||byLabel("sidebar");
   if(t){t.click();await sleep(2500);}
 }
 // A live card only exists while a question is pending. If it is gone (answered or expired)
 // fall back to a replica built with the SAME real CSS-module class names inside the real
 // composer seat, so the width numbers stay meaningful; cardSource says which one was used.
 let cardSource='live';
 if(!g("section[class*='mAtvLq_card']")){
   cardSource='replica';
   const seat=g("[class*='Dc7zOa_composerSeat']")||g("[class*='Dc7zOa_body']")||g("[class*='BynINW_centerCol']");
   const oldR=document.getElementById('bw-replica'); if(oldR)oldR.remove();
   const rp=document.createElement('div'); rp.id='bw-replica';
   rp.innerHTML='<div class="mAtvLq_frame"><section class="mAtvLq_card"><header class="mAtvLq_header">'+
     '<div class="mAtvLq_headingBlock"><div class="mAtvLq_eyebrow">layout-probe</div>'+
     '<h2 class="mAtvLq_title">\u8bf7\u9009\u62e9\u7ee7\u7eed\u5de5\u4f5c\u7684\u65b9\u5f0f</h2></div>'+
     '<div class="mAtvLq_headerActions"><span class="mAtvLq_waitStatus">11 \u79d2\u540e\u7ee7\u7eed\u5de5\u4f5c</span>'+
     '<button class="mAtvLq_waitButton">\u6162\u6162\u56de\u7b54</button>'+
     '<button class="mAtvLq_iconButton">x</button></div></header>'+
     '<div class="mAtvLq_body"><div class="mAtvLq_options">'+
     ['\u5148\u4fee\u6392\u7248','\u5148\u8dd1\u9a8c\u6536','\u5148\u770b\u65e5\u5fd7'].map(function(x,i){return '<button class="mAtvLq_option"><span class="mAtvLq_number">'+(i+1)+'</span><span class="mAtvLq_optionCopy"><span class="mAtvLq_optionLine"><span class="mAtvLq_optionLabel">'+x+'</span></span></span></button>';}).join('')+
     '</div></div></section></div>';
   if(seat){seat.appendChild(rp);await sleep(800);}
 }
 const report={innerWidth:window.innerWidth,devicePixelRatio:window.devicePixelRatio,
  userAgent:navigator.userAgent,
  gridColumns:frame?getComputedStyle(frame).gridTemplateColumns:null,
  sidebarWidth:w(sb),centerWidth:w(g("[class*='BynINW_centerCol']")),
  cardWidth:w(g("section[class*='mAtvLq_card']")),cardHeight:h(g("section[class*='mAtvLq_card']")),
  headingWidth:w(g("[class*='mAtvLq_headingBlock']")),headingHeight:h(g("[class*='mAtvLq_headingBlock']")),
  titleWidth:w(g("[class*='mAtvLq_title']")),titleHeight:h(g("[class*='mAtvLq_title']")),titleText:g("[class*='mAtvLq_title']")?g("[class*='mAtvLq_title']").textContent:null,
  titleLines:g("[class*='mAtvLq_title']")?Math.round(h(g("[class*='mAtvLq_title']"))/21):null,
  waitStatus:g("[class*='mAtvLq_waitStatus']")?g("[class*='mAtvLq_waitStatus']").textContent:null,
  hasWaitButton:!!g("[class*='mAtvLq_waitButton']"),
  optionWidth:w(g("[class*='mAtvLq_option']")),
  optionLabels:[...document.querySelectorAll("[class*='mAtvLq_optionLabel']")].map((e)=>e.textContent),
  cardSource:cardSource,narrowFixCount:document.querySelectorAll("#bw-narrow-fix").length,narrowFixInjected:!!document.getElementById("bw-narrow-fix")};
 return JSON.stringify(report);
})()`;

const r = await c.send("Runtime.evaluate", { expression: measure, returnByValue: true, awaitPromise: true, userGesture: true });
const value = r.result?.value ?? JSON.stringify(r);
fs.writeFileSync(REPORT, value, "utf8");
const shot = await c.send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(SHOT, Buffer.from(shot.data, "base64"));
c.close();
console.log("REPORT " + value);
console.log("VERDICT " + (() => {
  const j = JSON.parse(value);
  return (j.headingWidth > 100 && (j.titleLines ?? 9) <= 3) ? "PASS (heading keeps a usable width, title wraps normally)" : "FAIL (heading collapsed)";
})());
'@
# inject the collapse flag (the driver is a single-quoted here-string, so no interpolation there)
$collapse = if ($KeepSidebar) { "0" } else { "1" }
$driver = $driver.Replace('${COLLAPSE}', $collapse)
# the session title can contain non-ASCII text; the driver must stay pure ASCII, so pass it
# as a codepoint list and rebuild the string inside the page context
$escaped = (($SessionQuery.ToCharArray() | ForEach-Object { '{0:x}' -f [int][char]$_ }) -join '|')
$driver = $driver.Replace('SESSION_QUERY_PLACEHOLDER', $escaped)
$driverPath = Join-Path $stage "cdp-card.mjs"
[IO.File]::WriteAllText($driverPath, $driver, (New-Object Text.UTF8Encoding $false))

# ---------- 2. stage + install ----------
scp @ssh $driverPath "${EmuHost}:$($EmuRoot -replace '\\','/')/" | Out-Null
$installLine = if ($SkipInstall) { '' } else { "& `$adb install -r '$Apk' | Select-Object -Last 2" }
# The emulator must be brought up, driven AND screenshotted inside ONE ssh session: start it
# in one session and drive it from another and the device gets reaped halfway through
# ("no devices/emulators found"). Hence the single remote script below.
$emuScript = @"
`$ErrorActionPreference='Continue'
`$adb='$EmuRoot\Sdk\platform-tools\adb.exe'
function DevicePresent { ("" + (((& `$adb devices) 2>&1) -join ' ')) -match 'emulator-\d+\s+device' }
function AppPid { ((((& `$adb shell pidof xyz.cpyh.dshpush) 2>&1) -join '').Trim()) }
& `$adb start-server | Out-Null
if (-not (DevicePresent)) {
  'no device: starting the hardened self-heal (rung 1 = -gpu host)'
  `$avd = "`$env:USERPROFILE\.android\avd\dsh-p16.avd"
  Remove-Item "`$avd\hardware-qemu.ini.lock" -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item "`$avd\multiinstance.lock" -Recurse -Force -ErrorAction SilentlyContinue
  # PIN the selector to host first: the hardened ladder reads this file for rung 1.
  # BANNED: dsh-emu-sw -> run-emu-sw.cmd hardcodes -gpu swiftshader_indirect = CPU rendering
  # (user forbids it - fan noise - and it invalidates CSS360 geometry + screencap timing).
  Set-Content "G:\Android\emu-ladder.gpu" "host" -Encoding ASCII -Force
  schtasks /Run /TN emu-selfheal | Out-Null
  for (`$i=0; `$i -lt 60; `$i++) { Start-Sleep 4; if (DevicePresent) { break } }
}
& `$adb root | Out-Null
Start-Sleep 3
for (`$i=0; `$i -lt 60; `$i++) { `$b = ((& `$adb shell getprop sys.boot_completed) 2>&1) -join ''; if (`$b -match '1') { break }; Start-Sleep 3 }
$installLine
& `$adb shell dumpsys package xyz.cpyh.dshpush | Select-String -Pattern 'versionCode=|versionName=' | Select-Object -First 2
& `$adb forward --remove-all | Out-Null
& `$adb shell am force-stop xyz.cpyh.dshpush | Out-Null
Start-Sleep 2
& `$adb shell am start -n xyz.cpyh.dshpush/.WebActivity --es url '$DshWebUrl'
# the devtools socket name cannot be read from /proc/net/unix (it truncates): it is
# webview_devtools_remote_<app pid>
`$appPid = ''
for (`$i=0; `$i -lt 40; `$i++) { Start-Sleep 2; `$appPid = AppPid; if (`$appPid -match '^\d+') { break } }
'APP_PID ' + `$appPid
if (`$appPid -notmatch '^\d+') { 'NO_APP_PID'; exit 1 }
`$ready = `$false
for (`$i=0; `$i -lt 20; `$i++) {
  & `$adb forward --remove-all | Out-Null
  & `$adb forward tcp:9222 "localabstract:webview_devtools_remote_`$appPid" | Out-Null
  Start-Sleep 2
  `$v = (curl.exe -s --max-time 6 http://127.0.0.1:9222/json/version) -join ' '
  if (`$v -match 'Browser') { 'CDP_READY'; `$ready = `$true; break }
}
if (-not `$ready) { 'CDP_NOT_READY'; exit 1 }
'--- driver ---'
& '$Node' '$EmuRoot\cdp-card.mjs' '$DshWebUrl' '$SessionQuery' '$EmuRoot\card-layout.png' '$EmuRoot\card-layout-report.json' '$(if ($KeepSidebar) { 1 } else { 0 })'
"@
$emuPath = Join-Path $stage "run-card.ps1"
[IO.File]::WriteAllText($emuPath, $emuScript, (New-Object Text.UTF8Encoding $false))
scp @ssh $emuPath "${EmuHost}:$($EmuRoot -replace '\\','/')/run-card.ps1" | Out-Null
cmd /c "ssh $($ssh -join ' ') $EmuHost ""C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File $EmuRoot\run-card.ps1""" 2>&1 | ForEach-Object { Write-Host $_ }

# ---------- 3. pull the artifacts ----------
scp @ssh "${EmuHost}:$($EmuRoot -replace '\\','/')/card-layout.png" $Shot | Out-Null
scp @ssh "${EmuHost}:$($EmuRoot -replace '\\','/')/card-layout-report.json" $Report | Out-Null
Write-Host "SHOT   $Shot"
Write-Host "REPORT $Report"
