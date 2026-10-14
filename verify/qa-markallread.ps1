# qa-markallread.ps1 - v1.32.9 QA: one-tap "mark all read" (QA-C09 + adversarial QA-A20..A24).
# ASCII only (PS 5.1). Run on the orchestrator desktop. Pushes go to the PRODUCTION topic
# (config.local.ps1 $Topic = dsh -> the user's real phone sees them): every body/title carries a
# "qa-" marker + epoch-unique tag, count kept minimal (<=3 per run).
#
# Channels (all hard-probed on emulator-5554):
#  - prefs:      adb shell run-as <pkg> cat .../shared_prefs/dshpush.xml  (device-side redirect
#                to /sdcard, adb pull, scp back -> raw UTF-8 bytes survive; PS text pipes mangle CJK)
#  - coords:     adb shell dumpsys activity top  (uiautomator dump NEVER idles on MainActivity:
#                the ambient breathing animation blocks its idle check, even with anim scales 0)
#  - tap:        adb shell input tap (screen px)
#  - notifs:     adb shell dumpsys notification --noredact  (message notifs appear as
#                "key=0|<pkg>|<nid>|null|<uid>", service notif is id=2 / channel dsh_svc)
#  - toast text: same dumpsys notification -> "Toast Queue:" + "TextToastRecord{... text=...}"
#                (only present while the toast is live -> captured in the SAME remote chain as the tap)
#  - visual:     adb shell screencap -p /sdcard + pull (read_image by the tester, >100KB rule)
#
# Modes:
#  core       QA-C09  2 plain unread pushes -> tap -> four-part assert (prefs/notifs/toast/visual)
#  newmsg     QA-A20  core, then push one more -> must arrive UNREAD, button visible again
#  answered   QA-A21+A22  question + supervisor-proxy echo (answered + read=false)
#                        -> tap -> answered field byte-identical, read flipped, badge kept
#  doubletap  QA-A23  core, then a second tap at the same point -> idempotent, no crash, no N=0 toast
#  inapp      QA-A24  question card with #opts -> tap -> its NOTIF cancelled but card option still
#                        tappable -> option tap -> submit echo (__expired + expired toast)
#  single     QA-C10  per-card "READ" button: push one unread while OTHER unread entries exist ->
#                        tap that card's button -> ONLY my entry flips AND its notif is cancelled
#                        (v1.32.10 semantics; v1.32.9 left the notif alone - flipped by user report),
#                        other unread/nids untouched, NO mark-all toast, pill stays visible
#  readans    QA-A26  answered-but-unread card (supervisor echo already cancelled its notif) ->
#                        its READ button flips read; cancel of the already-gone nid = silent no-op
#  dblcancel  QA-A27  web msg: notif "READ" action (markRead+cancel) THEN card "open DSH" button
#                        (WebActivity cancels the same nid again) -> double cancel idempotent,
#                        no crash, WebActivity opens, prefs intact
#  mix        QA-A28  3 unread -> READ two of them one by one (their notifs go) -> tap the pill ->
#                        toast N counts ONLY the remaining 1; double-cancel of the two gone nids
#                        stays silent; unread ends 0
#  cleanup    delete every msgs entry whose title starts with "qa-" (prefs rewrite + force-stop)
#
# Watchdogs: every remote call is bounded (Start-Job + Wait-Job). Whole-run budget -TotalBudgetSec
# (default 300). On budget/call timeout: print PARTIAL and exit 2 (never hang).
# Exit codes: 0 all PASS, 1 any FAIL, 2 watchdog/PARTIAL, 3 device not responsive.
param(
    [ValidateSet("core","newmsg","answered","doubletap","inapp","single","readans","dblcancel","mix","cleanup","lib")]
    [string]$Mode = "core",
    [string]$OutDir = "F:\work\work_dsh\tmp\shots\qa",
    [string]$Serial = "",
    [int]$TotalBudgetSec = 300,
    # cleanup only: which titles to drop (default all qa-*; pass "qa-*<epoch>*" to spare a
    # concurrent developer self-test whose messages also start with qa-)
    [string]$TitlePattern = "qa-*"
)
$ErrorActionPreference = "Stop"
. "$PSScriptRoot\config.local.ps1"

$Pkg = "xyz.cpyh.dshpush"
$Adb = "G:\Android\Sdk\platform-tools\adb.exe"
$RdirWin = "G:\Android\qa-mard"
$Target = "$EmuUser@$EmuIp"
$RunT = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$Tag = "qa-$Mode$RunT"
New-Item -Force -ItemType directory $OutDir | Out-Null

$script:fail = 0
$script:partial = $false
$script:dead = $false
$Start = Get-Date
# Write-Host, NOT Write-Output: Say is a log line. With Write-Output every "$x = Shot ..."
# assignment swallowed the log into the return value AND polluted it with extra lines.
function Say([string]$lvl, [string]$msg) { Write-Host ("[$lvl] $msg") }
function Check([bool]$cond, [string]$msg) {
    if ($cond) { Say "PASS" $msg } else { Say "FAIL" $msg; $script:fail++ }
}
function Finish {
    if ($script:partial) { Say "RESULT" "PARTIAL (watchdog fired) fail=$($script:fail)"; exit 2 }
    if ($script:fail -gt 0) { Say "RESULT" "FAIL fail=$($script:fail)"; exit 1 }
    Say "RESULT" "PASS"; exit 0
}
function BudgetLeft { return $TotalBudgetSec - [int]((Get-Date) - $Start).TotalSeconds }

# ---------- bounded remote primitives ----------
function Invoke-Bounded([string]$what, [scriptblock]$body, $arglist, [int]$timeout) {
    if ($script:dead) { return $null }
    $left = BudgetLeft
    if ($left -le 5) { Say "WATCHDOG" "total budget exhausted before: $what"; $script:partial = $true; $script:dead = $true; return $null }
    if ($timeout -gt ($left + 15)) { $timeout = $left + 15 }
    if ($null -eq $arglist) { $arglist = @() }
    $j = Start-Job -ScriptBlock $body -ArgumentList $arglist
    if (Wait-Job $j -Timeout $timeout) { $r = Receive-Job $j }
    else { Say "WATCHDOG" "$what exceeded ${timeout}s -> PARTIAL"; $script:partial = $true; $script:dead = $true; Stop-Job $j -ErrorAction SilentlyContinue; $r = $null }
    Remove-Job $j -Force -ErrorAction SilentlyContinue
    return $r
}
# run one command line on the laptop (remote shell is cmd.exe).
# HARD LESSON: PS 5.1 passes embedded double quotes to ssh.exe "as-is" and ssh joins argv into
# ONE string for the remote cmd -> the quotes are LOST. Harmless as long as the command carries
# no cmd metacharacters (> | & <): adb concatenates its argv and hands the device shell the real
# command anyway. So NEVER put a device-side redirect/pipe in here - capture stdout instead
# (jobs decode ssh stdout as UTF-8 so CJK survives), and reserve '&' for intentional chaining.
function Remote([string]$cmd, [int]$timeout = 45) {
    Invoke-Bounded "ssh: $cmd" {
        param($t, $c)
        try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
        & ssh -o BatchMode=yes -o ConnectTimeout=15 $t $c 2>&1 | Out-String
    } @($Target, $cmd) $timeout
}
function RemoteAdb([string]$devCmd, [int]$timeout = 45) {
    # $devCmd must contain NO cmd metacharacters (see Remote)
    Remote "`"$Adb`" -s $Serial shell $devCmd" $timeout
}
# capture device stdout into a local evidence file under $OutDir (UTF-8, LF); returns local path
function Capture([string]$devCmd, [string]$localName, [int]$timeout = 90) {
    $p = Join-Path $OutDir $localName
    $out = RemoteAdb $devCmd $timeout
    if ($null -eq $out) { $out = "" }
    [IO.File]::WriteAllText($p, ($out -replace "`r`n", "`n"), (New-Object Text.UTF8Encoding $false))
    return $p
}
# pull a file from /sdcard into $OutDir (adb pull on the laptop + scp back; binary-safe, PNG only).
# HARD LESSONS: (a) adb pull will NOT create the laptop dir -> mkdir first (error if exists = fine);
# (b) scp remote spec needs FORWARD SLASHES (G:/Android/...), backslashes get eaten as escapes;
# (c) never fully suppress the scp result - Shot() size-checks the local file afterwards.
function PullScp([string]$devName, [string]$localName, [int]$timeout = 60) {
    Remote "mkdir $RdirWin" 20 | Out-Null
    Remote "$Adb -s $Serial pull /sdcard/$devName $RdirWin\$devName" $timeout | Out-Null
    $remote = "G:/Android/qa-mard/$devName"
    $null = Invoke-Bounded "scp $devName" {
        param($t, $r, $l) & scp -o BatchMode=yes -o ConnectTimeout=15 "$t`:$r" $l 2>&1 | Out-String
    } @($Target, $remote, (Join-Path $OutDir $localName)) $timeout
    return (Join-Path $OutDir $localName)
}
function ReadUtf8([string]$path) {
    if (-not (Test-Path $path)) { return "" }
    return [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
}

# ---------- Chinese via codepoints (this script must stay ASCII) ----------
# NOTE: do NOT name this "cp" - the built-in cp alias (Copy-Item) wins over functions.
function CodePts([int[]]$codes) { -join ($codes | ForEach-Object { [char]$_ }) }
$SupervisorPrefix = CodePts @(0x3010,0x76D1,0x7763,0x8005,0x81EA,0x52A8,0x5524,0x9192,0x3011)  # supervisor-proxy marker
$ToastPrefix = CodePts @(0x5DF2,0x5168,0x90E8,0x6807,0x4E3A,0x5DF2,0x8BFB,0xFF08)              # "all marked read ("
$ToastSuffix = CodePts @(0x6761,0xFF09)                                                        # " items)"
$ExpiredToast = CodePts @(0x8FD9,0x4E2A,0x95EE,0x9898,0x5DF2,0x7ECF,0x8FC7,0x671F,0x4E86)      # "this question has expired"
$PhoneEmoji = [char]::ConvertFromUtf32(0x1F4F1)                                           # phone emoji before answer link

# ---------- push (production topic, qa- marker) ----------
function Push([string]$title, [string]$msg, [int]$prio) {
    $esc = { param($s) $s.Replace('\','\\').Replace('"','\"').Replace("`n", '\n') }
    $body = '{"topic":"' + $Topic + '","title":"' + (& $esc $title) + '","message":"' + (& $esc $msg) + '","priority":' + $prio + '}'
    $tmp = Join-Path $env:TEMP "dsh-verify\push-mard-$RunT-$prio-$(Get-Random).json"
    New-Item -Force -ItemType directory (Split-Path $tmp) | Out-Null
    [IO.File]::WriteAllText($tmp, $body, (New-Object Text.UTF8Encoding $false))
    & curl.exe -s --max-time 15 -X POST -H "Authorization: Bearer $WriteToken" `
        -H "Content-Type: application/json" --data-binary "@$tmp" $Ntfy | Out-Null
}

# ---------- prefs ----------
# capture prefs xml to $OutDir, return LOCAL PATH (UTF-8 text, still XML-escaped)
function Fetch-Prefs([string]$tagSuffix) {
    return (Capture "run-as $Pkg cat /data/data/$Pkg/shared_prefs/dshpush.xml" ("prefs-" + $Tag + "-" + $tagSuffix + ".xml"))
}
# unescaped text, ready for parsing
function Get-PrefsRaw([string]$tagSuffix) {
    $raw = ReadUtf8 (Fetch-Prefs $tagSuffix)
    $raw = $raw -replace '&quot;', '"' -replace '&amp;', '&'
    return $raw
}
function Get-Msgs([string]$raw) {
    $m = [regex]::Match($raw, 'name="msgs">(.*?)</string>')
    if (-not $m.Success) { return $null }
    try { return (ConvertFrom-Json $m.Groups[1].Value) } catch { return $null }
}
function UnreadCount($msgs) {
    if (-not $msgs) { return -1 }
    $n = 0
    foreach ($e in $msgs) { if ($e.PSObject.Properties['read'] -and $e.read -eq $false) { $n++ } }
    return $n
}
function FindEntry($msgs, [string]$title) {
    if (-not $msgs) { return $null }
    foreach ($e in $msgs) { if ($e.title -eq $title) { return $e } }
    return $null
}

# ---------- dumpsys activity top -> view tree ----------
# Returns @{ All = <node list>; SvIdx = <index of first ScrollView> } or $null.
# Node: Indent Cls Flags1 Ax Ay W H Parent (absolute coords via ancestor offset sum).
function Parse-Tree([string]$path) {
    if (-not (Test-Path $path)) { return $null }
    $lines = [IO.File]::ReadAllLines($path, [Text.Encoding]::UTF8)
    $ai = -1
    for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match 'ACTIVITY .*MainActivity') { $ai = $i } }
    if ($ai -lt 0) { return $null }
    $nodeRe = '^(\s*)([\w.$]+)\{[0-9a-fA-F]+\s+(\S+)\s+(\S+)\s+(-?\d+),(-?\d+)-(-?\d+),(-?\d+)'
    $all = New-Object System.Collections.ArrayList
    $pathStack = New-Object System.Collections.ArrayList
    $svIdx = -1; $svIndent = -1; $svParent = -1
    for ($i = $ai; $i -lt $lines.Count; $i++) {
        $l = $lines[$i]
        if ($i -gt $ai -and $l -match '^\s{0,4}ACTIVITY ') { break }
        $m = [regex]::Match($l, $nodeRe)
        if (-not $m.Success) { continue }
        $indent = $m.Groups[1].Value.Length
        $cls = $m.Groups[2].Value
        $flags = $m.Groups[3].Value
        $L = [int]$m.Groups[5].Value; $T = [int]$m.Groups[6].Value
        $W = ([int]$m.Groups[7].Value) - $L; $H = ([int]$m.Groups[8].Value) - $T
        while ($pathStack.Count -gt 0 -and $all[$pathStack[$pathStack.Count-1]].Indent -ge $indent) {
            $pathStack.RemoveAt($pathStack.Count-1)
        }
        $parent = -1; $px = 0; $py = 0
        if ($pathStack.Count -gt 0) { $parent = $pathStack[$pathStack.Count-1]; $px = $all[$parent].Ax; $py = $all[$parent].Ay }
        $node = [pscustomobject]@{ Indent=$indent; Cls=$cls; Flags=$flags; Ax=$px+$L; Ay=$py+$T; W=$W; H=$H; Parent=$parent }
        $idx = $all.Add($node)
        $pathStack.Add($idx) | Out-Null
        if ($svIdx -lt 0 -and $cls -like '*.ScrollView') { $svIdx = $idx; $svIndent = $indent; $svParent = $parent }
    }
    if ($svIdx -lt 0) { return $null }
    return [pscustomobject]@{ All = $all; SvIdx = $svIdx; SvIndent = $svIndent; SvParent = $svParent }
}
function FirstVisibleButtonInSubtree($tree, [int]$rootIdx) {
    $all = $tree.All
    $rootIndent = $all[$rootIdx].Indent
    for ($k = $rootIdx + 1; $k -lt $all.Count; $k++) {
        if ($all[$k].Indent -le $rootIndent) { break }
        $n = $all[$k]
        if ($n.Cls -like '*.Button' -and $n.Flags[0] -eq 'V' -and $n.Flags.IndexOf('C') -ge 0 -and $n.W -gt 0 -and $n.H -gt 0) {
            return [pscustomobject]@{ X = $n.Ax + [int]($n.W/2); Y = $n.Ay + [int]($n.H/2); W = $n.W; H = $n.H }
        }
    }
    return $null
}
# mark-all-read pill = first visible clickable Button inside the status card
# (status card = last visible LinearLayout sibling right before the msgList ScrollView)
function Parse-StatusButton([string]$path) {
    $tree = Parse-Tree $path
    if (-not $tree) { return $null }
    $all = $tree.All
    $cardIdx = -1
    for ($k = 0; $k -lt $tree.SvIdx; $k++) {
        $n = $all[$k]
        if ($n.Parent -eq $tree.SvParent -and $n.Indent -eq $tree.SvIndent -and $n.Cls -like '*.LinearLayout' -and $n.Flags[0] -eq 'V') { $cardIdx = $k }
    }
    if ($cardIdx -lt 0) { return $null }
    return (FirstVisibleButtonInSubtree $tree $cardIdx)
}
# first card option pill = first visible clickable Button under the ScrollView
function Parse-FirstCardOption([string]$path) {
    $tree = Parse-Tree $path
    if (-not $tree) { return $null }
    return (FirstVisibleButtonInSubtree $tree $tree.SvIdx)
}
function Dump-ActTop([string]$localName) {
    return (Capture "dumpsys activity top" $localName)
}

# ---------- notification dump ----------
# returns the DUMP CONTENT (not the path): an earlier bug had NotifPresent/ToastN matching the
# path string -> vacuous PASSes. Capture still writes the evidence file.
function Dump-Notif([string]$localName) {
    return (ReadUtf8 (Capture "dumpsys notification --noredact" $localName))
}
function NotifPresent([string]$dump, [int]$nid) { return $dump -match ('key=0\|' + [regex]::Escape($Pkg) + '\|' + $nid + '\|') }
function ServiceNotifPresent([string]$dump) { return $dump -match ('key=0\|' + [regex]::Escape($Pkg) + '\|2\|') }
function ToastN([string]$dump) {
    $m = [regex]::Match($dump, [regex]::Escape($ToastPrefix) + '([0-9]+) ' + [regex]::Escape($ToastSuffix))
    if ($m.Success) { return [int]$m.Groups[1].Value }
    return -1
}

# ---------- screenshot / tap ----------
function Shot([string]$name) {
    $dev = "qa-mard-" + $name + ".png"
    $null = RemoteAdb "screencap -p /sdcard/$dev" 60
    $p = PullScp $dev ($name + ".png")
    $size = 0
    if (Test-Path $p) { $size = (Get-Item $p).Length }
    if ($size -gt 100KB) { Say "SHOT" "$p ($size bytes)" } else { Say "SHOT-FAIL" "$p size=$size (<100KB = capture failed, NOT 'no change')" }
    return $p
}
# tap, then dumpsys-notif in ONE remote chain (toast lives ~2s: the dump must be taken in the
# same breath as the tap; '&' chaining is safe - the remote cmd runs the commands in order and
# the last one's stdout is what ssh returns). The 1s ping delay is REQUIRED: `input tap` returns
# as soon as the event is injected, the app needs ~0.3-0.8s to process the click (cancel notifs
# + enqueue toast); dumping immediately races it (v1.32.9 round: notif still visible + toast not
# yet enqueued = 3 false FAILs). `>nul` is intentionally eaten by the REMOTE cmd (quote loss).
function Tap-And-Capture([int]$x, [int]$y, [string]$shotName) {
    $chain = "`"$Adb`" -s $Serial shell input tap $x $y & ping -n 2 127.0.0.1 >nul & `"$Adb`" -s $Serial shell dumpsys notification --noredact"
    $out = Remote $chain 90
    $np = Join-Path $OutDir ("notif-" + $Tag + "-" + $shotName + ".txt")
    if ($null -eq $out) { $out = "" }
    [IO.File]::WriteAllText($np, ($out -replace "`r`n", "`n"), (New-Object Text.UTF8Encoding $false))
    $sp = Shot $shotName
    return [pscustomobject]@{ Notif = $np; Shot = $sp }
}

# fire the notification's READ action (v1.18.0: AnswerReceiver act=read -> markRead + cancel).
# Real-UI first: expand the shade and uiautomator-dump it - SystemUI DOES idle (the never-idles
# problem is MainActivity's own ambient animation). Fallback: send the exact broadcast the
# action's PendingIntent sends. Either way the exercised code path is the app's own.
function Tap-NotifReadAction([int]$mid, [long]$ts, [int]$nid) {
    $null = RemoteAdb "cmd statusbar expand-notifications"
    Start-Sleep 2
    $xml = ""
    $dump = RemoteAdb "uiautomator dump /sdcard/qa-mard-shade.xml" 60
    if ($dump -match 'dumped to') { $xml = (RemoteAdb "cat /sdcard/qa-mard-shade.xml" 60 | Out-String) }
    $rd = [string][char]0x5DF2 + [char]0x8BFB   # the action button's label
    $m = [regex]::Match($xml, ('<node[^>]*text="' + [regex]::Escape($rd) + '"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'))
    if ($m.Success) {
        $x = [int](([int]$m.Groups[1].Value + [int]$m.Groups[3].Value) / 2)
        $y = [int](([int]$m.Groups[2].Value + [int]$m.Groups[4].Value) / 2)
        # tap while the shade is STILL EXPANDED (collapsing first makes the tap land on the app
        # behind - v1.32.10 QA first run: bounds found fine, tap hit nothing = 2 false FAILs)
        $null = RemoteAdb "input tap $x $y"
        Start-Sleep 1
        $null = RemoteAdb "cmd statusbar collapse"
        return @{ How = "uiautomator"; XY = "$x,$y" }
    }
    $null = RemoteAdb "cmd statusbar collapse"
    $null = RemoteAdb "am broadcast -n $Pkg/.AnswerReceiver --es act read --ei mid $mid --el ts $ts --ei nid $nid"
    return @{ How = "broadcast"; XY = "" }
}

# poll prefs until an entry by title satisfies a predicate; returns @{Raw;Msgs;Entry} or $null
function Wait-Entry([string]$title, [int]$sec, [scriptblock]$pred) {
    $deadline = (Get-Date).AddSeconds($sec)
    while ((Get-Date) -lt $deadline -and -not $script:dead) {
        $raw = Get-PrefsRaw "qa-mard-prefs-wait.xml"
        $msgs = Get-Msgs $raw
        $e = FindEntry $msgs $title
        if ($e -and (& $pred $e)) { return [pscustomobject]@{ Raw = $raw; Msgs = $msgs; Entry = $e } }
        Start-Sleep 4
    }
    return $null
}

# =================== main ===================
# "lib" mode: dot-source for the primitives (Remote/Capture/Parse-Tree/Parse-StatusButton/
# Parse-FirstCardOption/Push/Wait-Entry/Shot...) and run your own main. Caller must set
# $Serial after sourcing (detection lives in main).
if ($Mode -eq "lib") { return }
Say "INFO" "mode=$Mode tag=$Tag topic=$Topic (PRODUCTION -> real phone, qa- marker)"

# serial discovery + liveness
if (-not $Serial) {
    # NOTE: do NOT wrap this in cmd /c inside a job - PS re-escapes the embedded quotes and cmd
    # then reports "path not found". ssh-with-one-arg (same as Remote) is the proven shape.
    $dv = Invoke-Bounded "adb devices" {
        param($t, $c) & ssh -o BatchMode=yes -o ConnectTimeout=15 $t $c 2>&1 | Out-String
    } @($Target, "`"$Adb`" devices") 30
    if ($dv) { foreach ($l in ($dv -split "`n")) { if ($l -match '^(emulator-\d+)\s+device') { $Serial = $Matches[1]; break } } }
}
if (-not $Serial) { Say "ABORT" "no emulator device in adb devices"; exit 3 }
$alive = (RemoteAdb "echo ok" 20 | Out-String)
if ($alive -notmatch 'ok') { Say "ABORT" "device $Serial not responsive - report to Lead, do NOT cold-start here"; exit 3 }
Say "INFO" "serial=$Serial alive budget=${TotalBudgetSec}s"

if ($Mode -eq "cleanup") {
    $null = RemoteAdb "am force-stop $Pkg"
    $rawEsc = ReadUtf8 (Fetch-Prefs "qa-mard-prefs-cleanup.xml")   # keep XML escapes for splicing
    $raw = $rawEsc -replace '&quot;', '"' -replace '&amp;', '&'      # unescaped copy for parsing
    $msgs = Get-Msgs $raw
    if (-not $msgs) { Say "ABORT" "prefs unreadable"; exit 1 }
    $keep = @(); $dropped = 0
    foreach ($e in $msgs) { if ($e.title -like $TitlePattern) { $dropped++ } else { $keep += $e } }
    $json = '[]'
    if ($keep.Count -gt 0) {
        $parts = $keep | ForEach-Object { ConvertTo-Json -InputObject $_ -Compress -Depth 6 }
        $json = '[' + ($parts -join ',') + ']'
    }
    $m = [regex]::Match($rawEsc, '(?s)(<string name="msgs">).*?(</string>)')
    if (-not $m.Success) { Say "ABORT" "msgs element not found in prefs xml"; exit 1 }
    $escJson = $json.Replace('&','&amp;').Replace('<','&lt;').Replace('>','&gt;')
    # splice on $rawEsc (the match indices come from it; $raw is a different length due to escapes)
    $newXml = $rawEsc.Remove($m.Index, $m.Length).Insert($m.Index, $m.Groups[1].Value + $escJson + $m.Groups[2].Value)
    $xmlLocal = Join-Path $env:TEMP "dsh-verify\dshpush-$RunT.xml"
    New-Item -Force -ItemType directory (Split-Path $xmlLocal) | Out-Null
    [IO.File]::WriteAllText($xmlLocal, $newXml, (New-Object Text.UTF8Encoding $false))
    $null = Remote "mkdir $RdirWin" 20
    $null = Invoke-Bounded "scp prefs up" { param($l, $t, $r) & scp -o BatchMode=yes -o ConnectTimeout=15 $l "$t`:$r" 2>&1 | Out-String } @($xmlLocal, $Target, "G:/Android/qa-mard/dshpush-$RunT.xml") 60
    $null = Remote "$Adb -s $Serial push $RdirWin\dshpush-$RunT.xml /sdcard/dshpush.xml" 60
    # API 36: run-as cp CANNOT read /sdcard (SELinux + shell mount ns, README hard fact).
    # This emulator's adbd is root (userdebug) -> plain cp + chown + restorecon.
    $uid = ((RemoteAdb "stat -c %u /data/data/$Pkg" | Out-String)).Trim()
    $null = RemoteAdb "cp /sdcard/dshpush.xml /data/data/$Pkg/shared_prefs/dshpush.xml"
    $null = RemoteAdb "chown -R $uid /data/data/$Pkg/shared_prefs"
    $null = RemoteAdb "restorecon -R /data/data/$Pkg/shared_prefs"
    $check = Get-PrefsRaw "qa-mard-prefs-cleanup2.xml"
    $cm = Get-Msgs $check
    $left = 0; if ($cm) { foreach ($e in $cm) { if ($e.title -like $TitlePattern) { $left++ } } }
    Check ($left -eq 0) "cleanup: entries matching '$TitlePattern' remaining = $left (dropped $dropped, kept $($keep.Count)); app force-stopped"
    Finish
}

# ---- wake the app FIRST: pushes only land while PushService's WS is connected.
# A preceding force-stop (developer self-test cleanup) leaves nobody listening -> the
# 40s arrival wait would false-FAIL. Cold start + WS connect ~3-5s; Wait-Entry covers the rest.
$null = RemoteAdb "am start -n $Pkg/.MainActivity"
Start-Sleep 4

# =================== v1.32.10 new adversarial angles (QA-A26/A27/A28) ===================
# self-contained branches: own push/wait/assert, then Finish. They exercise the per-card READ
# path (markRead now ALSO cancels the notif - v1.32.10) from angles the core flow cannot reach.
$tPlain1 = "qa-$Mode $Tag p1"; $tPlain2 = "qa-$Mode $Tag p2"; $tQ = "qa-$Mode $Tag q1"; $tNew = "qa-$Mode $Tag late"
$cid = "qa-mard-$RunT"
if ($Mode -eq "readans") {
    # A26: answered-but-unread card (supervisor echo already cancelled its notif) -> its READ
    # button flips read; cancel of the ALREADY-GONE nid must be a silent no-op (A25 posture).
    Push $tQ ("qa question $Tag`n$PhoneEmoji answer link: $Ntfy/answer/$cid`n#opts q0=optA|optB`n#qid q0") 4
    Start-Sleep 6
    Push "qa-$Mode echo" "#ans $cid $SupervisorPrefix qa proxy" 1
    $w = Wait-Entry $tQ 40 { param($e) $e.answered -like "$SupervisorPrefix*" -and $e.read -eq $false }
    if (-not $w) { Check $false "readans: supervisor-echo entry (answered + read=false) never landed"; Finish }
    $nid = [int]$w.Entry.mid
    $null = RemoteAdb "am start -n $Pkg/.MainActivity"
    Start-Sleep 3
    $pre = Dump-Notif ("notif-" + $Tag + "-pre.txt")
    Check (-not (NotifPresent $pre $nid)) "A26: echo already cancelled the question notif (nid=$nid absent BEFORE the tap)"
    $at = Dump-ActTop ("acttop-" + $Tag + "-before.txt")
    $btn = Parse-FirstCardOption $at
    if (-not $btn) { Say "FAIL" "A26: answered-unread first card has NO READ button (MainActivity answered-unread path missing?)"; $script:fail++; Finish }
    Say "INFO" ("A26: READ button center=({0},{1}) size={2}x{3}" -f $btn.X, $btn.Y, $btn.W, $btn.H)
    $cap = Tap-And-Capture $btn.X $btn.Y ("qa-" + $Mode + "-after")
    $d1 = ReadUtf8 $cap.Notif
    $msgs2 = Get-Msgs (Get-PrefsRaw "qa-mard-prefs-after.xml")
    $e2 = FindEntry $msgs2 $tQ
    Check ($null -ne $e2 -and $e2.read -eq $true) "A26: answered-unread entry flipped read=true via its READ button"
    Check (-not (NotifPresent $d1 $nid)) "A26: cancel of the already-gone nid = silent no-op (nid still absent)"
    Check ((ToastN $d1) -lt 0) "A26: no toast from per-card READ"
    Check (ServiceNotifPresent $d1) "A26: service notif untouched"
    $pidAlive = (RemoteAdb "pidof $Pkg" | Out-String).Trim()
    Check ($pidAlive -match '\d+') "A26: process alive (pid=$pidAlive)"
    Check ($null -ne $msgs2) "A26: msgs JSON intact after the double-cancel"
    $null = Shot ("qa-" + $Mode + "-after")
    Say "EYE" "read_image: qa-readans-after.png - expect the answered card dimmed, READ button gone, answered badge kept"
    Finish
}

if ($Mode -eq "dblcancel") {
    # A27: notif "READ" action (AnswerReceiver: markRead + cancel) THEN the card's "open DSH"
    # button (WebActivity cancels the SAME nid again) -> double cancel idempotent, no crash.
    $tWeb = "qa-$Mode $Tag w1"
    Push $tWeb ("qa web msg $Tag`n#web $Ntfy") 3
    $w = Wait-Entry $tWeb 40 { param($e) $true }
    if (-not $w) { Check $false "dblcancel: web push never arrived"; Finish }
    $nid = [int]$w.Entry.mid; $ts = [long]$w.Entry.ts
    $pre = Dump-Notif ("notif-" + $Tag + "-pre.txt")
    Check (NotifPresent $pre $nid) "A27: web msg notif present before (nid=$nid)"
    $act = Tap-NotifReadAction $nid $ts $nid
    Say "INFO" ("A27: notif READ action fired via " + $act.How + " " + $act.XY)
    Start-Sleep 2
    $msgs2 = Get-Msgs (Get-PrefsRaw "qa-mard-prefs-act1.xml")
    $e2 = FindEntry $msgs2 $tWeb
    Check ($null -ne $e2 -and $e2.read -eq $true) "A27: notif READ action flipped read=true"
    $d1 = Dump-Notif ("notif-" + $Tag + "-act1.txt")
    Check (-not (NotifPresent $d1 $nid)) "A27: notif cancelled by the action (nid=$nid gone)"
    # second cancel: card "open DSH" -> WebActivity cancels the same nid again (must be silent)
    $null = RemoteAdb "am start -n $Pkg/.MainActivity"
    Start-Sleep 3
    $at = Dump-ActTop ("acttop-" + $Tag + "-card.txt")
    $btn = Parse-FirstCardOption $at
    if (-not $btn) { Say "FAIL" "A27: open-DSH button not found on first card"; $script:fail++; Finish }
    $null = RemoteAdb "input tap $($btn.X) $($btn.Y)"
    Start-Sleep 4
    $focusTxt = ReadUtf8 (Capture "dumpsys window" ("win-" + $Tag + "-web.txt") 60)
    Check ($focusTxt -match 'mCurrentFocus=Window\{[^}]*WebActivity') "A27: open-DSH tap opened WebActivity (second cancel ran inside it)"
    $d2 = Dump-Notif ("notif-" + $Tag + "-act2.txt")
    Check (-not (NotifPresent $d2 $nid)) "A27: second cancel of the gone nid silent (nid still absent)"
    $pidAlive = (RemoteAdb "pidof $Pkg" | Out-String).Trim()
    Check ($pidAlive -match '\d+') "A27: process alive after the double cancel (pid=$pidAlive)"
    $msgs3 = Get-Msgs (Get-PrefsRaw "qa-mard-prefs-act2.xml")
    $e3 = FindEntry $msgs3 $tWeb
    Check ($null -ne $e3 -and $e3.read -eq $true) "A27: read stays true (markRead idempotent)"
    Check ($null -ne $msgs3) "A27: msgs JSON intact"
    $null = Shot ("qa-" + $Mode + "-web")
    Say "EYE" "read_image: qa-dblcancel-web.png - expect WebActivity showing the #web url page"
    Finish
}

if ($Mode -eq "mix") {
    # A28: READ two of three one by one (their notifs go), then the pill -> toast N counts ONLY
    # the remaining unread; the two already-gone nids get double-cancelled silently.
    $tP3 = "qa-$Mode $Tag p3"
    $tAll = @($tPlain1, $tPlain2, $tP3)
    Push $tPlain1 "qa marker $Tag mix one" 3
    Push $tPlain2 "qa marker $Tag mix two" 3
    Push $tP3 "qa marker $Tag mix three" 3
    $w = $null
    foreach ($t in $tAll) { $w = Wait-Entry $t 40 { param($e) $true }; if (-not $w) { break } }
    if (-not $w) { Check $false "mix: not all three pushes arrived"; Finish }
    $msgs = $w.Msgs
    $unreadStart = UnreadCount $msgs
    $nidsAll = @{}
    foreach ($t in $tAll) { $e = FindEntry $msgs $t; if ($e) { $nidsAll[$t] = [int]$e.mid } }
    $pre = Dump-Notif ("notif-" + $Tag + "-pre.txt")
    foreach ($t in $nidsAll.Keys) { Check (NotifPresent $pre $nidsAll[$t]) "A28: notif present before ($t nid=$($nidsAll[$t]))" }
    for ($k = 1; $k -le 2; $k++) {
        $at = Dump-ActTop ("acttop-" + $Tag + "-card$k.txt")
        $btn = Parse-FirstCardOption $at
        if (-not $btn) { Say "FAIL" "A28: per-card READ button not found before tap $k"; $script:fail++; Finish }
        $cap = Tap-And-Capture $btn.X $btn.Y ("qa-mix-card$k")
        $dk = ReadUtf8 $cap.Notif
        Check ((ToastN $dk) -lt 0) "A28: no toast from per-card READ (tap $k)"
        $msgsK = Get-Msgs (Get-PrefsRaw "qa-mard-prefs-card$k.xml")
        $unreadNow = UnreadCount $msgsK
        Check ($unreadNow -eq $unreadStart - $k) "A28: unread after tap $k = $unreadNow (expect $($unreadStart - $k))"
    }
    $msgsB = Get-Msgs (Get-PrefsRaw "qa-mard-prefs-beforepill.xml")
    $unreadBeforePill = UnreadCount $msgsB
    Check ($unreadBeforePill -eq $unreadStart - 2) "A28: exactly the two tapped entries flipped (unread now $unreadBeforePill)"
    $at2 = Dump-ActTop ("acttop-" + $Tag + "-pill.txt")
    $pill = Parse-StatusButton $at2
    if (-not $pill) { Say "FAIL" "A28: pill not found (unread>0 expected)"; $script:fail++; Finish }
    $cap2 = Tap-And-Capture $pill.X $pill.Y ("qa-mix-pill")
    $dp = ReadUtf8 $cap2.Notif
    $tn = ToastN $dp
    Check ($tn -eq $unreadBeforePill) "A28: mark-all toast N=$tn counts ONLY the remaining unread (was $unreadStart before the two per-card READs)"
    Check ($tn -lt $unreadStart) "A28: the two already-read entries are NOT counted in N"
    Check ((UnreadCount (Get-Msgs (Get-PrefsRaw "qa-mard-prefs-after.xml"))) -eq 0) "A28: unread ends at 0"
    foreach ($t in $nidsAll.Keys) { Check (-not (NotifPresent $dp $nidsAll[$t])) "A28: notif gone after pill ($t nid=$($nidsAll[$t]); the two already-gone double-cancelled silently)" }
    $pidAlive = (RemoteAdb "pidof $Pkg" | Out-String).Trim()
    Check ($pidAlive -match '\d+') "A28: process alive after 3 cancels + 2 double-cancels (pid=$pidAlive)"
    $null = Shot ("qa-" + $Mode + "-after")
    Say "EYE" "read_image: qa-mix-after.png - expect all three mix cards dimmed, pill hidden, no unread line"
    Finish
}

# ---- push phase ----
# (title vars + cid already defined above, before the v1.32.10 branches)
switch ($Mode) {
    "core"       { Push $tPlain1 "qa marker $Tag plain one" 3; Push $tPlain2 "qa marker $Tag plain two" 3 }
    "doubletap"  { Push $tPlain1 "qa marker $Tag plain one" 3; Push $tPlain2 "qa marker $Tag plain two" 3 }
    "newmsg"     { Push $tPlain1 "qa marker $Tag plain one" 3; Push $tPlain2 "qa marker $Tag plain two" 3 }
    "answered"   {
        Push $tQ ("qa question $Tag`n$PhoneEmoji answer link: $Ntfy/answer/$cid`n#opts q0=optA|optB`n#qid q0") 4
        Start-Sleep 6
        Push "qa-$Mode echo" "#ans $cid $SupervisorPrefix qa proxy" 1
    }
    "inapp"      { Push $tQ ("qa question $Tag`n$PhoneEmoji answer link: $Ntfy/answer/$cid`n#opts q0=optA|optB`n#qid q0") 4 }
    "single"     { Push $tPlain1 "qa marker $Tag single target" 3 }
}

# ---- wait for arrival ----
$need = @($tPlain1, $tPlain2)
if ($Mode -eq "answered" -or $Mode -eq "inapp") { $need = @($tQ) }
if ($Mode -eq "single") { $need = @($tPlain1) }
$last = $null
foreach ($t in $need) {
    $last = Wait-Entry $t 40 { param($e) $true }
    if (-not $last) { Check $false "push never arrived: $t" }
}
if ($script:fail -gt 0 -or $script:dead) { Finish }
$raw = $last.Raw; $msgs = $last.Msgs

# supervisor echo must have landed before the tap (answered mode)
if ($Mode -eq "answered") {
    $w = Wait-Entry $tQ 25 { param($e) $e.answered -like "$SupervisorPrefix*" }
    if (-not $w) { Check $false "supervisor echo never landed in prefs (qa-readstate branch broken?)" }
    else {
        $raw = $w.Raw; $msgs = $w.Msgs
        $q = $w.Entry
        if ($q.read -ne $false) { Check $false "supervisor echo should keep read=false, got read=$($q.read)" }
    }
    if ($script:fail -gt 0) { Finish }
}

# ---- open MainActivity ----
$null = RemoteAdb "am start -n $Pkg/.MainActivity"
Start-Sleep 3

# ---- pre-state: unread count, nids, button geometry ----
$unreadBefore = UnreadCount $msgs
Say "INFO" "unread before tap = $unreadBefore"
$nids = @{}
foreach ($t in $need) { $e = FindEntry $msgs $t; if ($e) { $nids[$t] = [int]$e.mid } }
# single mode: snapshot notif state + the OTHER unread entries BEFORE the tap (they must survive)
$preDump = ""; $others = @()
if ($Mode -eq "single") {
    $preDump = Dump-Notif ("notif-" + $Tag + "-pre.txt")
    foreach ($e in $msgs) { if ($e.PSObject.Properties['read'] -and $e.read -eq $false -and $e.title -ne $tPlain1) { $others += $e } }
    Say "INFO" "single: other unread entries = $($others.Count) (their nids must survive the tap)"
}
$at = Dump-ActTop ("acttop-" + $Tag + "-before.txt")
if ($Mode -eq "single") {
    $btn = Parse-FirstCardOption $at   # first card = newest = my pushed entry; its button = READ
    if (-not $btn) { Say "FAIL" "single: per-card READ button NOT FOUND in first card"; $script:fail++; Finish }
} else {
    $btn = Parse-StatusButton $at
    if (-not $btn) { Say "FAIL" "mark-all-read button NOT FOUND in status card (dumpsys activity top) - not implemented, or unread=0, or geometry parse broke"; $script:fail++; Finish }
}
Say "INFO" ("button center=({0},{1}) size={2}x{3}" -f $btn.X, $btn.Y, $btn.W, $btn.H)
$null = Shot ("qa-" + $Mode + "-before")

# ---- tap (+ toast/notif/screenshot in one chain) ----
$cap = Tap-And-Capture $btn.X $btn.Y ("qa-" + $Mode + "-after")
$dump1 = ReadUtf8 $cap.Notif

# ---- post-state ----
$raw2 = Get-PrefsRaw "qa-mard-prefs-after.xml"
$msgs2 = Get-Msgs $raw2
$unreadAfter = UnreadCount $msgs2
$at2 = Dump-ActTop ("acttop-" + $Tag + "-after.txt")
$btn2 = Parse-StatusButton $at2
$dump2 = Dump-Notif ("notif-" + $Tag + "-late.txt")

# =================== assertions (four-part core) ===================
if ($Mode -eq "single") {
    Check ($unreadAfter -eq ($unreadBefore - 1)) "single: unread $($unreadBefore) -> $unreadAfter (ONLY my entry flipped, expect $($unreadBefore - 1))"
} else {
    Check ($unreadAfter -eq 0) "prefs: unread count after tap = $unreadAfter (expect 0)"
}
# A25 (developer hand-off angle): cancelling nids whose notifications were long auto-cancelled
# must be a silent no-op -> process alive + msgs JSON still well-formed
$pidAlive = (RemoteAdb "pidof $Pkg" | Out-String).Trim()
Check ($pidAlive -match '\d+') "A25: app process alive after tap (cancel of already-dismissed nids is a no-op, pid=$pidAlive)"
Check ($null -ne $msgs2) "A25: msgs JSON still well-formed after tap"
foreach ($t in $need) {
    $e = FindEntry $msgs2 $t
    Check ($null -ne $e -and $e.read -eq $true) "prefs: entry read=true after tap: $t"
}
if ($Mode -eq "single") {
    if ($others.Count -gt 0) { Check ($null -ne $btn2) "single: pill STILL VISIBLE (other unread remain)" }
    else { Check ($null -eq $btn2) "single: pill hidden (no unread left)" }
} else {
    Check ($null -eq $btn2) "ui-structure: mark-all-read button hidden after tap (unread=0)"
}
foreach ($t in $need) {
    $nid = $nids[$t]
    if ($Mode -eq "single") {
        # v1.32.10: per-card READ (PushService.markRead) now ALSO cancels its own notif
        # (user report; v1.32.9 left it alone - QA-C10 assertion flipped by Lead).
        Check (-not (NotifPresent $dump1 $nid)) "single: my notif nid=$nid cancelled by per-card READ ($t)"
        Check (-not (NotifPresent $dump2 $nid)) "single: still gone in late dump (nid=$nid)"
    } else {
        Check (-not (NotifPresent $dump1 $nid)) "notifs: message notif nid=$nid cancelled ($t)"
        Check (-not (NotifPresent $dump2 $nid)) "notifs: still gone in late dump (nid=$nid)"
    }
}
Check (ServiceNotifPresent $dump1) "notifs: service notif id=2 still present"
$tn = ToastN $dump1
if ($Mode -eq "single") {
    Check ($tn -lt 0) "single: per-card READ produced NO mark-all toast (toastN=$tn, -1=none)"
    foreach ($o in $others) {
        $onid = [int]$o.mid
        Check ((NotifPresent $dump1 $onid) -eq (NotifPresent $preDump $onid)) "single: other unread nid=$onid notif state unchanged by the tap"
        $oe = FindEntry $msgs2 $o.title
        Check ($null -ne $oe -and $oe.read -eq $false) "single: other entry still unread: $($o.title)"
    }
} else {
    if ($tn -lt 0) { $tn = ToastN $dump2 }
    if ($tn -lt 0) { Check $false "toast: TextToastRecord '$ToastPrefix..$ToastSuffix' not captured (timing) - eyeball the after-shot" }
    else { Check ($tn -eq $unreadBefore) "toast: N=$tn matches unread-before=$unreadBefore" }
}

# ---- mode-specific ----
if ($Mode -eq "answered") {
    $q2 = FindEntry $msgs2 $tQ
    $before = FindEntry $msgs $tQ
    Check ($q2.answered -eq $before.answered) "A21: answered field byte-identical after tap ('$($q2.answered)')"
    Check ($q2.read -eq $true) "A22: supervisor-proxy unread FLIPPED to read=true (product decision)"
}
if ($Mode -eq "doubletap") {
    $null = RemoteAdb "input tap $($btn.X) $($btn.Y)"
    Start-Sleep 2
    $dump3 = Dump-Notif ("notif-" + $Tag + "-tap2.txt")
    $tn2 = ToastN $dump3
    Check ($tn2 -ne 0) "A23: second tap produced no N=0 toast (button hid itself). toastN=$tn2 (-1=no toast = good)"
    $raw3 = Get-PrefsRaw "qa-mard-prefs-tap2.xml"
    Check ((UnreadCount (Get-Msgs $raw3)) -eq 0) "A23: prefs still all-read after second tap (idempotent)"
    $pid2 = (RemoteAdb "pidof $Pkg" | Out-String).Trim()
    Check ($pid2 -match '\d+') "A23: app process alive after second tap (pid=$pid2)"
}
if ($Mode -eq "newmsg") {
    Push $tNew "qa marker $Tag late arrival" 3
    $w = Wait-Entry $tNew 40 { param($e) $true }
    if (-not $w) { Check $false "A20: late push never arrived" }
    else {
        Check ($w.Entry.read -eq $false) "A20: message pushed AFTER mark-all-read is still unread (read=false)"
        Check ((UnreadCount $w.Msgs) -eq 1) "A20: unread count back to 1"
        $at3 = Dump-ActTop ("acttop-" + $Tag + "-late.txt")
        Check ($null -ne (Parse-StatusButton $at3)) "A20: mark-all-read button VISIBLE again with unread>0"
        $null = Shot ("qa-" + $Mode + "-late")
    }
}
if ($Mode -eq "inapp") {
    $nidq = $nids[$tQ]
    Check (-not (NotifPresent $dump1 $nidq)) "A24: unanswered QUESTION notif nid=$nidq cancelled by mark-all-read"
    $at3 = Dump-ActTop ("acttop-" + $Tag + "-opts.txt")
    $opt = Parse-FirstCardOption $at3
    if (-not $opt) { Check $false "A24: option button not found in first card (dumpsys activity top)" }
    else {
        Say "INFO" ("first option center=({0},{1}) size={2}x{3}" -f $opt.X, $opt.Y, $opt.W, $opt.H)
        $cap2 = Tap-And-Capture $opt.X $opt.Y ("qa-" + $Mode + "-opttap")
        $d = ReadUtf8 $cap2.Notif
        $w = Wait-Entry $tQ 30 { param($e) ($e.answered -ne $null -and $e.answered -ne '') }
        if (-not $w) { Check $false "A24: option tap produced no answered state" }
        else {
            Check ($w.Entry.answered -eq "__expired") "A24: option tap reached submit (answered=$($w.Entry.answered); __expired expected for a fake callId)"
            Check ($d -match [regex]::Escape($ExpiredToast)) "A24: expired-answer toast captured (answer echo channel alive after notif cancel)"
        }
    }
}

if ($Mode -eq "single") {
    Say "EYE" "read_image: $OutDir\qa-$Mode-before.png vs qa-$Mode-after.png - expect: MY card dimmed with its READ button gone (its notif cancelled per v1.32.10), OTHER unread cards KEEP blue dot + READ button, pill and unread-count line still visible"
} else {
    Say "EYE" "read_image: $OutDir\qa-$Mode-before.png vs qa-$Mode-after.png - expect: unread-count line gone, ALL cards dimmed (alpha 0.6), pill hidden, wallpaper intact"
}
Finish
