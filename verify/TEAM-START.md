# dsh-push 新对话快速启动（3 人团队）

> 目的：新开一个对话就能以 **leader / developer / tester** 三角色进入"实现 → 改动验证轮 → 发布"的节奏，不用重新摸环境。
> 仓库：`F:\work\work_dsh\dsh-push`（git）。所有 verify 脚本、QA 报告、STATUS 都在 `verify/`。

---

## 0. 环境速查（**已验证事实**）

| 项 | 值 |
|---|---|
| 编排机 | 台式机 `<win-host-b>`（DSH Web `127.0.0.1:3080`；对外 Tailscale `<tailnet-windows>:3080`） |
| 构建机 | 测试机1 vm1 `user@<tailnet-vm1>`（**台式机没有 JDK/Android SDK，本地跑不了 gradlew**；`dsh-app-verify.ps1` 的 build-vm1 步骤在这台 gradle 构建：JDK17 在 PATH、SDK 在 `/home/user/android-sdk` 需显式给、仓在 `/home/user/work/projects/dsh-push`，流水线每次 scp 覆盖 src，构建产物回传） |
| 模拟器机 | 家里笔电 `<win-host-a>`（Tailscale **`<tailnet-laptop>`**，**不要用 LAN IP**：会漂且被防火墙拦新连接） |
| AVD | **`dsh-p16`** 常驻笔电；adb 在笔电 `G:\Android\Sdk\platform-tools\adb.exe` |
| 桌面 web token | **每次 DSH 重启必换**（今天死了两次都换了）→ 脚本一律从 `C:\Users\<user>\.dsh\web.log` 取**最后一条** `dsh web:` 行里的 `token=`，并把 `127.0.0.1:3081` 替换为 `<tailnet-windows>:3080` |
| ntfy | 生产 topic `dsh`；**QA 一律用 `qa-` 前缀的正文标记**，正文里放 epoch 唯一串做断言定位；生产卡片靠 `#ans` 自清 |
| 判卷/看门狗 | 两侧 `askStaleSec` 保持 **999999**（不恢复判卷代答）；`gpu-mode.cmd local` 现在后台预热专家缓存、真实请求一到就让路 |

### 0.1 模拟器：**CSS360 基线（2026-10-13 晚起生效）**
- AVD `dsh-p16` 已与用户真机同构：**分辨率由 AVD 物理配置 `config.ini` 保证**（`hw.lcd.width=1440` / `hw.lcd.height=3168` / `hw.lcd.density=640`，备份 `config.ini.bak-1440`），CDP 实测 **`innerWidth=360` / `dpr=4`**，与用户真机（最小宽度 360dp）逐像素同构。
  - ⚠ **`wm size/density` 动态 override 会丢**（实测只剩 density 640 → `innerWidth=270`），**不再当持久化手段**；`wm size reset`/`wm density reset` 后物理配置就是正解。改分辨率必须走 config.ini + **冷重启**（动态改还会挂死 `screencap`）。
  - ✅ **config.ini 重复键已修（F4，2026-10-14 20:35）**：修复前同一组键出现**两次**（出厂 `1080x2400@420` 在 L83/85/88 + 我们的 `1440x3168@640` 在 L141-143），**纯靠"后者胜"的顺序生效**——emulator 自己就会在某些 boot 重写该文件，一旦合并掉重复键就**静默回退到 1080x2400@420、整套 CSS360 基线作废**（症状是"截图看着怪"而非报错）。同时 `hw.gpu.enabled` 由 `no` 改为 `yes`（此前真 GPU 只靠命令行 `-gpu host` 兜着）。
    修法与证据：`verify/laptop-avd-config-hardening.ps1`（带 `-DryRun`）+ `verify/INFRA-F4-F5-F6-2026-10-14.md` §1；备份 `config.ini.bak-f4-20261014-203537`（一行回滚）。
    **改动只在下次冷启动生效** ⇒ **下轮首次冷启后必须复核两条**：① `emu-coldstart-real-gpu.ps1` 判 PASS（真 GPU）；② CDP `innerWidth=360 / dpr=4`（几何仍是 CSS360）。
    `hw.gpu.mode=auto` **有意保留**：硬编码 `host` 会绕过加固版自愈 F3 的软渲染救援分支。
- **几何基线全部作废重制**：A14 / A15 / P04 等命中区基线是**旧 411 CSS 宽**下量的，360 宽下版面更挤。
  → **基线版本 = CSS360，v1.32.8 起**；**下一轮 QA 首跑必须在新宽度重打 A14/A15/P04 基线**，旧数字不可直接对照。
- **动态改分辨率会挂死 `screencap`**（SurfaceFlinger 卡死，`adb shell echo ok` 仍通，极具欺骗性）→ 唯一出路是**冷重启**。
  ⛔ **禁止用 `dsh-emu-sw` 冷启**（2026-10-14 实测）：它 → `run-emu-sw.cmd` **硬编码 `-gpu swiftshader_indirect` = CPU 软渲染**，
  与「一律真 GPU」直接冲突，照做起的实例会让几何基线与截图耗时全部作废。**正确且唯一姿势**：
  ```
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File verify\emu-coldstart-real-gpu.ps1 -Kill
  ```
  它做四件事：杀 `qemu`/`emulator` + 清 AVD 锁（`hardware-qemu.ini.lock` 是**目录**用 `-LiteralPath -Recurse -Force`；`multiinstance.lock` 是空文件）
  → 把 `G:\Android\emu-ladder.gpu` 钉成 `host` → 跑一次**权威**的 `emu-selfheal.cmd` → 轮询 `boot_completed`
  → **断言渲染器含 NVIDIA**（SwiftShader = FAIL exit 3，读不到 = BLOCKED exit 4 fail-closed）。
  `-Status` 是纯只读自检。**全程必须在同一次 ssh 会话里**（分成两次 ssh 会被回收）。
  （旧配方 `schtasks /Run /TN dsh-emu-sw` 与 `tmp\emu-cold-1440.ps1` 已作废；后者的杀进程/清锁部分已被新脚本吸收。）
- **GPU 策略（2026-10-14 用户拍板 + 追加硬约束）**：模拟器**一律真 GPU（`-gpu host`）**，且**禁止 CPU 软渲染**
  （swiftshader 会让笔电风扇狂转、噪音大）。用户会尽量让笔电**不锁屏、不掉登录**。
  - **唯一权威判据（一条命令）**：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File verify\emu-gpu-verdict.ps1`
    → **exit `0` = 真 GPU** ／ **`3` = CPU 软渲染（违反约束，报 lead）** ／ **`4` = BLOCKED（判不了，不代表健康）**。
    底层判据 = 客机 `dumpsys SurfaceFlinger` 的 `^GLES:` 行含 `NVIDIA GeForce RTX 4060`；含 `SwiftShader` = 软渲染。
  - ⛔ **已作废、禁止再用**：旧的「看 `emu-ladder.log` 的 `interactive console session: True/False`」判档位——
    该正则不看状态列，**同机同一分钟两个任务会给出相反结论**；而且「无交互会话 ⇒ `-gpu host` 会挂」这个前提
    **已被实测证伪**（2026-10-14：console 已断开状态下 `-gpu host` 6s 起来、渲染器 = RTX 4060）。
    也**别用 `ro.hardware.egl`**（恒为 `emulation`）。
  - **自愈已加固（19:02 起）**：若跑在 CPU 软渲染上，自愈会判 `VIOLATION` 并**主动 kill + 重启回真 GPU**。
    所以你**可能观察到模拟器被自愈重启一次**——看 `emu-ladder.log` 有无 `VIOLATION` 行再判定，别当故障。
  - **截图耗时基线（真 GPU）**：`screencap`+`pull` 稳态 **1.0–1.25s**（n=3）；单次受预热影响，只能当旁证，**旧 swiftshader 数字作废**。
  - 判定"客机真的健康"用 `boot_completed=1` **且** `adb shell echo ok` 有回应 —— **`adb devices` 看得到 ≠ 客机健康**。
  - 🔴 **闪窗已修（2026-10-15，F7）**：桌面偶发的 cmd 闪窗**不是模拟器本体**，是 `\emu-selfheal`（Interactive/session 1，每 5 分钟，`Write-Host` 上屏）＋ `\emu-ladder-rung`。**核心硬事实：计划任务的 `Settings.Hidden=$true` 不给进程窗口设 `SW_HIDE`，因此无效**（进程内 `IsWindowVisible` + 窗口级 `EnumWindows` 双证）。**修法＝动作改走 `wscript.exe //B "G:\Android\hidden-run.vbs" "<目标>.cmd"` ＋ 保留 `Hidden=True` ＋ 保留 `Interactive`**（子进程仍需在 session 1 才拿得到真 GPU）。
    - **判据**：不要只看 `Get-ScheduledTask` 的 `Hidden` 字段，也不要只看 `LastTaskResult`（`0` 只证明任务跑了、不证明没弹窗）；**唯一可信的是窗口级取证**——`verify\console-audit.ps1` 必须以 **Interactive 任务在 session 1** 跑（session 0 的 agent 看不到用户桌面），认 `kind=ONSREEN iconic=False`。
    - **两个任务的 `LastResult=0x41301`(267009) = Running 是正常的**（rung 任务在模拟器运行期间一直 Running，12h `ExecutionTimeLimit` 语义未变），**不是错误码**。
    - **冷启动会连带清掉遗留闪窗**：`emu-coldstart-real-gpu.ps1 -Kill` 走的就是新隐藏路径；实测 exit 0、渲染器 NVIDIA RTX 4060、`1440x3168@640`、`-Kill` 后**零可见控制台**。详情见 `verify/CONSOLE-WINDOW-FIX-2026-10-15.md`。
    - ⚠️ **改完必须跑"健康路径"回归**：修复首版只写在 `Start-Rung` 里，而**最常见的一轮是"已健康 → exit 0"，永远走不到那里** ⇒ 漂移永不自愈。现已在 main **每次必跑**的位置断言。

### 0.2 ask_user_question 的两个坑（**已验证**）
1. **子代理发不了提问**：harness 报 `owned by another live agent`（"owned by another live agent"）→ **N5 类"真实折回"用例必须借 lead 会话发问**，不要让 teammate 自己发。
2. **timed 模式由 request waterfall 纠正**：pre-execute 阶段猜不准，日志里会出现 `timed corrected to true` —— 别在 pre-execute 阶段断言 timed。

### 0.3 手机作答的时序语义（**已验证**，v1.32.8 实测 **3726ms**）
- `claimForeground=on`（台式机当前设置）→ 手机作答**即时**生效，日志 `answered (foreground)`。
- `claimForeground=off` → 手机作答是**"迟到作答"**：timed 等待活着期间（`state=open`）前台作答权属于 Web UI，插件只排队重试；**等待超时** → 提问进入会话投影（`continued`）→ 插件下一轮 poll 投递折回，日志 `returned pending` + `answered (continued)`。
- 用例 **QA-A18** 就是量这个：给 `web.log` 的 `[dsh-push-host]` 行打**毫秒时间戳**的 watcher，判据看落到哪一种。参考全链路：`verify/QA-ROUND-v1.32.8.md`（`call_5841f145…`）。

---

## 1. 三角色章程

| 角色 | 负责 | 写入范围 | 硬纪律 |
|---|---|---|---|
| **leader** | 编排、任务拆解与验收、发布（`-Deploy`）、看门狗/基础设施 | 全局（发布与 host-plugin 归它） | 只有它能发生产发布与 `-Deploy` |
| **developer** | `android-app/**`、`host-plugin/**`、openspec 变更 | `android-app/`、`host-plugin/`、`openspec/` | 每笔功能走 openspec；MODIFIED 需求逐字保留既有场景 |
| **tester** | `verify/**`、QA 报告、STATUS | `verify/**` | 只信脚本与真机证据；生产 topic 用 `qa-` 标记；测完必须复位设备 |

**写作用一句话钉死**：tester 只动 `verify/**`，developer 只动 `android-app|host-plugin|openspec`，leader 独占发布链与跨域改动 —— 重叠即冲突。

**🔴 执行模式（2026-10-15 用户拍板，对所有角色生效）**：**同一时刻只有一个成员在干活**——本地模型只有一个串行 FIFO 引擎，
三个角色与全部子智能体共用它。并发不会更快，只会互相排队 + 降质量。任务链 ①→②→③→④ **逐段串行**；
`send_message` 一次只唤醒一个成员；Lead 派完活**立刻结束回合**让出服务槽；`subagent` 一次只发一个。
不占 LLM 的活（跑脚本 / adb / scp / 构建 / 截图）不受此限。

## 2. 启动 prompt 模板（复制即用）

**leader**：
> 读 `verify/TEAM-START.md` 与 `verify/README.md`（含"AI 开发工作流硬事实"）。你是 leader：负责编排/验收/发布（`verify\dsh-app-verify.ps1 -Deploy -DeployNote "…"`，期望 `SUMMARY: 9/9`）。现在要做：<需求>。请先出任务链（实现 → 改动验证轮 → 发布），再按需 spawn developer/tester（**串行**：同一时刻只让一个成员在跑，见 §3）。

**developer**：
> 读 `verify/TEAM-START.md`。你是 developer，写入范围 `android-app/**`、`host-plugin/**`、`openspec/**`。本笔：<需求>。先写 openspec 变更（proposal + specs delta，MODIFIED 逐字保留既有场景），实现后自己跑一遍能跑的自测，然后交 tester。

**tester**：
> 读 `verify/TEAM-START.md` 与 `verify/TESTER.md`。你是 tester，写入范围 `verify/**`。本笔：对 <版本/提交> 做改动验证轮。注意：几何基线请按 **CSS360** 重打（旧 411 宽数字作废）；真实折回用例要借 lead 会话发问；生产推送一律带 `qa-` 标记；测完复位设备（airplane disable / font_scale 1.0 / force-stop）。**串行**：等 developer 的实现提交后再开工，不要提前并行写用例。

## 3. 任务链模板

```
① 实现（developer）:  openspec 变更 + 代码 + 版本号三处同步
                     (build.gradle.kts ×2 + PushService.APP_VER)
② 改动验证轮（tester）: 核心 8 项 + 新功能用例 + 定向回归
                     （**34 项全量留给"体验轮"**，改动轮不跑全量）
③ 发布（leader）:    verify\dsh-app-verify.ps1 -Deploy -DeployNote "…"   → SUMMARY: 9/9
                     → 线上 ?v=<versionCode> 确认 → export-public.ps1 -Msg "…"
④ 交接（三角色各写自己那格）: 见 §5，缺一不算收工
```
**🔴 串行化（2026-10-15 用户拍板，作废 task-16/17 的旧「并行化」结论）**：本项目全程用**本地模型**，
Lead / developer / tester / 子智能体**共用同一个串行 FIFO 推理引擎**（取证：
[DIAG-member-revive-2026-10-15.md](DIAG-member-revive-2026-10-15.md) §7）⇒ **同一时刻只允许一个成员在生成**。
旧结论「developer 一动手 tester 就同时写用例」是**云端多模型时代**的账，本地模型下并发只会互相排队、拖慢速度、降低质量。
**做法**：①→②→③→④ 逐段推进，用 `blocked_by` 钉依赖；`send_message` 一次只唤醒一个成员；
Lead 派完活立刻结束自己回合让出服务槽；`subagent` 一次只发一个（要结果就 `run_in_background:false`）。
**判据**：`list_agents` 里 `status=running` 的成员同一时刻 **≤1**（Lead 自己那一轮除外）。
**例外**：不占 LLM 的活（脚本/adb/scp/构建/截图）可重叠；确需真并行只能把部分成员切云端路由。

**⚠️ 但"共享资源"也必须串行（2026-10-14 新增）**：**模拟器 `emulator-5554` 只有一个**。
凡两端都要动它的任务（developer 装机 ↔ tester 截图/起页/`adb root`）**必须用 `blocked_by` 串行**并发会互相污染：
装机换版本打断取证、`force-stop` 关掉被测页、`adb root` 清掉 CDP 的 forward。
判据：任务描述里凡出现 `adb install` / `am start` / `force-stop` / `adb root` 的，先问"另一端是否也在用这台模拟器"。

## 3.1 ⚠️ 陷阱：跑 `dsh-app-verify.ps1` **不加 `-Deploy` 也会推用户真机**

**没有"只构建不发布"模式。** 不传 `-Deploy` 只跳过第 6 段（上传 aliyun + 更新通知）；
**第 3 段 `Stage "publish"` 是无条件发推**（`:319`→`:321` `POST ($ntfy + "/" + $topic)`，**不在任何 `$Deploy` 守卫内**）。
**且命令行 `-Topic`/`-Ntfy` 改不动它**——`:54` `config.local.ps1` 在 param 块之后 dot-source，自述
*"override script param defaults (but also override same-named command-line args)"*；现值 `$Topic="dsh"`（生产，直连用户真机）。

⇒ **只要跑它，用户真机就收到一条 `auto-verify <epoch>`**。

**处置**：**不发布的验证**（构建/装机自检、冒烟）**不要调它**，走**手工最小三件套**：
vm1 `gradle assembleDebug` → `scp` APK → 笔电 `adb install -r` + `dumpsys package … versionName` + `am force-stop`（**零 ntfy**）。
要验脚本本身，**先改 `verify/config.local.ps1` 的 `$Topic` 为 `qa-…`**（属 tester/lead 范围），验完**还原**。
细节与行号见 `HANDOVER.md` §3.12。

## 3.2 ⚠️ QA 起页隐式要求 adbd root（H-1）

`am start -n xyz.cpyh.dshpush/.WebActivity` 在**非 root**（uid 2000）时报
`SecurityException: Permission Denial: … not exported from uid 10216`；`adb root` 后立刻成功。
实测计数：`card-layout-verify.ps1:220` **有** `& $adb root`，但 **`qa-round-driver.mjs`（`:169-171`）与 `gate-shot.ps1` 均 0 处**。

- **顺序铁律**：`adb root` 必须排在**任何 `adb forward` 之前**（root 重启 adb server、会清掉既有 forward ⇒ CDP 静默断）。
- **起页前必须 `whoami` 断言为 root**，不满足报 **BLOCKED**（不许静默继续导致"跑了没量到"）。
- **为什么现在更要紧**：模拟器重启后 adbd 掉回非 root，而**加固后的自愈会在检出 CPU 软渲染时主动重启模拟器** ⇒ 触发概率比过去更高。
- 状态：**已开 task-4 修**（`blocked_by: task-3`）。

## 3.3 vm1 构建机易错点（2026-10-14 实测）

1. **`gradle` 不在 PATH**（`which gradle` 空）⇒ 必须
   `export PATH=$HOME/gradle-8.7/bin:$JAVA_HOME/bin:$PATH`，`JAVA_HOME=/usr/lib/jvm/java-1.17.0-openjdk-amd64`
   （`dsh-app-verify.ps1:197` 硬编码此路径）。Gradle **8.7**。
2. **`android-app/local.properties` 已含 `sdk.dir=/home/user/android-sdk`** ⇒ SDK **不必**再显式给
   （§0 旧描述的"需显式给"**已作废**）。
3. **手工构建前必须先同步 src**（照 `:191-194` 顺序：`rm -rf app/src` → `scp -r app\src` → `scp app\build.gradle.kts`
   → `scp build.gradle.kts settings.gradle.kts gradle.properties`），否则**构建的是 vm1 上的陈旧源码**。
   建议加闸门：同步后比对 `PushService.kt` 的 sha256（台式机 vs vm1），不一致即 abort。
4. **vm1 仓是陈旧脏快照**（曾 `HEAD 92147dd`、与台式机差 54 ahead / 198 behind、`host-plugin/` 不存在）⇒ 上机前确认已同步。

## 3.4 openspec CLI 与仓内等价检查器

- **裸 `openspec validate --strict` 是无效用法**（`Nothing to validate` + exit 1）⇒ 必须带目标：
  `openspec validate --changes --strict` 或 `openspec validate <change> --type change --strict`。**别误判成"环境坏"**。
- **台式机没有 `openspec` CLI**（`Get-Command` 空）⇒ 用仓内等价检查器
  `& <DSH node> tools\openspec-modify-check.mjs <change>`（专查"MODIFIED 漏抄现网 scenario"，exit 0 = 无问题）；
  要权威裁决再上 vm1。

## 5. 交接纪律（④，2026-10-14 用户要求制度化）

**目的**：下一个新对话的队员**不读历史也能上手**。索引文件 = `verify/HANDOVER.md`（leader 维护）。

| 角色 | 交接产物 | 必须包含 |
|---|---|---|
| **developer** | `openspec/changes/<本轮变更>/` + `host-plugin/README.md`（或 android-app 相关节） | 改了哪些文件、新增配置键/API、**踩过的新坑与判据**、下轮可直接复用的命令 |
| **tester** | `verify/QA-ROUND-<版本>.md` 定稿 + `verify/STATUS-*.md` + 用例文件 + `verify/TESTER.md`（QA 章程自维护） | 用例 id → 断言 → 实际 → 证据路径；**BLOCKED/未覆盖项显式列出**；新用例工具链；设备状态复位声明 |
| **leader** | skill `dsh-push-app-dev`（§2 硬事实）+ `verify/TEAM-START.md` + `verify/HANDOVER.md` | 新增环境硬事实（含机器状态如 GPU/锁屏）、任务链变化、**"待下轮确认"清单** |

**三条纪律**：
1. **硬事实必须带判据**——能一条命令验的就把命令写上，禁止"据说/应该"；
2. **作废的旧结论显式作废**（旧分辨率基线、旧耗时数字），否则下轮拿错数字对照；
3. **未完成/未覆盖项进"待下轮确认"栏**，不允许靠人回忆。

## 4. 本轮已验证 vs 待下轮确认（别混）

**已验证（可直接依赖）**：CSS360 同构与 `innerWidth=360/dpr=4` ✓；`screencap` 挂死与冷重启配方 ✓；子代理发不了提问 ✓；timed 由 waterfall 纠正 ✓；手机作答两种时序语义 + 3726ms 即时实测 ✓；笔电自愈阶梯 ✓；VM 已切 `dsh-push-host 0.1.1` ✓；
**模拟器禁 CPU 软渲染的完整闭环** ✓（`emu-gpu-verdict.ps1` 一条命令判据 + F1–F3 加固自愈 + **真机验证软渲染被 37s 拉回**，见 §0.1 / `INFRA-HEALTH-2026-10-14.md` §9.7）；
**swiftshader 启动器已全面退役** ✓（4 个脚本改走 `emu-selfheal`，见 `HANDOVER.md` §3.16 —— ⛔ 禁用 `dsh-emu-sw`）；
**QA 起页需 adbd root（H-1）已修** ✓（`requireRoot()` + root 先于 forward，见 §2 与 `HANDOVER.md` §3.17.5）；
**CDP 输入坑已澄清** ✓（`el.focus()` 不点击 + `Input.insertText`；合成点击会抢焦点）。

**待下轮确认（不要拿旧数字对照）**：
1. ~~A14 / A15 / P04 命中区基线在 360 宽下的新数值~~ → ✅ **已重打（2026-10-15 体验轮，commit `ac1ba31`）**：A14 仍 FAIL（P1，v1.32.7 FINDING-1 延续）、A15/P04 PASS。**A14 修复待立项**（App 侧 40px 命中区放大 + 上游紧凑布局叠加，见 `HANDOVER.md` §3.20.25）。
2. 360 宽下**长页面滚动/遮挡**类行为（旧轮次是在 411 宽下结论的）。
3. ~~swiftshader 下的截图耗时基线~~ → **已作废**：禁止 CPU 软渲染，只需真 GPU 基线（**已重打：1.0–1.25s，n=3**，见 §0.1）。
4. `claimForeground` 两种设置下的**用户可感差异**（产品取舍，等用户拍）。
5. ✅ **已闭环（2026-10-14 20:00 真机验证）**：「软渲染实例被自愈 kill+重启拉回真 GPU」——
   ~~只有干跑注入证明~~ 已由 lead 在用户批准后真机实测：SwiftShader 实例 **37s 内**被拉回 NVIDIA RTX 4060、
   `LastTaskResult=0x0`、选择器还原 `host`。详见 `INFRA-HEALTH-2026-10-14.md` §9.7。
6. ~~openspec 既有 ERROR（`载荷缺字段` 漏抄）~~ → **✅ 已修**（`c215691`，检查器 exit 0）。残余：`--all --strict` 仍有 5 项 WARNING 级。
7. **v1.32.11 浮层可读性**：改已提交（`f5e4a6b`）且 **lead 肉眼判读通过**（`ANALYSIS` §6.9），
   但 **alpha 是间歇的**（n=2 跑出 0 与 0.92）⇒ **待 task-9 用 ≥5 次采样钉死**；发布**暂停**中。详见 `HANDOVER.md` §3.18。
8. **`_surface_ri079_1 Z9Jnlq_menu`（`265x400`，无 `role`）仍走几何分支**的约 2px 外边是否有可见影响 —— 待 task-9 实测。
9. **`openspec --all --strict` 仍 5 项 WARNING**（Purpose 占位/过短、requirement >500 字符）—— 未处理。
