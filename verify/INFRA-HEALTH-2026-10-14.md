# 基础设施巡检报告（2026-10-14，leader）

> **本轮范围**：用户拍板「先只做环境/基础设施巡检，不动功能」；巡检后**用户批准部署** F1–F3 加固版。
> **新增硬约束（用户原话）**：**「之后尽量别把模拟器用 CPU，用 CPU 会导致笔电风扇转速增加有很大噪音」**。
> **结论一句话**：三台机器的主链路都健康；但**模拟器当时正跑在 CPU 软渲染（swiftshader）上，直接违反新约束**，
> 根因是笔电自愈阶梯里一条**已被证伪的旧前提**。运行实例已当场切回真 GPU（渲染器级取证见 §3），
> **持久化修复（F1–F3）已于 19:02 部署到笔电并跑通生产模式验收（§9）**；部署途中还挖出并修掉一个
> **会让加固版误杀健康模拟器的死锁 bug**（§9.4）。

---

## 1. 本轮巡检动作与改动披露（先说自己动过什么）

| 动作 | 对象 | 性质 |
|---|---|---|
| 只读取证 | 三台机器（台式机 / vm1 / 笔电） | 无副作用 |
| **kill + 冷启模拟器** | 笔电 `qemu-system-x86_64-headless`(38016) / `emulator`(7644) → 新 pid 34436 / 36956 | **有副作用，属修复性**：把 swiftshader 实例重启为 `-gpu host` |
| 写选择器文件 | 笔电 `G:\Android\emu-ladder.gpu`：`swiftshader_indirect` → `host` | **有副作用**：让下一次阶梯重启也走真 GPU |
| 未做 | 未改任何 App 功能、未改 `verify/**` 逻辑、未改 `emu-selfheal.ps1`、未碰生产 DSH 配置 | — |

**为什么敢动**：模拟器是测试资产不是生产链路；用户新约束明确要求不用 CPU；且原实例是「健康但软渲染」，
自愈永远不会纠正它（见 §4 根因②）。**取证在重启前后各做了一次**，可对照。

---

## 2. 环境健康总览（全部实测，非推测）

| 机器 | 项 | 实测值 | 判定 |
|---|---|---|---|
| **台式机**<br>`<win-host-b>` | DSH Web 3081 | 在听，pid **1552** | ✅ |
| | 代理 3080 | 在听（`0.0.0.0`），pid **20728** | ✅ |
| | HTTP 探活 | 3080/3081 均返回 **401**（无 token）→ **属预期**，非故障 | ✅ |
| | 桌面 web token | `RWYq5xxzwD6yPae8nUVr2dYXR5bFm8KPRro8s_B4qjE`（取自 `web.log` 最后一条 `dsh web:`；**重启必换**） | ✅ |
| | 看门狗任务 | `DshNetWebWatchdog` `DshPeerWatch` `DshStuckWatch` `DshStateHeartbeat` `DshRestartResume` `Strata-Watchdog` **全部 rc=0x0**，下次触发时间正常 | ✅ |
| | 状态帧 | `C:\Users\<user>\.dsh\peer-state.json`（**不在 `F:\work\work_dsh`**），ts 与心跳任务同一时刻，`sessionCount=191`，`running` = 本会话 `session-11ed9272…` | ✅ |
| | `peer-state.name` | 存的是中文「台式机」，读出来乱码（无 BOM/编码差异）→ **只是显示问题，不影响判据** | ⚠️ 记录 |
| **vm1**<br>`user@<tailnet-vm1>` | `dsh-net.sh status` | **运行中**（3080 代理 → 3081 回环），三地址自检全可用 | ✅ |
| | node 前置 | `$HOME/.local/bin/node` = **v22.22.3**（带 TS stripping，符合 dsh 0.2.0-rc.2 要求） | ✅ |
| | 构建仓 | `/home/user/work/projects/dsh-push` 在 | ✅ |
| **笔电**<br>`user@<tailnet-laptop>` | SSH / sshd | 通，`StartType=Automatic` 且 Running | ✅ |
| | 宿主 GPU | **RTX 4060 Laptop**（8188 MiB）、驱动 **616.92**、巡检时利用率 51%、已用 2323 MiB | ✅ |
| | 客机 | `boot_completed=1`、`adb shell echo ok` 通、`adb devices` = `emulator-5554 device` | ✅ |
| | 分辨率/密度 | 截图实测 **1440x3168**（= CSS360 基线，与用户真机同构）；`wm size/density` 未见 override | ✅ |
| | **渲染模式** | **巡检开始时 = `-gpu swiftshader_indirect`（CPU）** → **已切为 `-gpu host`** | ❌→✅ |

---

## 3. 决定性证据：真 GPU 可用，且「无交互会话就不能用真 GPU」这个前提**已被证伪**

### 3.1 巡检开始时（违规态）

```
emulator.exe  :: ... -avd dsh-p16 -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -cores 4 -memory 4096
qemu-system-x86_64-headless.exe :: ... -gpu swiftshader_indirect -cores 4 -memory 4096
G:\Android\emu-ladder.gpu  ==  swiftshader_indirect
emu-ladder.log: interactive console session: False ... already healthy -> nothing to do（每 5 分钟重复）
```

### 3.2 旧前提（写在 `emu-selfheal.ps1` 注释里）

> "the real-GPU attempt can silently fail (**the `-gpu host` path needs an interactive session with a GPU context
> -- without one it dies with glTexImage2D 0x502** and adb never comes up)"

阶梯实现据此**跳过**真 GPU 档：

```powershell
if (-not $interactive) {
  Log 'no interactive session -> skipping the real-GPU rung (it cannot get a GPU context without one)'
} else { ... Start-Rung 'host' ... }
```

### 3.3 实际测量：真 GPU 在「console 已断开」状态下**照样起得来**

巡检时 `query session` 的 console 行状态是 **`已断开`**（disconnected），`query user` 登录时间停在 **2026/10/13 13:35**。
按旧前提，这种情况**应当**起不来。实测：

```
18:40:14  qemu 启动参数 = ... -gpu host -cores 4 -memory 4096
18:40:20  BOOT OK gpu=host
          boot_completed = 1
          guest uptime = 19.33s（全新实例）
```

**客机内部渲染器取证（这是权威判据，不是看命令行）**：

```
$ adb shell dumpsys SurfaceFlinger | grep ^GLES:
GLES: Google (NVIDIA Corporation), Android Emulator OpenGL ES Translator
      (NVIDIA GeForce RTX 4060 Laptop GPU/PCIe/SSE2), OpenGL ES 3.1 (4.5.0 NVIDIA 616.92)
```

→ 渲染器真的是 **宿主 NVIDIA RTX 4060**，不是 SwiftShader。
**结论：旧前提在当前驱动（616.92）与当前机器状态下不成立，阶梯因此把用户往 CPU 档上赶。**

> 注：`ro.hardware.egl = emulation`、`ro.hardware.vulkan = ranchu` 是**模拟器固定值**，**不能**用来判别宿主/软渲染；
> 唯一可信判据是 `dumpsys SurfaceFlinger` 的 `GLES:` 行（或 `Get-CimInstance Win32_Process` 看 qemu 的 `-gpu` 实参）。

---

## 4. 根因链（为什么「CPU 软渲染」会长期不被纠正）

**① 阶梯从不让真 GPU 档先试。** 只要 `InteractiveSession` 判为 false，直接走 rung 2 = `swiftshader_indirect`。
该判别函数只做正则 `(?m)^\s*console\s+\S+`，**不看状态列**（`已断开` 也会命中）——判据本身就不可靠：
同一台机器同一分钟，`emu-selfheal-svc`（S4U 上下文）记 `True`、`emu-selfheal`（另一上下文）记 `False`，
**同一正则两种结论**，说明它对调用上下文敏感，**不能作为"能不能用真 GPU"的依据**。

**② 「已健康」闸口不含渲染模式 → 软渲染实例永远不会被纠正。** 阶梯第 3 步：

```powershell
if (GuestHealthy) { Log 'already healthy ... -> nothing to do'; exit 0 }
```

`GuestHealthy` 只查 `boot_completed=1` + `adb shell echo ok`。**swiftshader 实例完全满足** →
阶梯每 5 分钟醒来、看一眼、又睡回去，**把违规态当健康态长期固化**（巡检日志里连续多轮如此）。

**③ 「试过一次真 GPU」的失败会被永久记住。** rung 2 失败后 `emu-ladder.gpu` 被写成 `swiftshader_indirect` 并留在磁盘；
选择器文件是**跨重启持久**的（巡检时读到的正是它）。
⇒ 任何一次历史性的误判，都会变成**之后每次启动默认走 CPU**。
**这与「用户不想听风扇」直接冲突，是本次最高优先级缺陷。**

**④ AVD `config.ini` 有重复键 + GPU 显式关闭（次生风险）。** 同一文件里 `hw.lcd.width` 出现两次
（`1080` 然后 `1440`）、`hw.lcd.height` 两次（`2400`/`3168`）、`hw.lcd.density` 两次（`420`/`640`），
另有 `hw.gpu.enabled = no` 与 `hw.gpu.mode = auto`。
现在靠命令行 `-gpu host` 压住，**一旦有人不带 `-gpu` 参数启动，落的档位就不确定**。
（分辨率现取到 1440x3168，说明后者生效；但重复键语义依赖实现，属**脆弱基线**。）

**⑤ 三个启动器并存，谁是权威不明确（实测残留）。** `dsh-emu`(→`run-emu.cmd`, `-gpu host`)、
`dsh-emu-sw`(→`run-emu-sw.cmd`, swiftshader)、`emu-ladder-rung`(→`emu-ladder-rung.cmd`, 读选择器文件)。
另有历史残留 `dsh-p16.avd\emu-launch-params.txt` 记着 `swiftshader_indirect`。
**多个可能被 `schtasks /Run` 的入口 = 有人（或某个脚本）跑错档位就回到 CPU。**

实测残留状态（切档后同一轮取样）：

| 任务 | state | last | rc | 解读 |
|---|---|---|---|---|
| `emu-ladder-rung` | **Running** | 18:40:13 | **0x41301** | `0x41301` = **任务正在运行**（非失败）。rung 任务直接持有 emulator 进程（`ExecutionTimeLimit=12h`）⇒ **它会一直「Running」到模拟器退出为止**，属设计如此；但**这也意味着「Running」不能当健康判据** |
| `dsh-emu` | Ready | 10/13 23:08:36 | 0x1 | 历史遗留失败，**当前无进程、不参与** |
| `dsh-emu-sw` | Ready | 10/13 22:24:59 | 0x1 | 同上，**但它是 CPU 档入口，仍可被误触发** |

另有**活着的包装进程**：`pid=37464 cmd.exe /c "G:\Android\emu-ladder-rung.cmd"` —— 即
`rung 任务 → cmd.exe → emulator.exe → qemu` 四层。**杀模拟器时若只杀 qemu，cmd 包装层可能残留**，
下次 `schtasks /Run` 叠一层；`MultipleInstances=IgnoreNew` 虽有保护，但**「僵尸包装层」正是历史 `emu-out.txt`
被锁的成因**（`run-emu.cmd` 那段注释记过）。**清理脚本必须杀整棵树（`taskkill /T`），不能只杀 qemu。**

---

## 5. 顺带量到的基线（可复用于下轮 QA）

| 指标 | 实测 | 说明 |
|---|---|---|
| 冷启到 `boot_completed=1` | **6s**（轮询粒度 6s，故为 ≤6s 量级） | AVD **开着 quickboot**（`fastboot.forceFastBoot = yes`）⇒ **这是快照引导，不是冷引导**，不可当冷启基线 |
| `screencap`+`pull`（**swiftshader**） | **2.41s**（n=1，切档前一次采样） | 见下方作废说明 |
| `screencap`+`pull`（**真 GPU**） | **2.13 / 1.88**（切档后即时） → **1.25 / 1.09 / 1.00s**（稳态 3 次） | 稳态明显快于软渲染，但**要求多次采样**；单次量会被预热污染 |
| 截图有效性 | PNG 签名正确、**1440x3168**、~2.0 MB | 可用于 CSS360 几何类验收（字节数随画面内容变，别当常量断言） |
| qemu 宿主开销（真 GPU） | `cpuSec≈129` / `ws≈4276 MB` / 134 线程；宿主总 CPU **9–25%**（24 逻辑核） | 这是**真 GPU 的常态水位** |
| `wm size / density` | **1440x3168 / 640**（物理值，无 override） | 与 CSS360 基线一致 ✅ |

⚠️ **作废提示（两条）**：
1. **6s 是快照引导（quickboot）**，**不能**替代「真 GPU 冷启 = 18s」那条旧基线；冷启基线仍需重打（见 §7）。
2. **我先前一度把截图耗时写成「与软渲染同档、不可作判据」——这是过早结论，现按数据修正**：
   软渲染样本只有 **1 个（2.41s）**，真 GPU 稳态是 **1.0–1.25s**，两者有约 2 倍差距。
   但**样本不对称**（软渲染 n=1 且夹在切档瞬间）、且单次量受预热影响 ⇒
   **截图耗时可以作为旁证，不能单独当判据**；权威判据仍是 §3.3 的 `dumpsys SurfaceFlinger` 渲染器行
   与 qemu 的 `-gpu` 实参。**我没有为了补软渲染基线而把模拟器切回 CPU**——那正是用户要避免的风扇噪音源，
   故此项配额**主动放弃**，标注为未测。

---

## 6. 建议修复（**本轮未执行，等用户点头**）

按性价比排序，全部属基础设施域、不碰 App 功能：

| # | 修复 | 为什么必须 |
|---|---|---|
| **F1** | **删掉「无交互会话就跳过真 GPU」这道岔路**：一律先试 `-gpu host`，失败再退软渲染 | 旧前提已被证伪（§3）；这是 CPU 档被选中的直接原因 |
| **F2** | **把渲染模式纳入「已健康」判据**：`GuestHealthy` 之外再查 qemu 实参的 `-gpu` 值，**非 `host` 即视为不健康并纠正** | 否则 F1 也只治新启实例，存量软渲染实例仍被固化（根因②） |
| **F3** | **软渲染只允许是「本轮降级」，不允许成为持久默认**：降级时写标记并告警（ntfy），下次自愈**优先重试 host** | 消除根因③「一次误判永久走 CPU」 |
| **F4** | 修 `emu-ladder.gpu` 当前值残留与 `emu-launch-params.txt` 历史残留；明确**唯一权威启动器** = `emu-ladder-rung` | 消除根因⑤，避免跑错入口 |
| **F5** | 修 AVD `config.ini` 重复键；如需兜底则显式 `hw.gpu.enabled = yes` / `hw.gpu.mode = host` | 消除根因④的脆弱基线（**改 config.ini 后必须冷重启，配方见 skill**） |
| **F6** | 在阶梯里加**可判据的验收输出**（渲染器行 / `-gpu` 实参），写进 `emu-ladder.log` | 让「有没有偷偷用 CPU」一眼可查，而不是靠翻进程命令行 |

**共同红线**：F1–F3 改的是笔电 `G:\Android\emu-selfheal.ps1`（**不在本仓**，无版本管理）→
动前**必须先备份**、改后**必须用 `-BreakHostRung` 测试钩子验证降级路径仍能兜底**，
且**必须确认软渲染兜底依然可用**（否则笔电无人值守时会没模拟器，比风扇噪音更糟）。
建议把最终脚本**纳入本仓 `verify/` 存档**，别再让基础设施脚本只活在笔电上。

---

## 7. 未决 / 待下轮确认

1. **F1–F3 未执行**——持久化修复待用户授权（本轮限定「只巡检」）。
2. **`-gpu host` 的耐久性待观察**：我已把 `emu-ladder.gpu` 写为 `host`，
   但**下一次触发降级的条件仍未被移除**（根因①③仍在）。建议下轮开工先复核：
   ```powershell
   ssh user@<tailnet-laptop> powershell -NoProfile -Command "Get-CimInstance Win32_Process | ? {$_.CommandLine -match 'qemu'} | % {$_.CommandLine}"
   ```
   出现 `swiftshader` 即表示又被打回 CPU。
3. **真 GPU 下「冷启」耗时基线仍未重打**（本次 6s 是快照引导，不可用）。
4. **既有 6 项跨轮未决**照旧（见 `HANDOVER.md` §4）：host-plugin P02–P06 未跑、CSS360 几何基线未重打、
   `claimForeground` 产品取舍、QA 报告 §6 未覆盖面、DSH 上游两条补丁。
5. **`emu-selfheal` 的会话判别函数本身不可信**（同机同时刻两种结论）→ 即便修好 GPU 逻辑，
   这个函数也**不该再承担任何决策作用**，建议仅保留为日志信息。

---

## 8. 本轮新增的可复用闸门：`emu-gpu-verdict.ps1`

巡检的判据原先只活在一次性的命令行里（`dumpsys` + `Get-CimInstance` 手敲），下轮又会重新摸索。
按交接纪律「能一条命令验的就把命令写上」，已固化为脚本：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File verify\emu-gpu-verdict.ps1
```

| 退出码 | 含义 | 处置 |
|---|---|---|
| **0** | **PASS** = 真 GPU（客机渲染器含 `NVIDIA`） | 无需动作 |
| **3** | **SOFTWARE** = CPU 软渲染在跑（**违反用户约束**） | 按 §6 F1 重启到 `-gpu host` |
| **4** | **BLOCKED** = 判不了（ssh 不通 / adb 无响应 / 渲染器行缺失 / 客机没起） | 查模拟器与 adb，**不代表健康** |
| 2 | ENV = 参数问题（本侧） | 检查 `-EmuHost` |

**判据设计（两条封死，防止假 PASS）**：
1. **正向判 PASS 需要**渲染器行含 `NVIDIA`；
2. **负向判 SOFTWARE 只要任一成立**：渲染器含 `SwiftShader` / `Google (Google)`，**或** qemu 实参是
   `swiftshader_indirect` / `swiftshader`。
   ⇒ 即使渲染器字符串被驱动改写得不典型，**qemu 实参也能兜底**（`-gpu sw` 那条用例已验证）；
3. **判不了就报 BLOCKED，绝不默认 PASS**。

**顺带闸门（防"下次回退"）**：实例当前是真 GPU、但持久化选择器 `emu-ladder.gpu` 仍写着 `swiftshader`
→ 脚本会额外告警「**下次启动会回退到 CPU**」。这正是 §4 根因③的运行时哨兵。

**验收记录（2026-10-14 实测）**：

| 路径 | 结果 |
|---|---|
| `-SelfTest`（6 条合成用例，**不联网不碰笔电**） | **PASS 6/6**：真GPU干净选择器=0/0；真GPU+选择器会回退=0/**2 条警告**；swiftshader 渲染器=**3**；宿主渲染器但 `-gpu sw`（qemu 实参胜出）=**3**；无进程未启动=**4**；渲染器行缺失=**4** |
| 实跑（真 GPU 现场） | **exit 0 / PASS**，渲染器 = `NVIDIA GeForce RTX 4060 Laptop GPU`，`-gpu host`，`1440x3168@640` |
| 负路径（故意给不存在的主机 `user@10.255.255.1`） | **exit 4 / BLOCKED**，如实报 `ssh FAILED (rc=255)` |

> **为什么用 `-SelfTest` 而不是"把模拟器切回 CPU 试一次"**：切回 CPU 正是用户要避免的风扇噪音源，
> **不能为了测试去制造违规态**。合成输入 + 一条真实负路径（不通的主机）已能证明分类器与
> "判不了不报 PASS"的性质，**且全程零副作用**。
>（这条纪律值得记住：**验证闸门本身不该以制造被禁止的状态为代价**。）

---

## 9. F1–F3 加固版：**已部署到笔电（2026-10-14 19:02）**

§6 只说"应该怎么修"，那还是纸面建议。已把它做成**可直接替换笔电 `G:\Android\emu-selfheal.ps1` 的成品**：
[laptop-emu-selfheal.hardened.ps1](F:\work\work_dsh\dsh-push\verify\laptop-emu-selfheal.hardened.ps1)。

| 项 | 值 |
|---|---|
| 笔电现网脚本哈希 | **`21C1856BB181476C882D05A4981F6CAA84BFDEADF6B155045A49BA1FE0358C3D`**（= 本仓加固版，逐字节一致） |
| 部署前旧脚本哈希 | `BE99A7F9A75275CDBD8C300C1A1CA7D7F047F6939BEC652D63FBAABD9ABB0D55`（13,603 B，mtime 2026-10-13 14:09:32） |
| 备份路径 | `G:\Android\emu-selfheal.ps1.bak-f13`（哈希 = 旧脚本，**已验证与现网一致**） |
| 回滚 | `Copy-Item G:\Android\emu-selfheal.ps1.bak-f13 G:\Android\emu-selfheal.ps1 -Force`（**不需重启任何 DSH 服务**） |
| 作业手册 | [RUNBOOK-emu-selfheal-hardening.md](F:\work\work_dsh\dsh-push\verify\RUNBOOK-emu-selfheal-hardening.md) |

### 9.1 改了什么（只动三处，其余阶梯逻辑原样保留）

| 缺陷 | 加固做法 |
|---|---|
| **F1** 旧脚本按"无交互会话 ⇒ 真 GPU 会挂"**跳过 rung 1** | **rung 1（`-gpu host`）改为无条件先试**。会话检查降级为**纯日志信息**，明确标注 `INFORMATIONAL ONLY - no longer gates the GPU ladder`，不再参与任何决策 |
| **F2** "已健康"只查 `boot_completed`+`echo ok`，软渲染实例永远合格 | 健康判据**加入渲染器行**：`IsHostGpuRenderer()` 只有含 `NVIDIA` 才算真 GPU；**判定不通过 = `VIOLATION`，主动 kill 并重起 rung 1**。渲染器读不到时**fail closed**（当非真 GPU 处理），绝不默认放行 |
| **F3** 软渲染降级后，选择器文件永久留 `swiftshader` ⇒ 每次启动都回 CPU | 软渲染**只作本次启动的临时救援**；救援成功即打 **`REGRESSION`** 标记，并**把选择器重写回 `host`**，让下次启动重试真 GPU |

保留未动：sshd 保活、僵尸探测、`taskkill /F /T` 整树、AVD 锁清理、唯一那条 "needs a REBOOT" ntfy。

### 9.2 怎么证明它对（**零副作用**，不制造被禁止的状态）

加固版新增三个**测试专用**开关：

| 开关 | 用途 |
|---|---|
| `-DryRun` | 只决策与写日志，**不 kill / 不启动 / 不写文件**；日志另落 `emu-selfheal-dryrun.log`，真阶梯日志保持干净可外部核验 |
| `-TestRendererOverride <字符串>` | 替换"探测到的渲染器行"，使真 GPU / 软渲染 / 无法识别**三条分支都可达**，而**不必真把机器降级到 CPU** |
| `-ForceLadder` + `-DryRunLadderOutcome host-ok\|sw-ok` | 注入阶梯结果，使**降级分支真正可达**（否则健康机器会在"已健康"闸口提前退出，降级分支根本走不到） |

> **为什么必须这样设计**：本轮的验收对象是"别用 CPU"，而**验证闸门不该以制造被禁止的状态为代价**。
> 所以**没有**为了拿软渲染对照样本把模拟器切回 CPU。
> 另外两个测试钩子**带自锁**：不带 `-DryRun` 时使用 `-ForceLadder`/`-DryRunLadderOutcome` 会**直接 exit 2 拒绝执行**，
> 防止测试开关被误用于生产。

**干跑证明结果（2026-10-14 18:49，笔电实跑）**：

| 场景 | 期望 | 实测 |
|---|---|---|
| S1 真 GPU 健康（NVIDIA 渲染器） | 放行 | ✅ `already healthy ON THE REAL GPU -> nothing to do` |
| S2 健康但软渲染（SwiftShader 渲染器） | 判违规并纠正 | ✅ `VIOLATION ... correcting: kill + relaunch rung 1` |
| S3 渲染器无法识别 | **fail closed** | ✅ 同样判 `VIOLATION`（**没有**静默放行） |
| S4 **rung 1 故意失败 → 软渲染救援** | 救援可达 + 选择器还原 | ✅ `REGRESSION` 标记 + `would rewrite emu-ladder.gpu back to "host"` |
| S5 rung 1 成功 | 正常路 | ✅ `host-GPU ladder OK (real GPU confirmed by renderer)` |
| S6 安全闸：测试钩子不带 `-DryRun` | 拒绝 | ✅ `exit 2` 拒绝执行 |

**`FINAL: PASS - 6/6 scenarios correct, machine mutated: NO`**，且前后快照逐项相等：
qemu pid 不变（34436）、选择器哈希**与 mtime 都不变**、真阶梯日志行数不变（3570）、渲染器仍是 RTX 4060。

### 9.3 实际部署记录（2026-10-14 18:5x–19:0x，**已完成**）

按 [RUNBOOK](F:\work\work_dsh\dsh-push\verify\RUNBOOK-emu-selfheal-hardening.md) 五步执行，逐步留证：

| 步 | 动作 | 结果 |
|---|---|---|
| 0 | 成品 vs `HEAD` 逐字节比对（`cmd /c git cat-file blob` 取字节） | **MATCH**（`B4DAB660…`） |
| 1 | 备份现网脚本并证明备份一致 | `identical=True`，13,603 B |
| 2 | 下发加固版到暂存路径 | 暂存哈希 = repo = `B4DAB660…` |
| 3 | **真机 `-DryRun` 复核（无测试钩子）** | ❌ **首跑失败 → 挖出真 bug（见 §9.4）** |
| 3b | 修 bug 后重验 | ✅ `-SelfTest` PASS + 实时渲染器探测 0.06s 读到 RTX 4060 |
| 4 | 复验降级分支（dry-run） | ✅ `rung1 先试` → `rung 2 软渲染救援` → `REGRESSION` + `would rewrite selector back to "host"`；测试钩子安全闸 `exit 2` |
| 4b | 覆盖现网脚本 | `21C1856B…`（备份 `BE99A7F9…` 完好） |
| 5 | **生产模式**（真跑 `schtasks /Run /TN emu-selfheal`） | ✅ `LastTaskResult=0`，见下方日志 |

**步骤 5 生产模式实测日志（脚本第一次以生产身份自愈）**：

```
2026-10-14 19:02:06 === emu-selfheal start (SshdOnly=False DryRun=False) ===
2026-10-14 19:02:06 sshd: already Running (StartType=Automatic)
2026-10-14 19:02:06 interactive console session: False (INFORMATIONAL ONLY - no longer gates the GPU ladder)
2026-10-14 19:02:06 emulator process present: emulator:36956,qemu-system-x86_64-headless:34436
2026-10-14 19:02:06 renderer: GLES: Google (NVIDIA Corporation), ... (NVIDIA GeForce RTX 4060 Laptop GPU/PCIe/SSE2), ... 4.5.0 NVIDIA 616.92)
2026-10-14 19:02:06 already healthy ON THE REAL GPU (boot_completed=1) -> nothing to do
2026-10-14 19:02:06 === emu-selfheal end ===
```

**这张日志同时是 F1 的现场铁证**：`interactive console session: False`（正是旧脚本据此**跳过真 GPU** 的条件），
而新脚本照常读出渲染器并判定"真 GPU 健康"——**旧的保护逻辑确实是多余的**，且会造成 CPU 稳态。

**生产模式验收断言表（全部通过）**：

| 断言 | 实测 |
|---|---|
| 计划任务真跑了（日志增长） | ✅ 新增 7 行 |
| `LastTaskResult` | ✅ `0` |
| 日志出现渲染器行（F2 生效） | ✅ 含 `renderer: GLES: ... NVIDIA` |
| 判定真实 GPU | ✅ `already healthy ON THE REAL GPU` |
| 生产窗口**无** `VIOLATION` | ✅ 无 |
| 会话行标注 `INFORMATIONAL ONLY` | ✅ |
| 选择器哈希不变 / mtime 不变 | ✅ `35744E19…` 前后一致 |
| qemu 未被无谓重启 | ✅ pid `34436` 前后一致 |
| 任务回到 `Ready` | ✅ |

---

### 9.4 首跑失败的根因：`Run-Timeout` 死锁（**本轮最有价值的发现**）

**现象**：步骤 3 首跑真机 dry-run 时，脚本在 `18:57:40` 起，**卡 45 秒**到 `18:58:25` 才输出：

```
renderer: (COULD NOT READ)
WARNING: renderer line unreadable -> failing CLOSED (treated as NOT host GPU)
VIOLATION: guest is healthy but NOT rendering on the host GPU (CPU software rendering active)
  -> correcting: kill the instance and relaunch rung 1 (-gpu host)
```

**危害评估（必须说清）**：如果这是生产运行，加固版会**每 5 分钟杀掉一台健康的真 GPU 模拟器**。
也就是说——**这个"更安全"的修复，首版自身会造成比原缺陷更严重的故障**（模拟器反复重启/不可用）。
`fail closed` 的设计本身是对的（读不到就不能假定安全），**错的是"读不到"本身是个 bug**。

**根因（.NET `Process` 经典死锁）**：`Run-Timeout` 先 `WaitForExit()`、后 `ReadToEnd()`。
子进程写满 OS 管道缓冲（~4–64 KB）后阻塞在 `write()`，父进程阻塞在 `WaitForExit()` ⇒ **互等**。
`dumpsys SurfaceFlinger` 输出 **46,254 字符**，正好触发。**已在笔电复现**：

```
WaitForExit(20s) returned : False  after 20.01s
DEADLOCK REPRODUCED: child blocked writing stdout because we had not drained the pipe yet.
```

**修复（两处，双重保险）**：
1. `Run-Timeout` 在 `Start()` 后**立即异步排空** `ReadToEndAsync()`，再 `WaitForExit`；超时仍 kill 整树并返回已读部分；
2. `RendererLine` 主路径改为**设备侧过滤** `dumpsys SurfaceFlinger | grep GLES:`（输出仅几十字节，**结构上不可能死锁**），
   整段 dump 解析降为后备路径。
   > 细节坑：**不能用 `grep -m1`**——提前退出会让 dumpsys 收到 SIGPIPE 并打印
   > `Failed to write while dumping service SurfaceFlinger: Broken pipe` 噪声（实测）。

**修复后实测**：`-SelfTest` 的 B 段（**实时**渲染器探测）**0.06s** 读到 `NVIDIA GeForce RTX 4060`；生产模式生效。

### 9.5 新增永久回归：`-SelfTest`

首跑之所以让 bug 溜到**真机步骤**，是因为干跑证明用 `-TestRendererOverride` **绕过了真实探测**，
即"注入的渲染器"永远正确、**真实读取路径从未被验证**。已补上：

```
powershell -File emu-selfheal.hardened.ps1 -SelfTest      # 只读，不 kill/不启动/不写
```
- **A 段**：分类器 5 条合成用例（NVIDIA / SwiftShader / `Google (Google)` / 空串 / 未知厂商）；
- **B 段**：**实时渲染器探测**（走真实 adb 路径），断言返回非空并判为真 GPU ⇒ **正是本轮漏掉的那条路径**。

### 9.6 本轮第二处工具缺陷：假 FAIL 与假 PASS 各一次（**判据不可全信**）

| 缺陷 | 现场 | 教训 |
|---|---|---|
| **假 PASS** | 我最初的步骤 3 网关脚本只检查 `exit=0 + 机器未被改动`，**没有断言正向标记**，于是"读不到渲染器→VIOLATION"竟被判 `STEP 3: PASS` | **否定式断言不能当通过判据**；必须断言**正向证据**（`already healthy ON THE REAL GPU`） |
| **假 FAIL** | 步骤 4–5 我把 **2 万余字符**的脚本塞进 `ssh ... -EncodedCommand`，超过远端命令行上限（~8191）⇒ **整段没执行**、所有 KV 为空，空值又被"无变化=通过"的比较判成 17/23 FAIL | **长远端脚本一律走 `scp` + `powershell -File`，绝不过 ssh 命令行**；且**空值必须判为"没跑"（BLOCKED），不能当"通过"** |

修法：步骤 4–5 改为 `scp` 下发 `remote-step4-5.ps1` 再 `-File` 执行，随即真实跑通（§9.3 步骤 5）。

> **残留风险（如实说明）**：本次已确认「生产模式下脚本能正确识别真 GPU 且不乱动」；
> 但**「真出现软渲染实例时，脚本 kill+重启确实能把它拉回 GPU」仍未在真机验证**——
> 因为那需要**主动制造被用户禁止的状态**（切到 swiftshader 再观察自愈），**需用户明确同意**才可做。
> 目前该路径只有干跑（注入）证明。

---

## 9.7 ✅ 真机验证：软渲染实例被自愈 kill+重启**拉回真 GPU**（2026-10-14 20:00，用户批准）

**这是本轮最后一个未验证路径**（此前只有干跑/注入证明）。用户 2026-10-14 明确批准（"可以做验证"）。
**由 lead 执行**（`verify/TESTER.md` 明令 tester 不得自己切 GPU 模式/冷启笔电）。

### 9.7.1 结论

> **FIXED（exit 0）**：真的做出一个 **SwiftShader（CPU 软渲染）** 实例后，
> 生产模式自愈（`schtasks /Run /TN emu-selfheal`，**无参数**）在 **37s 内**自动完成
> `检出 VIOLATION → kill 整树 → 清 AVD 锁 → rung 1 -gpu host → 拉回真 GPU`，
> 并把持久选择器写回 `host`；任务 `LastTaskResult = 0x0`。
> **全程无需人工干预** —— 这正是"用户禁止的稳态"现在能自愈的关键证据。

### 9.7.2 时间线与判据（承重判据 = 客机 `dumpsys SurfaceFlinger` 的 `^GLES:` 行）

| 时刻 | 事件 | 权威判据（渲染器行 / 实参） |
|---|---|---|
| 19:59:54 | **前态快照** | pid `34436`、`-gpu host`、渲染器 = **NVIDIA RTX 4060**、选择器 `host`、日志 3728 行 |
| 19:59:54 | **故意降级**：kill 整树 → 选择器写 `swiftshader_indirect` → 起 rung | 选择器 `swiftshader_indirect` |
| 20:00:25 (+31s) | 软渲染实例就绪 | 渲染器 = **`Google (Google Inc.) ... Google SwiftShader, OpenGL ES 3.0 (SwiftShader 4.0.0.1)`**；`-gpu swiftshader_indirect`；pid `28596` |
| 20:00:41 | **触发生产自愈**（无参数） | 日志窗口偏移 3728 |
| 20:00:42 | 自愈读出渲染器 → **判 VIOLATION** | 日志原文见下 |
| 20:00:42 | kill 整树 | `killing emulator tree, pids 40744,28596` |
| 20:00:54 | 清 AVD 锁（两把）→ **rung 1 无条件先试** | `rung 1: real GPU (-gpu host) -- attempted unconditionally` |
| 20:01:20 (+24s) | 客机起来且**渲染器确认 NVIDIA** | `[host-gpu] renderer: ... NVIDIA GeForce RTX 4060 ...`；`RESULT: host-GPU ladder OK in 24s (real GPU confirmed by renderer)` |
| 20:02+ | **任务收尾** | `State=Ready`、**`LastTaskResult=0x0`**、选择器 `host`、`-gpu host`、pid `36308`、`boot_completed=1` |

**自愈日志原文（本窗口，13 行）**：
```
2026-10-14 20:00:41 === emu-selfheal start (SshdOnly=False DryRun=False) ===
2026-10-14 20:00:41 sshd: already Running (StartType=Automatic)
2026-10-14 20:00:41 interactive console session: False (INFORMATIONAL ONLY - no longer gates the GPU ladder)
2026-10-14 20:00:41 emulator process present: emulator:40744,qemu-system-x86_64-headless:28596
2026-10-14 20:00:42 renderer: GLES: Google (Google Inc.), Android Emulator OpenGL ES Translator (Google SwiftShader), OpenGL ES 3.0 (OpenGL ES 3.0 SwiftShader 4.0.0.1)
2026-10-14 20:00:42 VIOLATION: guest is healthy but NOT rendering on the host GPU (CPU software rendering active)
2026-10-14 20:00:42   -> correcting: kill the instance and relaunch rung 1 (-gpu host)
2026-10-14 20:00:42   killing emulator tree, pids 40744,28596
2026-10-14 20:00:54   cleared AVD lock: C:\Users\<user>\.android\avd\dsh-p16.avd\hardware-qemu.ini.lock
2026-10-14 20:00:54   cleared AVD lock: C:\Users\<user>\.android\avd\dsh-p16.avd\multiinstance.lock
2026-10-14 20:00:54 rung 1: real GPU (-gpu host) -- attempted unconditionally (the old "no interactive session" skip was based on a falsified premise)
2026-10-14 20:00:54   rung 1-host-gpu -> gpu=host via task emu-ladder-rung
2026-10-14 20:00:55     schtasks /Run /TN emu-ladder-rung -> rc=0
2026-10-14 20:01:20   [host-gpu] boot_completed=1 and shell responsive after 24s
2026-10-14 20:01:20   [host-gpu] renderer: GLES: Google (NVIDIA Corporation), Android Emulator OpenGL ES Translator (NVIDIA GeForce RTX 4060 Laptop GPU/PCIe/SSE2), OpenGL ES 3.1 (4.5.0 NVIDIA 616.92)
2026-10-14 20:01:20 RESULT: host-GPU ladder OK in 24s (real GPU confirmed by renderer)
2026-10-14 20:01:20 === emu-selfheal end ===
```

**这张日志同时把 F1/F2/F3 三条修复全部钉死为实测**：
- **F1**：`interactive console session: False` 却仍 `rung 1 ... attempted unconditionally` ⇒ 旧的假前提岔路确实已被移除；
- **F2**：`VIOLATION → correcting → kill` ⇒ 渲染器判据真的在决策（而非只写日志）；且**未**误判健康实例（切换前后两轮 `already healthy ON THE REAL GPU`）；
- **F3**：选择器被写回 `host`（复核值 `host`）⇒ 软渲染没有变成持久默认。

### 9.7.3 两条必须如实说明的细节

1. **一个"看起来像失败"的中间读数**：步骤 2 刚跑完时立刻读任务状态得到 `State=Running`、`LastTaskResult=267009`（`0x41301` = **任务正在运行**，不是失败）。**等任务收尾后复读为 `Ready` / `0x0`**。
   ⇒ 纪律：**读 Windows 计划任务结果必须等它离开 `Running`**，否则 `0x41301` 会被误读成错误码。
2. **CPU 软渲染窗口 ≈ 23s**（20:00:19 起 → 20:00:42 检出），全程 **~86s**（19:59:54 降级 → 20:01:20 真 GPU 确认）。
   已按承诺把用户禁止的稳态**压到最短**，且验证本身即证明"该状态不再需要人工脱离"。

### 9.7.4 复位与设备末态（复核通过）

| 项 | 值 |
|---|---|
| 选择器 | **`host`**（已还原） |
| qemu 实参 / 渲染器 | `-gpu host` / **NVIDIA RTX 4060** |
| `boot_completed` / pid | `1` / `36308`（全新实例） |
| `adb forward --list` | **空** |
| `pidof xyz.cpyh.dshpush` | **空**（已 force-stop） |
| 自愈任务 | `State=Ready`、**`LastTaskResult=0x0`** |

### 9.7.5 🔎 附带实测：自愈重启模拟器**真的会把 adbd 打回非 root**（H-1 的触发条件当场复现）

验证收尾时读到 **`whoami = shell`**（非 root）——而验证**开始前**是 `root`（tester 的 task-4 特意复原为 root）。
中间只发生了一件事：**自愈 kill 掉旧模拟器并重起了新实例**。

⇒ 这**实测坐实了 H-1 的因果链**（此前只有 tester 的 `adb unroot` 人工复现）：
```
自愈重启模拟器  ->  adbd 掉回非 root (whoami=shell)
                ->  am start .WebActivity 会被拒 (SecurityException, Activity 未导出)
                ->  若 QA 脚本没有 requireRoot() 前置 => 整轮起页 BLOCKED
```
**这正是 task-4 修 H-1 的必要性证据，而且触发路径是"自动发生"的**（不需要任何人工 `adb unroot`）：
只要自愈因 CPU 软渲染纠正过一次（如本节验证本身），下一次 QA 轮就会撞上非 root。
⇒ **`requireRoot()` 不是保险条款，是必需的**；这与 §4.6.1 的"顺序铁律是承重的"构成同一条结论的两半。

> 纪律：**模拟器被自愈重启后，不要假定 adbd 仍是 root**。判据 `adb shell whoami`；QA 脚本已自带断言。

### 9.7.6 复位与设备末态（清理后复核）

| 项 | 值 | 判定 |
|---|---|---|
| 验证脚本残留 | `cleanup.validationScriptGone=True` | ✅ 已清 |
| 加固版本体 / 备份 | `21C1856B…` / `BE99A7F9…` | ✅ 两者都在（deliverables 未损） |
| 选择器 | **`host`** | ✅ 已还原 |
| qemu | `-gpu host`、pid `36308`、渲染器 **NVIDIA RTX 4060**、`boot_completed=1` | ✅ 真 GPU |
| 几何 | `1440x3168` / density `640`，无 override | ✅ CSS360 契约 |
| 设备 | `adb forward --list` **空**、`pidof` **空**、`font_scale=1.0`、`airplane=0` | ✅ 干净 |
| 自愈任务 | `State=Ready`、`LastTaskResult=0`、最近窗口 `VIOLATION=False`（`already healthy ON THE REAL GPU`） | ✅ 稳定 |

**验证脚本**：`F:\work\work_dsh\tmp\t5-swiftshader-correction.ps1`（纯 ASCII、语法通过；`scp` + `-File` 下发，未用 `-EncodedCommand`）。

---

## 10. 一句话交接

> 三台机器健康、看门狗全绿、模拟器跑在真 GPU 上（SurfaceFlinger 渲染器取证 + 一条命令闸门可复核）。
> **「CPU 软渲染」的稳态隐患已从根上修掉并部署**：笔电 `emu-selfheal.ps1` = 加固版 `21C1856B…`
> （F1 rung 1 无条件先试／F2 渲染器纳入健康判据／F3 软渲染不得成为持久默认），备份 `*.bak-f13` 可回滚。
> **部署途中挖出并修掉一个更严重的 bug**：`Run-Timeout` 先 `WaitForExit` 后 `ReadToEnd` 导致
> 大输出（`dumpsys` 46 KB）**死锁**，会让加固版每 5 分钟误杀健康的真 GPU 模拟器——已用异步排空 +
> 设备侧 `grep` 双保险修掉，并补了**实时探测**的 `-SelfTest` 永久回归。
> **唯一未验证路径**：~~真出现软渲染实例时「kill+重启能拉回 GPU」只在干跑（注入）下证明过~~
> → **2026-10-14 20:00 已真机验证 FIXED，见 §9.7**（用户批准；SwiftShader 实例被自愈 37s 内拉回真 GPU，
> `LastTaskResult=0x0`，选择器还原 `host`）。**至此"CPU 软渲染"这条链的判据全部实测闭环。**
> 复核现状一条命令：`verify\emu-gpu-verdict.ps1`（exit 0 = 真 GPU；3 = 又被打回 CPU）。
