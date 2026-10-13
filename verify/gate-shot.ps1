# gate-shot.ps1 - visual gate for the v1.32.6 wallpaper fix (and panel regression guard).
# One ssh session on the emulator host: ensure WebActivity is open, click "Expand sidebar"
# via CDP, pull a DOM report, then adb screencap (NOT CDP screenshot: the wallpaper is a
# native layer that CDP cannot see). Collapsed shot first, expanded shot second.
param(
    [string]$EmuHost = "user@<tailnet-laptop>",
    [string]$EmuRoot = "G:\Android",
    [string]$Node    = "D:\Program\nodejs\node.exe",
    [string]$OutDir  = "F:\work\work_dsh\tmp\shots\real"
)
$ErrorActionPreference = "Continue"
$ssh = @("-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=15")
$stage = Join-Path $env:TEMP "dsh-gate"
New-Item -ItemType Directory -Force $stage | Out-Null
New-Item -ItemType Directory -Force $OutDir | Out-Null

# fresh token from this box's web.log
$m = Select-String -Path "$env:USERPROFILE\.dsh\web.log" -Pattern 'dsh web: http://[0-9.]+:[0-9]+/\?token=([^\s]+)' | Select-Object -Last 1
if (-not $m) { throw "no token line in web.log" }
$tok = $m.Matches[0].Groups[1].Value
$DshWebUrl = "http://<tailnet-windows>:3080/?token=$tok"
Write-Host "URL $DshWebUrl"

$driver = @'
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const ADB = "G:\\Android\\Sdk\\platform-tools\\adb.exe";
const PORT = "9223";
function adb(args) { return execFileSync(ADB, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }); }
const pid = adb(["shell", "pidof", "xyz.cpyh.dshpush"]).trim().split(/\s+/)[0];
if (!/^\d+$/.test(pid)) throw new Error("app not running: " + pid);
adb(["forward", "--remove-all"]);
adb(["forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`]);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) throw new Error("no CDP page target");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p(m); } });
await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", () => rej(new Error("ws"))); });
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, (m) => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
const probe = `(async()=>{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const g=(s)=>document.querySelector(s);
  const byLabel=(t)=>[...document.querySelectorAll("button,[role=button]")].find(b=>(b.getAttribute("aria-label")||"").includes(t));
  for(let i=0;i<20;i++){ if(g("[class*='BynINW_frame']")) break; location.reload(); await sleep(2000); }
  await sleep(2500);
  const rep=(tag)=>{
    const frame=g("[class*='BynINW_frame']"), cc=g("[class*='BynINW_centerCol']"), sb=g("[class*='_2H3hWW_root']");
    const cs=(e)=>e?getComputedStyle(e).backgroundColor:null;
    const r=sb?sb.getBoundingClientRect():null;
    return {tag, veil:!!g("#dsh-theme-veil"), frameBg:cs(frame), centerBg:cs(cc),
      sidebarBg:cs(sb), sidebarW:r?+r.width.toFixed(1):null, sidebarPos:sb?getComputedStyle(sb).position:null,
      innerWidth:innerWidth};
  };
  const out=[rep("collapsed")];
  const cands=[...document.querySelectorAll("button,[role=button],[aria-label]")].filter(b=>/side|panel|toggle/i.test((b.getAttribute("aria-label")||b.title||""))).map(b=>{const r=b.getBoundingClientRect();return {l:(b.getAttribute("aria-label")||b.title),x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};});
  out.push({tag:"cands",cands});
  let pt=cands.find(o=>/toggle|expand|open/i.test(o.l))||cands.find(o=>o.x>innerWidth*0.5&&o.y<200);
  if(!pt)pt={x:Math.round(innerWidth-30),y:141};
  const el=document.elementFromPoint(pt.x,pt.y);
  if(el){const tgt=(el.closest&&(el.closest("button,[role=button]")||el))||el;tgt.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window}));await sleep(2500);}
  out.push(rep("expanded"));
  return JSON.stringify(out);
})()`;
const r = await send("Runtime.evaluate", { expression: probe, returnByValue: true, awaitPromise: true, userGesture: true });
const v = r && r.result && typeof r.result.value === "string" ? r.result.value : JSON.stringify(r);
fs.writeFileSync(process.argv[2], v, "utf8");
console.log("DOM " + v);
ws.close();
'@
$driverPath = Join-Path $stage "gate-dom.mjs"
[IO.File]::WriteAllText($driverPath, $driver, (New-Object Text.UTF8Encoding $false))
scp @ssh $driverPath "${EmuHost}:$($EmuRoot -replace '\\','/')/gate-dom.mjs" | Out-Null

$remote = @"
`$ErrorActionPreference='Continue'
`$adb='$EmuRoot\Sdk\platform-tools\adb.exe'
& `$adb shell dumpsys package xyz.cpyh.dshpush | Select-String -Pattern 'versionName=' | Select-Object -First 1
`$top = ((& `$adb shell dumpsys window) -join ' ') -match 'WebActivity'
& `$adb shell am force-stop xyz.cpyh.dshpush | Out-Null
Start-Sleep 2
& `$adb shell am start -n xyz.cpyh.dshpush/.WebActivity --es url '$DshWebUrl' | Out-Null
Start-Sleep 12
Remove-Item '$EmuRoot\gate-dom.json' -Force -ErrorAction SilentlyContinue
& `$adb shell screencap -p /sdcard/gate-collapsed.png
& '$Node' '$EmuRoot\gate-dom.mjs' '$EmuRoot\gate-dom.json'
& `$adb shell screencap -p /sdcard/gate-expanded.png
& `$adb pull /sdcard/gate-collapsed.png '$EmuRoot\gate-collapsed.png' | Out-Null
& `$adb pull /sdcard/gate-expanded.png '$EmuRoot\gate-expanded.png' | Out-Null
'DONE'
"@
$remotePath = Join-Path $stage "gate-run.ps1"
[IO.File]::WriteAllText($remotePath, $remote, (New-Object Text.UTF8Encoding $false))
scp @ssh $remotePath "${EmuHost}:$($EmuRoot -replace '\\','/')/gate-run.ps1" | Out-Null
cmd /c "ssh $($ssh -join ' ') $EmuHost ""C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File $EmuRoot\gate-run.ps1""" 2>&1 | ForEach-Object { Write-Host $_ }

scp @ssh "${EmuHost}:$($EmuRoot -replace '\\','/')/gate-dom.json" "$stage\gate-dom.json" | Out-Null
scp @ssh "${EmuHost}:$($EmuRoot -replace '\\','/')/gate-expanded.png" "$OutDir\v1326-expanded.png" | Out-Null
scp @ssh "${EmuHost}:$($EmuRoot -replace '\\','/')/gate-collapsed.png" "$OutDir\v1326-collapsed.png" | Out-Null
if (Test-Path "$stage\gate-dom.json") { Write-Host "DOMREPORT:"; Get-Content "$stage\gate-dom.json" -Raw }
Write-Host "SHOTS: $OutDir\v1326-expanded.png  $OutDir\v1326-collapsed.png"
