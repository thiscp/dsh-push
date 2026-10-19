# QA 轮 v1.32.17-RC（task-15）— 发版前轻验：**可发版**

被测物 HEAD **`77389ea00d4f1a448359204da4e2d4c8c2e488f7`**（= `bd12a59` §6.4 修复 + `c2a5711` 发布工具修复 + `77389ea` 版本 bump 83/1.32.17），工作树 `git status --short -- android-app` **干净**。设备 `emulator-5554`（AVD `dsh-p16`，物理 1440x3168@640，CDP `innerWidth=360`/`dpr=4`/`vh=671`）。纪律：只 `assembleDebug`、不 `-Deploy`、没跑 `dsh-app-verify.ps1`、推送一律 `qa-` 前缀 + epoch、只写 `verify/**`。

## §0 结论：**可发版**

| # | 验收项 | 判定 | 关键读数（RC 臂 `997eb1f3…4a5d`） |
|---|---|---|---|
| 1 | 状态卡片版本号 | **PASS** | 卡片实读 **`状态：已连接（v1.32.17）`**，与 `dumpsys package`（`versionCode=83 / versionName=1.32.17`）和 `aapt dump badging`（`versionCode='83' versionName='1.32.17'`）三处一致；**无空串、无 `?`** |
| 2 | 推送链路⑥不回归 | **PASS** | 推送→落库→未读→dumpsys 有记录→`#ans` 回声→`read:true` + `answered`→通知撤销，全链闭合（本轮动的正是 `PushService.kt`） |
| 3 | 首屏渲染 | **PASS** | 冷启动首屏两张截图（相隔 1 s）文字/底色/按钮全部正常，版本号两次读数一致 ⇒ 无闪烁、无空版本 |
| 4 | D11 复跑（口径已更新） | **PASS** | 展开 8/8 `__bwSbEl` 非 null + `rgba(249,250,251,0.92)` + `important`；收起 8/8 `0.45`、只翻 1 次；稳态写入 0；B 段 289px / 无 `grid-template-columns` / 18 目标 0 翻转；壁纸红线原值 |

**四条全过 ⇒ 可发版。** 没有「基本达成」：每条都是逐次采样的实测读数。
唯一的环境事件（模拟器中途死掉又自愈）见 §3，它**不影响**判定：事件前后是同一个已安装 apk（sha 逐轮校验），且四项都在同一臂上读全。

## §1 被测物与构建闸（本轮已按 developer 建议改造）

- **RC apk**：`verify/qa-d10-app-debug.apk` **10996940 B**，sha256 **`997eb1f362ee1d836c5e20daef2b19cd0804f72bb93932f2d8450a1275474a5d`**；vm1 构建，`BUILD SUCCESSFUL`。
- **构建闸（`verify/qa-d10-build.sh`）改成钉三个文件**（旧版只钉一个、且已过时）：
  - `WebActivity.kt` `de9a9bd812c833376c96bb96321e9464c1b6dfb3721746ba4d7c5b9d09ec882f`
  - `PushService.kt` `83abcf81607a43ab926f2cab2000c8b846c5d97a5f910a7eaef58ada404f315e`
  - `MainActivity.kt` `123241fa53bdcaf07a96716ba7978e956f952ecca1e683426f8a8287933d9555`
  三个都过 → `HASH_GATE_OK`；闸里另加 `grep versionCode/versionName app/build.gradle.kts` 打印（本轮打印 `13: versionCode = 83` / `14: versionName = "1.32.17"`）。
  **顺带修掉一个脚本自身的 bug**：两个 `for … done` 循环**漏了 `do`**（bash 在 `set -e` 下把循环体当词表吞掉，DEX 检查静默不跑、日志里一行 DEXHIT 都没有）。补 `do` 后单独跑 `verify/qa-rc-dex.sh` 才拿到下面的字面量清单。**教训：闸里的检查项必须验证它真的跑了**（有输出行才算数），否则「没报错」等于「没检查」。
- **DEX 字面量（正向）**：`__bwSbEl=2 __bwBgEl=1 __bwW=1 __bwRailW=1 bwFind=1 bwGeomFix=1 bwAlpha=1 bwPanelBg=1 bwHandle=1 bwFpSb=1 bwFpPlace=1 bwFpExp=1 grid-template-columns=1 MutationObserver=2 __dshGlass=1 isCode=1 isCB=1 innerBig=1` + **新增 `appVer=5 appVerCache=1 getPackageInfo=1`**。
- **DEX 负向（必须为 0）**：`APP_VER=0`、`1.32.15=0`、`1.32.16=0` ⇒ 硬编码常量与两个旧版本号字面量都已不在包里。
- **装机**：82→83 用**普通 `adb install -r`**（无需 `-d`）→ `Success`；设备 `sha256sum` 与本地一致；`dumpsys package` = `versionCode=83 / versionName=1.32.17`；**数据保留**（`shared_prefs/dshpush.xml` 11384 B、通行证在、9 条消息行在）。

## §2 四项逐项

### 1) 状态卡片版本号（`bd12a59` 的验收）
- 冷启动 `am force-stop` + `am start .MainActivity`，7 s 后截图 `verify/qa-rc-entry-t0.png`（1083072 B），再 3 s 后 `qa-rc-entry-t1.png`（1080940 B）。
- 两张截图上状态卡片都读作：**`● 24 条未读 / 状态：已连接（v1.32.17） / 服务器：https://ntfy.cpyh.xyz（topic dsh） / 通行证：已配置 ✔ / 电池优化白名单：未加入 ✘`**。
- 三处版本号互证：截图 **v1.32.17** = `dumpsys package` 83/1.32.17 = `aapt badging` 83/1.32.17。
- 兜底路径 `?` 未触发（`PushService.kt:48-56`：`PackageInfo.versionName` 取到就用、取不到才 `?`、且只 IPC 一次后缓存 `appVerCache`）。
- 机器可读断图的局限见 §4.1。

### 2) 推送链路⑥（本轮动了 `PushService.kt`，这是它主场）
| 环节 | 读数 |
|---|---|
| 推送 | ntfy id `pAmcAIC8i3Yd`，title `qa-rc-1792111292`（qa- 前缀 + epoch），priority 3，tag bell |
| 落库 | prefs 行 `{"title":"qa-rc-1792111292",…,"read":false,"callId":"qa-rc-1792111292","nid":1651870152,"qid":"q0"}` —— **callId 干净**（正文里 answer 链接是纯文本，没被 `linkRegex` 的 `(\S+)` 吃掉尾巴） |
| 未读期间通知 | `dumpsys notification --noredact` **含该 callId = True**（`qa-rc-dumpsys-ntf-unread.txt`） |
| 入口未读图 | `qa-rc-push-entry-unread.png`（1069762 B）卡片带蓝点 + 「肥鱼快答 / 已读」 |
| `#ans` 回声 | 纯文本 `#ans qa-rc-1792111292 answered by qa round` POST 到 **topic `dsh`**（prio 1）→ ntfy id `qHpHFknbxkAr` |
| 回声后 prefs | 同一行翻成 **`"read":true`** + **`"answered":"answered by qa round"`** |
| 通知撤销 | `dumpsys notification` 再查该 callId = **False**（已 cancel） |
| 入口已读图 | `qa-rc-push-entry-read.png`（1194158 B）卡片无蓝点、无「已读」按钮 |
- **脱敏**：`qa-rc-prefs-afterpush.txt` / `qa-rc-prefs-afterecho.txt` 已按任务要求脱敏后落盘 —— 实测 `tk_…` 命中 0、`?token=` 命中 0、`100.75.x.x` 命中 0，文件里是 `tk_REDACTED` / `token=REDACTED` / `VM1_IP`。

### 3) 首屏渲染
- 两张截图（t0/t1）首屏一致：标题「大肥鱼盯梢」+ 立绘头像、`DSH 入口` / `换主题` 按钮、状态卡片、消息卡片（`DSH 任务结束 [cc1f8bc6]` 带 `DSH 网页` / `已读`）、底部按钮组（启动监听 / 停止服务 / 电池白名单 / 保活体检 / 清空消息）、页脚立绘署名，全部正常无错位、无空文本。
- 状态卡片文字是警示色（红）——因为「电池优化白名单：未加入」走 `dshWarn`（`MainActivity.kt:914`），**既有行为、非本轮引入**。
- 版本号在 t0/t1 两次读数相同 ⇒ `appVer` 的「一次 IPC + 缓存」没有闪烁或空版本窗口。

### 4) D11 复跑（**已删除「收起后 `__bwSbEl` 应为 null」这条判据**）
| 判据 | 读数（8 次采样逐次一致） | 判定 |
|---|---|---|
| 展开稳态 `__bwSbEl` 非 null | `hHd-Xa_root` 360x671 | **PASS** |
| 展开内联底色 | `rgba(249, 250, 251, 0.92)`，`bgPrio=important` | **PASS** |
| 收起回 0.45 | `rgba(249, 250, 251, 0.45)` + `important`（节点仍是同一元素，缩成 56x671 的 `hHd-Xa_collapsed` 轨道） | **PASS** |
| 一次收起只翻 1 次 | 展开 8 次写入 **0/0/0**；收起 C0 起 **29/22/0 冻结 8 次** | **PASS** |
| 稳态写入 0 | 同上（两态都 0 增长） | **PASS** |
| B 段不回退 | frame 内联只有 `background-color: transparent !important;`、`gridInline` 空；代码块 **289x258 / 289x201**；18 个目标 **0 翻转** | **PASS** |
| 壁纸红线 | `#dsh-theme-veil` = `rgba(255,255,255,0.45)` 内联、**无 priority**、`pos fixed`、`z=-1`；`_emptyTabHost_6nhg2_143` = `rgb(255,255,255)` | **PASS** |
- 观察器指纹仍 `{geom:true, panelBg:false, panelClose:true}`；`__bwW`/`__bwRailW` 仍 null（结构臂在这个形态上仍不接管，底色由指纹臂供 —— 与上一轮结论一致，见上轮报告 §6.2）。
- 过渡窗口写入总量本轮 **29/22**（`background-color` 22 + 页面自己的 CSS 变量 3/3/1），比一小时前 D11 臂的 92/85 **低**：玻璃段源码逐字节相同（`WebActivity.kt` sha 一致），差异来自会话状态（玻璃化那一轮扫到多少元素），不是代码 ⇒ 再次说明**这个总数不是判据，稳态 0 才是**。
- 本轮 rAF 无长帧离群：`frames=955`、med/p90/p95 = 17ms、**max 250ms**（上一轮那个 1117ms 未复现 ⇒ 支持「环境性一次事件」的判断）。
- 截图：`qa-qa-rc-d10-d10-expanded.png` 363336 B、`qa-qa-rc-d10-d10-collapsed.png` 993095 B、`qa-qa-rc-d2e-d2e.png` 362486 B、`qa-qa-rc-redline-redline.png` 484057 B，全部 `alive=true`（截图前后 app pid 不变）。

## §3 环境事件：模拟器中途死掉 + 自愈（如实登记）

- 现象：跑完第 2 项（推送链路）后，第 4 项第一次 `d10` 报 `FATAL connect failed: no app pid`，随后 `d2e`/`redline` 报 `HASH_GATE FAIL before=NO_PATH`；查 `adb devices` = **no devices/emulators found**，`Get-Process` 里 qemu/emulator **全部不在** ⇒ 模拟器进程死了一次（本轮已知的环境抖动，与代码无关）。
- 处置走项目自己的正规路径（`card-layout-verify.ps1` 里那段恢复序列）：清 `dsh-p16.avd\hardware-qemu.ini.lock` + `multiinstance.lock` → `Set-Content G:\Android\emu-ladder.gpu host`（**钉死真 GPU**，禁 swiftshader：CPU 渲染会吹风扇且作废 CSS360 几何）→ `schtasks /Run /TN emu-selfheal`。
- 结果：**28 s 后设备回来**、`sys.boot_completed=1`；**安装与数据都在**（`pm path` 同一个安装目录、`versionCode=83/1.32.17`）；GPU 闸重跑 **PASS**（guest `GLES:` = NVIDIA GeForce RTX 4060，`qemu -gpu host`，wm size/density 未变）。
- 影响面：第 1、2、3 项在死之前已测完并落盘；第 4 项在重启后重跑（同一 apk sha，逐轮 `HASH_GATE` 校验）。**没有跨臂混数**。

## §4 残留与口径（下一轮带着走）

1. **状态卡片的机器可读断图不可用**：`uiautomator dump` 在这台模拟器上进不了 idle（`ERROR: could not get idle state`，`--compressed` 也一样），`dumpsys activity top` 给出的是 launcher 的层级（app 明明是 `topResumedActivity`）。⇒ 版本号这条只能「**截图人读 + `dumpsys package` + `aapt badging`**」三处互证。本轮就是这么做的；下一轮别再指望 uiautomator。
2. **构建闸的自检**：见 §1 —— 检查项要有输出行才算跑过；本轮已把 DEX 正/负清单拆成两段并各自打印。
3. **prefs 落盘必须脱敏**（本轮起为硬要求）：`tk_…`、`?token=`、两台机器名/IP 都要替换；本轮用 `Redact()` 在写盘前替换并回读验证命中数为 0。
4. 上一轮的登记仍然有效，本轮未推翻：**自锁机制**（宽度判据随我们自己的写入腐烂）、**结构臂仍不接管满屏宽覆盖层形态**、**正文子树 4.35vh 陷阱**、**探针坑**（`[class*=_root_]` 恒 null）、**装机坑**（装旧 versionCode 要 `-d`；本轮 82→83 是升级，普通 `-r`）、**`#ans` 回声口径**（必须纯文本发 topic `dsh`）、**编译闸教训**（Kotlin 拼 JS 改动提交前必须 `assembleDebug`）。
5. **发版脚本侧**（不在我写域，只登记事实）：`PushService.APP_VER` 常量已消失 ⇒ `verify/release.ps1` 的「三处同步」变两处（lead 已在 `c2a5711` 改完并验过 `-DryRun` exit 0）。本轮**没有**跑 `release.ps1` / `dsh-app-verify.ps1`。

## §5 证据清单（全在 `verify/`）

- 构建与装机：`qa-d10-build.sh`（三文件闸 + 版本打印）、`qa-rc-dex.sh`（DEX 正/负清单 + aapt 版本）、`qa-d10-app-debug.apk`（RC，`997eb1f3…4a5d`）。
- 第 1/3 项：`qa-rc-entry-t0.png`、`qa-rc-entry-t1.png`、`qa-rc-activitytop.txt`（uiautomator 不可用的现场）、`qa-rc-logcat-crash.txt`（crash 缓冲为空）。
- 第 2 项：`qa-rc-prefs-afterpush.txt`、`qa-rc-prefs-afterecho.txt`（均已脱敏）、`qa-rc-dumpsys-ntf-unread.txt`、`qa-rc-push-entry-unread.png`、`qa-rc-push-entry-read.png`。
- 第 4 项：`qa-rc-d10.json`、`qa-rc-d2e.json`、`qa-rc-redline.json` + 四张截图。
- 上一轮（D10/D11）报告与证据仍在：`QA-ROUND-v1.32.17-D10.md` 及 `qa-d10-*` / `qa-d11-*`；本轮 RC 臂与它们**不同臂**（83/1.32.17 vs 82/1.32.16），比对时按臂对号。
