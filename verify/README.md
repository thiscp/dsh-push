# dsh-app-verify —— APP 一键验证流水线（AI 作业手册）

目标：**任何一台新机器上的 AI，克隆本仓库后照本手册就能把"改代码 → 编译 → Android 16 模拟器装机 → 推送断言 → 截图复核 → 上架分发"整条链路跑起来，全程 0 人工。**

## 拓扑（四个角色，可以同机可以分开）

| 角色 | 现网实例（示例，实际值在 `config.local.ps1`） | 职责 | 关键依赖 |
|---|---|---|---|
| 编排机 | DSH Windows（跑 DSH Web 这台） | 跑 `verify/dsh-app-verify.ps1`，持有到其余三方的 ssh key | ssh + curl.exe + scp |
| 编译机 | Linux VM（ssh 目标写在 `config.local.ps1`） | gradle assembleDebug | JDK17 + Android SDK34 + gradle-8.7 |
| 模拟器机 | 家里笔电（Windows，tailscale 可达） | Android 16 (API 36) AVD 常驻 + adb | WHPX、计划任务 `dsh-emu-sw`（swiftshader，见下方 `-gpu host` 那条）、`G:\Android` SDK 树（`emu-bootstrap.ps1` 一键装） |
| 分发/中继 | 云主机（ssh 别名 `aliyun`）+ ntfy 服务器 | APK 下载 `https://<ntfy>/dl/dsh-push.apk?v=<versionCode>`；推送 topic `dsh` | 写令牌发消息、读令牌给 APP |

## 一键用法（编排机上）

```powershell
# 全链路：编译 → 装机 → 发测试推送 → 断言 → 截图（截图在 $env:TEMP\dsh-verify\）
powershell -File verify\dsh-app-verify.ps1

# 常用变体
... -Deploy                 # 全绿后自动上架阿里云，打印 ?v=<versionCode> 链接
... -Fresh                  # pm clear + 重新种 token（干净状态验证）
... -SkipBuild -Apk <path>  # 跳过编译用现成 APK
... -Topic <t>              # 只换「发布」topic；APP 端订阅是编译期常量 dsh（见下方警告与推送一节）
```

退出码 0 = 全部断言通过。断言清单：模拟器在线(API) → 编译产物 → install Success → 推送落库（prefs 里能按唯一正文找到条目）→ mid 唯一 → read=false → 截图 >100KB（**必须 read_image 肉眼看截图**，prefs 断言不能替代视觉验收）。不带 `-Deploy` 共 **7** 项（`SUMMARY: 7/7 passed`），带 `-Deploy` 才是 9 项。

**流水线自己会冷启动模拟器，而且不许静默挂死（2026-10-13 加固）**：跑之前模拟器关着是常态——脚本发现 `adb devices` 为空时，会**在同一条 ssh 会话里**清 AVD 锁 → `schtasks /Run /TN dsh-emu-sw` → 轮询 `getprop sys.boot_completed`（上限 `-EmuBootSec`，默认 300s）→ 继续装机/断言/截图。每条 ssh/scp 都带 `-o BatchMode=yes -o ConnectTimeout=10`，并且所有子进程跑在看门狗下：单步超时（ssh/scp 60s、vm1 构建 900s、驱动会话 = 启动上限 + 断言上限 + 240s）或整个流水线预算（`-TotalTimeoutSec`，默认 1800s）到点就杀掉进程树，打印「哪一步 / 哪条命令 / 什么错 / 耗时」并**非 0 退出**。想亲眼验证看门狗真的会退出：`powershell -File verify\dsh-app-verify.ps1 -WatchdogSelfTest`（喂一条 `Start-Sleep 120` + 5s 超时，期望 `[FAIL] watchdog-selftest` + `SUMMARY: ABORTED ...` + exit 3）。

## 新机器从零起（模拟器机）

1. 前置：Win11 + `Get-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform` 为 Enabled（或 HypervisorPresent=True）；磁盘 ≥15GB；账户已登录（任务是 InteractiveToken）
2. 跑 `powershell -File verify\emu-bootstrap.ps1`（约 20 分钟，大头是 SDK 下载）
3. 把编排机的 ssh 公钥加进该机 `authorized_keys`（key-auth，BatchMode 可用）
4. 编排机跑 `dsh-app-verify.ps1 -Fresh` 验收

编译机从零起：`apt install openjdk-17-jdk` + gradle-8.7 zip 解到 `~/gradle-8.7` + sdkmanager 装 `platforms;android-34`（AGP 编译用，与模拟器镜像版本无关）+ 仓库根写 `local.properties`（`sdk.dir=...`）或导出 `ANDROID_HOME`。

## 硬事实清单（全部是踩过坑换来的，新环境直接照做）

**下载与解包**
- Android SDK 树用腾讯镜像 `https://mirrors.cloud.tencent.com/AndroidSDK/`（31MB/s）；sysimg 真实路径是 `sys-img/google_apis/x86_64-36_r07.zip`（不是 `sys-img/x86_64/`）
- GitHub 直连失败时用 `https://gh-proxy.com/` 前缀
- **1.9GB 的 sysimg zip 用 `tar -xf`（bsdtar）解，`Expand-Archive` 会报 "local file header is corrupt"**
- sdkmanager 许可证必须管道喂 y：`("y`n" * 40) | sdkmanager ...`；预写 licenses 目录不生效

**模拟器生命周期（Windows）**
- 模拟器**只能**由计划任务拉起（现网用 `dsh-emu-sw`，见下方 `-gpu host` 那条）：sshd 退出会杀掉会话子孙进程，nohup/Start-Process 都会死
- 真进程名是 `qemu2.exe`（launcher 是 `emulator.exe`），杀要两个都杀：`Get-Process qemu2,emulator | Stop-Process -Force`
- **2026-10-12 修正**：本机实测真名是 **`qemu-system-x86_64-headless.exe`**（Emulator 37.2.12），`qemu2.exe` 是老版本名——
  按 `Get-Process | Where-Object { $_.ProcessName -match 'qemu|emulator' }` 找更稳，否则会"看不到模拟器进程但 adb 里有设备"。
- **`-gpu host` 在非交互会话里起不来**：计划任务（或 ssh 会话）里跑现网的 `G:\Android\run-emu.cmd`
  （`-gpu host`）时，gfxstream 崩在 `glTexImage2D ... error 0x502`，进程几秒后退出、
  `LastTaskResult=1`、adb 里设备消失。改 `-gpu swiftshader_indirect` 立刻能起（本次临时任务 `dsh-emu-sw` 即此法）。
  要长期生效就把 `run-emu.cmd` 的 `-gpu host` 换掉，或保证有个带 GPU 上下文的已登录 console 会话。
- **强杀后会留锁**：`%USERPROFILE%\.android\avd\<avd>.avd\{hardware-qemu.ini.lock,multiinstance.lock}`，
  不清掉下一次可能直接拒绝启动（`LastTaskResult=1`）。
- **起模拟器和驱动要放进同一条 ssh 会话**（2026-10-13）：分两次 ssh（先单独 `schtasks /Run` 起模拟器、断开、再 ssh 回来
  装包/驱动）**实测失败过两次**——装完包 `am start` 就报 `adb.exe: error: no devices/emulators found`。成因**没查到底**：
  后来复核时，同一条会话结束之后模拟器仍然活着（另开一条 ssh 还能看到 `emulator-5554`），所以更像是"会话释放那一瞬间"
  的竞态，**不是"会话一释放必定回收模拟器"的铁律**。但稳妥做法就是不分开做 —— 一条 ssh 里按序做完：清 AVD 锁 →
  `schtasks /Run /TN dsh-emu-sw` → 轮询 `adb wait-for-device` + `getprop sys.boot_completed` → 装包 → 驱动/断言/截图。
  `dsh-app-verify.ps1` 与 `bw-iter.ps1` 已按此实现（连测试推送都是在这条会话里用 host 上的 curl 发的）。
- **客机"框架半死"指纹**（本次踩到）：`adb shell cmd wifi status` → `Can't find service: wifi`、
  `dumpsys connectivity` → `Can't find service: connectivity`、`settings get` 挂住、`ip route` 超时、
  `ping` 报 `Network is unreachable`、`ps -A` 里一个 `Z` 僵尸 `system_server` 加一个新 `system_server`，
  `ifconfig eth0` 却还有 `10.0.2.15` 和收发计数。此时 `svc wifi enable`/`adb reboot`/`stop+start` 都救不回来
  （客机 uptime 28 h 没变过），正确处置是**冷启动模拟器**再跑流水线。
- **ICMP 不能当连通性判据**：`ping 47.109.50.167` 100% 丢包是常态（服务器禁 ICMP）。
  判据用 `adb shell ping ntfy.cpyh.xyz` **能否解析出 IP**（能解析＝DNS/网络栈正常）。
- 计划任务默认带电池限制（笔记本必死）：`DisallowStartIfOnBatteries/StopIfGoingOnBatteries` 必须用 `Set-ScheduledTask -Settings` 关掉
- `/Change /TR` 会静默失败，改任务动作要删了重建；任务动作用 wrapper .cmd（schtasks 引号地狱）

**adb 与 APP 数据**
- userdebug 镜像直接 `adb root`；**API 36 上 `run-as cp` 读 /data/local/tmp 被 SELinux 拦**（API 35 还能过）——种 prefs 用 root：`mkdir -p` → `cp` → `chown -R <uid>` → `restorecon -R`（uid 从 `stat -c %u /data/data/<pkg>` 取）
- `REQUEST_INSTALL_PACKAGES` 是特殊权限：`pm grant` 无效，要 `appops set <pkg> REQUEST_INSTALL_PACKAGES allow`
- 断言通道 = `adb shell cat /data/data/xyz.cpyh.dshpush/shared_prefs/dshpush.xml`（XML 里引号转义成 `&quot;`，正则按转义后写）+ `screencap` 截图
- `uiautomator dump` 常报 "could not get idle state"（APP 有动画）——别依赖它，用截图
- 截图落盘用 `cmd /c "adb exec-out screencap -p > file.png"`（PS 的 Out-File 会坏字节流）

**推送与测试**
- 发测试推送：`curl -X POST <ntfy>/<topic> -H "Authorization: Bearer <write>" -H "Title: ..." -d "<唯一正文>"`，断言用正文里的 epoch 唯一串定位条目
- **模拟器默认订阅生产 topic `dsh` + 生产读令牌 = 镜像真手机的全部推送**（方便对照），但作答路由会被模拟器抢走。
- **模拟器订阅哪个 topic 是编译期常量**（`PushService.kt` 的 `WS_URL = wss://ntfy.cpyh.xyz/dsh/ws`，prefs 里没有覆盖口），
  `-Topic` 只改发布端 —— 换测试 topic 时模拟器收不到，`push-received`/`mid-unique`/`entry-unread` 三项必然 FAIL；
  而现网 ntfy 已到 topic 总数上限，新建 topic 直接 `429 {"code":42904,...limit reached...}`。要跑出全绿只能用
  `-Topic dsh`（代价：手机收到一条 `auto-verify <epoch>` 测试推送，不是 APK 更新通知）。
- 推送正文里别放和断言正则冲突的字样（本项目 mid 断言曾被正文里的 "mid" 字样干扰）

**连模拟器机（笔电）**
- **规则：设备访问一律走 Tailscale 固定 IP，不用 LAN 地址。** 笔电用 `ssh user@<tailnet-laptop>`（同一台机，hostname
  仍是 `DESKTOP-CPYH`）最稳；判断"是不是这台笔电"用 `ssh user@<tailnet-laptop> hostname`，别靠 IP。
- **LAN 地址有两个坑，都会让 ssh/scp 静默超时**：① **会漂** —— 2026-10-13 从 `<lan-laptop>` 漂到 `192.168.1.6`，
  `config.local.ps1` 里的旧值把夜间验收直接打成 SKIP；② **新连接被防火墙拦** —— `ssh user@<lan-laptop>` →
  `Connection timed out`（实测）。地址写错代价很大：那次流水线在第三次 ssh 处静默挂了 **34 分钟**才被人收口，
  所以现在每条 ssh/scp 都带 `-o ConnectTimeout=10` + 看门狗兜底。
- `dsh-emu` 任务（`-gpu host`）在非交互会话里会崩：`emu-err.txt` 里 `glTexImage2D ... 0x502`、
  `LastTaskResult=1`。改跑 `dsh-emu-sw`（`-gpu swiftshader_indirect`）立刻能起；强杀过模拟器先清
  `%USERPROFILE%\.android\avd\dsh-p16.avd\{hardware-qemu.ini.lock,multiinstance.lock}`。
  **别在这台笔电上 `Get-Process chrome|Stop-Process` 之类的广域杀进程**——会连带把 adb/模拟器搞没。

**WebView 远程调试（量 HTML 布局、点 DOM、驱动应用内浏览器）**
- 应用内浏览器（WebActivity）没导出，`am start -n xyz.cpyh.dshpush/.WebActivity --es url <url>` 就能开；
  之后 `adb shell cat /proc/net/unix | findstr webview_devtools_remote` 拿到 pid，
  `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`，在这**笔电本机**用 CDP 驱动
  （`adb forward` 规则在模拟器宿主上，所以 CDP 客户端必须在宿主跑，不能从台式机直连 9222）。
- **devtools socket 只在应用加载过页面后存在**：`am start` 之后要轮询等（约 25s），否则报
  `no webview devtools socket`。`adb root` 会重启 adb server 并清掉 forward，所以顺序必须是
  root → 启动 → 等 → forward。
- 手机横屏/竖屏下 WebView 的逻辑视口就是设备宽度（实测 **412 CSS px**，dpr 2.625），而 v1.9.8 起
  UA 去掉了 `" Mobile"` —— 即"桌面版渲染 + 412px 视口"。这是提问卡/侧栏窄宽度排版问题的前提条件。
- 现成脚本：`powershell -File verify\card-layout-verify.ps1 -DshWebUrl <带 token 的 URL>` 会在模拟器上装机、
  开应用内浏览器、进会话、量提问卡并把 `card-layout.png` + `card-layout-report.json` 拉回本机并打印 PASS/FAIL。

**web.log 里的 token 是活的，别用旧值**
- `?token=` 每次 DSH 重启都换，`C:\Users\<user>\.dsh\web.log` 里**最后一条** `dsh web: http://...?token=` 才有效。
  旧 token 打开 DSH Web 会显示 "dsh web authentication required; reopen the URL printed by dsh web."。

**PowerShell 5.1（编排/远端脚本）**
- `bash -s` 喂脚本时，脚本里的 **gradle/JVM 会吃掉剩余 stdin**（它后面的行全部蒸发且 exit=0）——所有子命令都要 `< /dev/null` 或先把脚本落成文件再跑
- 脚本文件 ASCII only（BOM-less UTF-8 里的中文会变 ? 且坏正则）；要中文输出就 `chcp 65001 >nul &` 前缀
- 函数参数别叫 `$args`（自动变量，会坏 adb 参数转发）
- **`${var.Method('a','b')}` 内插表达式在 5.1 里静默变空串**（引号把 `${}` 解析截断）——先 `$x = $var.Method(...)` 存变量再插值
- **往远端传的 .ps1 里不要出现中文**（含中文的字符串在传输/编码环节会变成乱码，进 JS 会直接语法错误）；
  需要匹配中文就用码点列表传过去在页面里重建。`$driver.Replace('${COLLAPSE}', $x)` 这类替换要用**单引号**写占位符
  （双引号里的 `${}` 会被 5.1 吃掉）
- 远端 PS 一律 `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File <path>`，脚本先 scp 上去再跑（远程默认 shell 可能是 cmd，PATH 里没有 powershell）

## 模拟器测不了什么（正式版仍需真机抽查）

OriginOS 定制层行为：图标陈旧不刷新、后台被杀策略、深链落点、heads-up 白名单、系统下载组件（v1.21.1 已绕开）。模拟器负责的是：功能逻辑、数据层（prefs/DB）、UI 渲染、通知结构、Android 16 平台行为（SELinux/权限/WebView）。

## 版本发布纪律

改代码 → 版本号双跳齐（`PushService.APP_VER` + `build.gradle.kts versionCode/versionName`）→ 验证全绿 → `-Deploy`（链接 `?v=` 必须用 versionCode，缓存击穿）→ 真机验收 → openspec 归档 + git push。

发布前先自证脱敏（不推远端）：`powershell -File verify\export-public.ps1 -DryRun` —— 只跑 scrub 映射 + 密钥闸门，
逐条打印「哪个个人值被替换成了什么占位符」（IP 显示原值，token/用户名只显示计数），命中泄漏就非 0 退出、绝不静默放行。
