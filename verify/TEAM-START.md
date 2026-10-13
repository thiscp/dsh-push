# dsh-push 新对话快速启动（3 人团队）

> 目的：新开一个对话就能以 **leader / developer / tester** 三角色进入"实现 → 改动验证轮 → 发布"的节奏，不用重新摸环境。
> 仓库：`F:\work\work_dsh\dsh-push`（git）。所有 verify 脚本、QA 报告、STATUS 都在 `verify/`。

---

## 0. 环境速查（**已验证事实**）

| 项 | 值 |
|---|---|
| 编排机 | 台式机 `DESKTOP-CPHOME`（DSH Web `127.0.0.1:3080`；对外 Tailscale `<tailnet-windows>:3080`） |
| 构建机 | 测试机1 vm1 `user@<tailnet-vm1>`（**台式机没有 JDK/Android SDK，本地跑不了 gradlew**；`dsh-app-verify.ps1` 的 build-vm1 步骤在这台 gradle 构建：JDK17 在 PATH、SDK 在 `/home/user/android-sdk` 需显式给、仓在 `/home/user/work/projects/dsh-push`，流水线每次 scp 覆盖 src，构建产物回传） |
| 模拟器机 | 家里笔电 `DESKTOP-CPYH`（Tailscale **`<tailnet-laptop>`**，**不要用 LAN IP**：会漂且被防火墙拦新连接） |
| AVD | **`dsh-p16`** 常驻笔电；adb 在笔电 `G:\Android\Sdk\platform-tools\adb.exe` |
| 桌面 web token | **每次 DSH 重启必换**（今天死了两次都换了）→ 脚本一律从 `C:\Users\<user>\.dsh\web.log` 取**最后一条** `dsh web:` 行里的 `token=`，并把 `127.0.0.1:3081` 替换为 `<tailnet-windows>:3080` |
| ntfy | 生产 topic `dsh`；**QA 一律用 `qa-` 前缀的正文标记**，正文里放 epoch 唯一串做断言定位；生产卡片靠 `#ans` 自清 |
| 判卷/看门狗 | 两侧 `askStaleSec` 保持 **999999**（不恢复判卷代答）；`gpu-mode.cmd local` 现在后台预热专家缓存、真实请求一到就让路 |

### 0.1 模拟器：**CSS360 基线（2026-10-13 晚起生效）**
- AVD `dsh-p16` 已与用户真机同构：**分辨率由 AVD 物理配置 `config.ini` 保证**（`hw.lcd.width=1440` / `hw.lcd.height=3168` / `hw.lcd.density=640`，备份 `config.ini.bak-1440`），CDP 实测 **`innerWidth=360` / `dpr=4`**，与用户真机（最小宽度 360dp）逐像素同构。
  - ⚠ **`wm size/density` 动态 override 会丢**（实测只剩 density 640 → `innerWidth=270`），**不再当持久化手段**；`wm size reset`/`wm density reset` 后物理配置就是正解。改分辨率必须走 config.ini + **冷重启**（动态改还会挂死 `screencap`）。
- **几何基线全部作废重制**：A14 / A15 / P04 等命中区基线是**旧 411 CSS 宽**下量的，360 宽下版面更挤。
  → **基线版本 = CSS360，v1.32.8 起**；**下一轮 QA 首跑必须在新宽度重打 A14/A15/P04 基线**，旧数字不可直接对照。
- **动态改分辨率会挂死 `screencap`**（SurfaceFlinger 卡死，`adb shell echo ok` 仍通，极具欺骗性）→ 唯一出路是**冷重启**：
  杀 `qemu-system*`+`emulator` → 清 AVD 锁（`hardware-qemu.ini.lock` 是**目录**，用 `-LiteralPath -Recurse -Force -Confirm:$false`；`multiinstance.lock` 是空文件）→ `schtasks /Run /TN dsh-emu-sw` → 轮询 `getprop sys.boot_completed`；**全程必须在同一次 ssh 会话里**（分成两次 ssh 会被回收）。现成脚本：`F:\work\work_dsh\tmp\emu-cold-1440.ps1`。
- 当前笔电**无交互登录会话** → 自愈阶梯（`emu-selfheal`）自动选了 **swiftshader**，所以 `screencap` 偏慢是正常；**有人登录笔电后阶梯会自动升到真 GPU**（`-gpu host` 冷启实测 18s）。
- 判定"客机真的健康"用 `boot_completed=1` **且** `adb shell echo ok` 有回应 —— **`adb devices` 看得到 ≠ 客机健康**。

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

## 2. 启动 prompt 模板（复制即用）

**leader**：
> 读 `verify/TEAM-START.md` 与 `verify/README.md`（含"AI 开发工作流硬事实"）。你是 leader：负责编排/验收/发布（`verify\dsh-app-verify.ps1 -Deploy -DeployNote "…"`，期望 `SUMMARY: 9/9`）。现在要做：<需求>。请先出任务链（实现 → 改动验证轮 → 发布），再按需 spawn developer/tester。

**developer**：
> 读 `verify/TEAM-START.md`。你是 developer，写入范围 `android-app/**`、`host-plugin/**`、`openspec/**`。本笔：<需求>。先写 openspec 变更（proposal + specs delta，MODIFIED 逐字保留既有场景），实现后自己跑一遍能跑的自测，然后交 tester。

**tester**：
> 读 `verify/TEAM-START.md` 与 `verify/TESTER.md`。你是 tester，写入范围 `verify/**`。本笔：对 <版本/提交> 做改动验证轮。注意：几何基线请按 **CSS360** 重打（旧 411 宽数字作废）；真实折回用例要借 lead 会话发问；生产推送一律带 `qa-` 标记；测完复位设备（airplane disable / font_scale 1.0 / force-stop）。

## 3. 任务链模板

```
① 实现（developer）:  openspec 变更 + 代码 + 版本号三处同步
                     (build.gradle.kts ×2 + PushService.APP_VER)
② 改动验证轮（tester）: 核心 8 项 + 新功能用例 + 定向回归
                     （**34 项全量留给"体验轮"**，改动轮不跑全量）
③ 发布（leader）:    verify\dsh-app-verify.ps1 -Deploy -DeployNote "…"   → SUMMARY: 9/9
                     → 线上 ?v=<versionCode> 确认 → export-public.ps1 -Msg "…"
```
**并行化（task-16/17 的教训）**：developer 一动手，tester 就**同时**把新功能的声明式用例写好（不必等实现完成）——串行等待是上一轮浪费时间的根源。

## 4. 本轮已验证 vs 待下轮确认（别混）

**已验证（可直接依赖）**：CSS360 同构与 `innerWidth=360/dpr=4` ✓；`screencap` 挂死与冷重启配方 ✓；子代理发不了提问 ✓；timed 由 waterfall 纠正 ✓；手机作答两种时序语义 + 3726ms 即时实测 ✓；笔电自愈阶梯（sshd 自愈 / 真 GPU 18s / sw 回退 24s / 幂等）✓；VM 已切 `dsh-push-host 0.1.1`（`relay ready host=work topic=dsh`、推送带 `#web …:3080/?token=<新鲜>` + `#name 工作VM`）✓。

**待下轮确认（不要拿旧数字对照）**：
1. **A14 / A15 / P04 命中区基线在 360 宽下的新数值** —— 下一轮 QA 首跑必须重打。
2. 360 宽下**长页面滚动/遮挡**类行为（旧轮次是在 411 宽下结论的）。
3. swiftshader 下的截图耗时基线（有人登录笔电升到真 GPU 后需重打）。
4. `claimForeground` 两种设置下的**用户可感差异**（产品取舍，等用户拍）。
