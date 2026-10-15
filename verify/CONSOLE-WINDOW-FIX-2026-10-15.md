# 桌面偶发 cmd 闪窗 —— 根因与修复记录

日期：2026-10-15　机器：`<win-host-a>`（MECHREVO Yaoshi16Pro，tailnet `<tailnet-laptop>`）

## 症状

笔电上偶尔弹出 cmd 窗口，输出几行数据后瞬间消失。

## 根因（已实测确认，非推测）

不是安卓模拟器本体。模拟器自身以 `-no-window` 无窗口模式运行，不会弹 cmd。

真凶是本机原有的"模拟器自愈"计划任务：

| 任务 | 触发器 | LogonType | Hidden | 结果 |
|---|---|---|---|---|
| `\emu-selfheal` | TimeTrigger **PT5M**（Duration P3650D＝永久）+ Boot + Logon | **Interactive** | False | 每 5 分钟在桌面会话(session 1)起一个**可见** cmd |
| `\emu-ladder-rung` | 无触发器，由自愈脚本按需拉起 | **Interactive** | False | 每次真正修复时再闪一个可见 cmd |

证据链：

1. **进程陷阱**抓到 15:46:50 同一秒的两个孪生启动：
   - `cmd /c "G:\Android\emu-selfheal.cmd" -SshdOnly` → **session 0**，不可见
   - `cmd /c "G:\Android\emu-selfheal.cmd"` → **session 1**（console=<user>），**可见**
2. **节奏吻合**：`emu-ladder.log` 里 1150 次 `emu-selfheal start`，相邻间隔直方图
   300s × 474、299s × 109，另有 0s × 431（孪生任务同秒启动）。
3. **内容吻合**：脚本第 84–85 行是 `Add-Content $LOG` **加** `Write-Host $line`，
   同一份日志既落盘也打到屏幕，一次约 7 行，与"输出几行然后消失"一致。

## 关键发现：`Settings.Hidden=$true` 对控制台窗口无效

这是本次最重要的一条硬事实，方案 A（只改 Hidden）**经实测证伪**：

对照实验（动作都在 session 1、都以 Interactive 注册）：

| 任务动作 | Hidden | 从进程内部 `IsWindowVisible(GetConsoleWindow())` |
|---|---|---|
| `powershell.exe -File canary.ps1` | True | **True —— 仍然可见** |
| `powershell.exe -File canary.ps1` | False | True |
| `powershell.exe -WindowStyle Hidden -File canary.ps1` | True | **False ✓** |
| `wscript.exe //B shim.vbs`（Run style 0，SW_HIDE） | True | **False ✓** |

窗口级验证器（`EnumWindows` 枚举 `ConsoleWindowClass`）进一步确认：
- 裸 `cmd.exe` 任务即使 `Hidden=True`，仍以 `kind=ONSREEN iconic=False rect=992x517@199,157`
  出现在桌面 → 会被用户看到
- 经 shim 启动的同一条命令 → 审计日志中**完全不出现**

结论：**`Settings.Hidden` 只在任务计划程序列表里隐藏，不给进程窗口设 `SW_HIDE`。**
真正管用的是**动作层**的隐藏。

## 修复（已应用并验收）

1. 新增 `G:\Android\hidden-run.vbs` —— `WScript.Shell.Run(cmd, 0, True)`，
   `0` = `SW_HIDE` 抑制控制台窗口，`True` = 等待子进程退出，从而**保持任务的原有生命周期**
   （rung 任务在模拟器运行期间仍为 Running，12h `ExecutionTimeLimit` 与
   `MultipleInstances=IgnoreNew` 的语义不变）。子进程仍在 **session 1**，qemu 照旧独占真实 GPU。
2. `\emu-selfheal` 与 `\emu-ladder-rung` 的**动作**改走 shim，并保留 `Hidden=True`：
   ```
   C:\Windows\System32\wscript.exe //B "G:\Android\hidden-run.vbs" "G:\Android\emu-selfheal.cmd"
   C:\Windows\System32\wscript.exe //B "G:\Android\hidden-run.vbs" "G:\Android\emu-ladder-rung.cmd"
   ```
   `LogonType=Interactive` / `RunLevel=Highest` / 触发器数量均未改动。
3. `G:\Android\emu-selfheal.ps1` 的 `Ensure-RungTask` 现在会在**每次 pass** 断言
   "动作是 shim **且** Hidden=True"，发现漂移就修回。原脚本若发现任务已存在就直接 `return`，
   导致漂移永不自愈。

### 修复过程中被测试抓出的两个自身缺陷（均已修）

1. **shim 首版盲目给每个参数加引号**，内层命令自带引号时变成嵌套引号垃圾，`cmd.exe` 根本没执行
   （`ShimMarker lastResult=1`，标记文件缺失）。改为**仅在参数含空格且未被引号包裹时**才加引号。
2. **修复最初只写在 `Start-Rung` 路径里**，而最常见的一轮是"已健康 → exit 0"，永远走不到那里。
   回归测试（故意把 rung 任务改回 `Hidden=False` + 裸 cmd，再跑一次健康路径 pass）暴露了它。
   现将断言移到 main 的第 2b 步，**每次必跑**。补丁后复测：T1 PASS。

## 验收（实测）

- **T1 回归**：故意破坏 rung 任务为 `Hidden=False`+裸 cmd → 跑一次"已健康"pass →
  恢复为 `Hidden=True`+shim，日志留痕 `fixed rung task emu-ladder-rung (action=True hidden=True)`。**PASS**
- **T2 现场**：真实 `\emu-selfheal` 任务执行（`emu-ladder.log` 增长）期间，
  窗口级审计中匹配 `emu-selfheal` 的可见控制台 = **0**。**PASS**
- **T3 正对照**：同一审计器对裸 `cmd.exe` 任务捕获到 6 次 `kind=ONSREEN` 命中
  → 证明探针不瞎，T2 的 0 是真阴性而非漏检。**PASS**
- 语法：`Parser::ParseFile` 通过；模拟器在本轮全程保持 `boot_completed=1` +
  `GLES: NVIDIA GeForce RTX 4060 Laptop GPU` 未被误伤。

## 未改动但值得知道的

- **桌面仍有一个常驻可见 cmd 窗口**：`pid 20780`（08:22:29 起），
  命令行 `cmd /c "G:\Android\emu-ladder-rung.cmd"`，是今早那次冷启动经**旧的可见路径**
  拉起的 rung 进程，模拟器不退出它就不关。它不是"闪窗"（是常驻窗口），
  但可以让用户看到同一个机制。要消掉需**重启该 rung**（会打断模拟器上的 QA 作业），
  故未擅自执行。该任务 `LastResult=267009`(0x41301)＝"正在运行"，与之一致。
- `\dsh-emu`、`\dsh-emu-sw` 仍是 `Interactive` + `Hidden=False` + 裸 `run-emu.cmd`；
  它们**无触发器**（上次运行 2026-10-13），只在被手工运行时才会闪。
- `vivo 手机助手 pcsuite.exe` 也确在 session 1 起 cmd/powershell
  （15:48:27 实测：`cmd /d /s /c "powershell -Command "Get-Process -Id 4736 | ..."`）。
  属于另一条独立线索，未处理。
- DSH 自身的四个 cmd 任务（`DshStuckWatch` 2m / `DshStateHeartbeat` 1m /
  `DshPeerWatch` 5m / `DshRestartResume`）与 `DshNetWebWatchdog` 都是 **S4U**
  （落 session 0）或有 `-WindowStyle Hidden`，**不会**在桌面闪窗。

## 复现/自检方法

- 窗口级审计器：`C:\Users\<user>\Desktop\test\console-audit.ps1`
  （必须以 Interactive 任务在 session 1 运行；session 0 的 agent 看不到用户桌面）
- 判据：日志里 `kind=ONSREEN iconic=False` 且命令行匹配目标脚本 = 用户真的会看到。
  `IsWindowVisible` 对最小化窗口也为 True，所以单看它会产生假阳性。
- 一分钟人工自测：弹窗时掐秒，去 `G:\Android\emu-ladder.log` 找 `emu-selfheal start`；
  落在 `xx:x1:50 / xx:x6:50` 这类 5 分钟栅格上就是 emu-selfheal。

## 备份

- `G:\Android\emu-selfheal.ps1.bak-hidden-20261015-155150`（改动前原件）
- 改动后 sha256：`26F2CFE123F140F0ADA463E41187C58A9C55EF5FD670317D28BA7916F34184EE`

---

## 7. 2026-10-15 后续：清掉遗留窗口 + 走新路径冷启动（实测 PASS）

用户确认模拟器闲置后，用 `emu-coldstart-real-gpu.ps1 -Kill` 走**新的隐藏路径**冷启动，
同时用窗口级审计器（`verify/console-audit.ps1`）全程盯窗。

**遗留窗口**：`pid 20780`（08:22:29 起，`cmd /c emu-ladder-rung.cmd`，session 1）
是今早**旧可见路径**拉起的 rung 进程；因为模拟器不退出它就不关，所以它是**常驻可见窗口**。
它让 rung 任务一直停在 `State=Running` / `LastResult=267009`(0x41301)。

**结果**：

| 检查 | 结果 |
|---|---|
| 冷启动 exit code | **0**（脚本自断言：`-gpu host` + 渲染器含 NVIDIA + `1440x3168@640`） |
| 渲染器 | `GLES: ... NVIDIA GeForce RTX 4060 Laptop GPU ...` |
| 几何 | `Physical size: 1440x3168` / `Physical density: 640` |
| 启动耗时 | rung 1 起 → `boot_completed=1` 用 **61s** |
| **新的进程树** | `wscript.exe(37400,s1) → cmd.exe(12588,s1) → emulator.exe(26840,s1) → qemu(33524,s1)` |
| 遗留的 `pid 20780` | **已消失**（被 `-Kill` 连带清掉） |
| 审计器命中（排除自身） | 共 **11 条，全部落在 16:04:27–16:04:31**，即 **`-Kill`(16:04:42) 之前**，全是那个老的 `pid 20780` |
| 16:04:42 之后的命中 | **0 条**（覆盖新模拟器完整生命周期，审计跑到 16:11:07 / 1277 采样） |

**⇒ 结论**：老窗口没了，新拉起的整条链路（wscript → cmd → emulator → qemu）**全程零可见控制台**。

### ⚠️ 本轮又踩到一个"判据侧"的坑（已沉淀）

驱动脚本最初把审计命中数**直接当失败**判据（`emuHit -eq 0` 才算 PASS），
于是打印 **`RESULT: CHECK`** —— 因为那 11 条命中确实存在，**但它们全在 kill 之前**，
是**待清理的遗留窗口**，不是新路径弹的。

**⇒ 教训（与 skill 里"工具假判史"同源）：审计/计数类判据必须带时间窗，并且要对着
"被测动作的起始时刻"切分。**"总命中数 > 0" 在"先清理旧状态、再验证新行为"的场景里
**必然为真** ⇒ 会把成功的清理误报成失败。**正确判据 = 动作时刻之后的命中数**。

## 8. 复现/回归命令

```powershell
# 1) 看当前有没有可见控制台（必须以 Interactive 任务在 session 1 跑）
#    探针：verify\console-audit.ps1（-Seconds N），产出 VISIBLE-CONSOLE 行
# 2) 冷启动（走新隐藏路径；-Kill 会清掉遗留 rung 进程与 AVD 锁）
powershell -NoProfile -ExecutionPolicy Bypass -File verify\emu-coldstart-real-gpu.ps1 -Kill
#    判据 = 打印 VERDICT: PASS - real GPU, booted, geometry asserted（exit 0）
# 3) T1 回归：把 rung 任务改回 Hidden=False + 裸 cmd，跑一次健康路径 pass，
#    期望日志出现 fixed rung task emu-ladder-rung (action=True hidden=True)
```

**注意**：`emu-coldstart-real-gpu.ps1` **依赖 `G:\Android\emu-selfheal.cmd`**，
且**不能在台式机跑**（`G:\Android` 只在笔电存在）。