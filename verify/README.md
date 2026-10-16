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
- `uiautomator dump` 常报 "could not get idle state"（APP 有动画）——别依赖它，用截图。**但通知栏（SystemUI）例外能过**（v1.32.10 QA 实测：`cmd statusbar expand-notifications` 后 dump 成功出 50KB XML）——通知动作按钮坐标可从 shade dump 按 text 找（QA-A27 姿势）
- **MainActivity 上 uiautomator dump 是必挂不是偶发**（v1.32.9 QA 实测）：常驻呼吸/星闪动画挡住 idle，`window_animator_scale=0` 也救不回来（11.4s 超时）。原生 UI 按钮坐标一律从 **`adb shell dumpsys activity top`** 的视图层级解析：bounds 是**相对父级**的要沿祖先累加；可见性看 flags 首字符（`V`/`G`）、可点看 flags 含 `C`；状态卡 = 消息列表 ScrollView 之前最后一个可见 LinearLayout。解析器现成：`verify\qa-markallread.ps1` 的 `Parse-Tree`。**bounds 还是布局坐标、不含 ScrollView 滚动偏移**：首屏（scrollY=0）可直接当屏幕坐标点，滚动后列表里靠下的按钮会虚高（v1.32.10 QA C02 实测：pill 布局 y=13102 实际屏 y=2200）——这时用 System.Drawing 给截图画 200px 网格线（`tmp` 一行命令）肉眼看真坐标再点
- **toast 文案的唯一可靠通道** = `dumpsys notification` 里的 `Toast Queue:` → `TextToastRecord{... text=...}`，**只在 toast 存活期（~2s）可见** → 必须与 `input tap` 串在同一条远端命令链里，**且中间隔 ~1 秒**：`input tap & ping -n 2 127.0.0.1 >nul & dumpsys notification --noredact`。`input tap` 是注入即返回，App 处理点击→cancel 通知→toast 入队要 0.3~0.8s，0 延迟立刻 dump 会抢跑（v1.32.9 QA 实测：「通知没撤 + toast 没弹」的假 FAIL 全是这个成因，晚一拍的 dump 里都已生效）
- **force-stop 会把该 App 的消息通知全部顺带撤光**（v1.32.10 developer 实测）：推送后若要断言「通知还在/被谁撤」，**只能 `am start` 拉起，绝不能先 force-stop**——否则 BEFORE 快照里通知就是空的，断言假阴性
- **模拟器重启后 adbd 会掉回非 root**（v1.32.10 QA 实测）：prefs 写回依赖 root cp，掉 root 后 cp 静默失败——cleanup 报「dropped N」但再读还是 N 条就是这个；跑 cleanup 前先 `adb root`（`restarting adbd as root` + `whoami`=root 双确认）
- **从 ssh 远端读 UTF-8 内容（prefs/dumpsys）走 stdout 捕获**：job 里先 `[Console]::OutputEncoding=[Text.Encoding]::UTF8` 再收（PS 默认按控制台码页解码，中文 toast/标题会变乱码假失败）；**别在远端命令里放设备侧 `>` `|`**——PS 5.1 递给 ssh.exe 的内嵌双引号会丢，远端 cmd.exe 会把 `>` 抢去做本地重定向（报「系统找不到指定的路径」）。要中文断言就按码点传参（`[char]0x5DF2` 拼），`.ps1` 本体保持 ASCII。只有二进制（PNG）才 `screencap -p /sdcard/x.png` 落盘 + `adb pull` + scp
- **Start-Job 里别用 `cmd /c "adb ..."`**：PS 对含引号参数再转义，cmd 收到坏路径（「系统找不到指定的路径」）；直连 `& ssh <target> <单参数命令串>` 是被验证过的姿势
- **设备 serial 从 `adb devices` 现取**，别硬编码（踩过：`qa-readstate.ps1` 写死 `emulator-5556`，后来设备实际是 `emulator-5554`，脚本整条哑掉）
- 截图落盘用 `cmd /c "adb exec-out screencap -p > file.png"`（PS 的 Out-File 会坏字节流）

**推送与测试**
- 发测试推送：`curl -X POST <ntfy>/<topic> -H "Authorization: Bearer <write>" -H "Title: ..." -d "<唯一正文>"`，断言用正文里的 epoch 唯一串定位条目
- **模拟器默认订阅生产 topic `dsh` + 生产读令牌 = 镜像真手机的全部推送**（方便对照），但作答路由会被模拟器抢走。
- **模拟器订阅哪个 topic 是编译期常量**（`PushService.kt` 的 `WS_URL = wss://ntfy.cpyh.xyz/dsh/ws`，prefs 里没有覆盖口），
  `-Topic` 只改发布端 —— 换测试 topic 时模拟器收不到，`push-received`/`mid-unique`/`entry-unread` 三项必然 FAIL；
  **2026-10-13 更正**：ntfy 的 `global-topic-limit` 已由 5 提到 **50**，但上限只是**第二道门** —— 本机 `auth-default-access: deny` 且逐 topic 精确授权，所以对任何新 topic 发消息一律 **403 forbidden(40301)**（与上限无关）；要跑测试 topic 得先显式授权一个专用 topic：`docker exec ntfy ntfy access <user> <topic> write-only`（订阅方再加 `read-only`），现网已备好 `dsh-verify`（dshpub 写 / dshphone 读）。不加授权就只能
  `-Topic dsh`（代价：手机收到一条 `auto-verify <epoch>` 测试推送，不是 APK 更新通知）。
- 推送正文里别放和断言正则冲突的字样（本项目 mid 断言曾被正文里的 "mid" 字样干扰）

**连模拟器机（笔电）**
- **规则：设备访问一律走 Tailscale 固定 IP，不用 LAN 地址。** 笔电用 `ssh user@<tailnet-laptop>`（同一台机，hostname
  仍是 `<win-host-a>`）最稳；判断"是不是这台笔电"用 `ssh user@<tailnet-laptop> hostname`，别靠 IP。
- **LAN 地址有两个坑，都会让 ssh/scp 静默超时**：① **会漂** —— 2026-10-13 从 `<lan-laptop>` 漂到 `<lan-laptop>`，
  `config.local.ps1` 里的旧值把夜间验收直接打成 SKIP；② **新连接被防火墙拦** —— `ssh user@<lan-laptop>` →
  `Connection timed out`（实测）。地址写错代价很大：那次流水线在第三次 ssh 处静默挂了 **34 分钟**才被人收口，
  所以现在每条 ssh/scp 都带 `-o ConnectTimeout=10` + 看门狗兜底。
- `dsh-emu` 任务（`-gpu host`）在非交互会话里会崩：`emu-err.txt` 里 `glTexImage2D ... 0x502`、
  `LastTaskResult=1`。改跑 `dsh-emu-sw`（`-gpu swiftshader_indirect`）立刻能起；强杀过模拟器先清
  `%USERPROFILE%\.android\avd\dsh-p16.avd\{hardware-qemu.ini.lock,multiinstance.lock}`。
  **别在这台笔电上 `Get-Process chrome|Stop-Process` 之类的广域杀进程**——会连带把 adb/模拟器搞没。
  **2026-10-13 修正（真 GPU 可用）**：笔电有**登录着的 console 会话**时，`dsh-emu`（`-gpu host`）能正常起 ——
  实测 24 秒 boot_completed=1、`screencap` 墙钟 **767ms**（软件渲染要几秒甚至挂死）。所以**别无条件换 sw**：
  先试 `dsh-emu`，崩了再退 `dsh-emu-sw`；而且**别在别人用真 GPU 跑的时候自己切模式**（会毁掉"真 GPU 能否稳住"的观测）。
- **笔电重启后 `sshd` 不会自启**（"远程进不去"的头号原因）：先让用户执行
  `Set-Service sshd -StartupType Automatic; Start-Service sshd`，否则一切 ssh/scp 都是 `Connection timed out`。
- **`adb devices` 看到设备 ≠ 客机健康（这条决定你重试逻辑的顺序）**：客机"框架半死"时 `adb devices -l` 照样
  列出 `emulator-5554  device`，但**每条 `adb shell` 都会永久挂住**（`getprop`/`cmd wifi status`/`ps -A` 全无输出；
  宿主上还会越堆越多的卡死 adb 客户端）。踩过：重试脚本把"设备在不在"当第一判据、冷启动兜底排在它后面，
  于是**被循环开头的第一个 `adb devices` 卡死**，日志里只有 `=== attempt 1 ===` 一行、什么都没干成。
  正确姿势：**每个 adb 调用都要带超时**，并且**第一步就做活性判据**——用带 10s 预算的 `adb shell echo ok`
  （例如 `Start-Job` + `Wait-Job -Timeout 10`），不活就直接上报/冷启动，别去调 `adb devices` 当健康检查。

**WebView 远程调试（量 HTML 布局、点 DOM、驱动应用内浏览器）**
- 应用内浏览器（WebActivity）没导出，`am start -n xyz.cpyh.dshpush/.WebActivity --es url <url>` 就能开；
  socket 名 = `webview_devtools_remote_<应用 pid>`（pid 用 `adb shell pidof xyz.cpyh.dshpush` 取，见下条），
  然后 `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`，在这**笔电本机**用 CDP 驱动
  （`adb forward` 规则在模拟器宿主上，所以 CDP 客户端必须在宿主跑，不能从台式机直连 9222）。
- **`/proc/net/unix` 的路径列会被截断**（显示成 `..._remote_3`），**不要从那里解析 socket 名**：
  名字就是 `webview_devtools_remote_<应用 pid>`，用 `adb shell pidof xyz.cpyh.dshpush` 取 pid 再拼，
  否则 forward 指向不存在的名字，CDP 会报 `other side closed`。
- **devtools socket 只在应用加载过页面后存在**：`am start` 之后要轮询等（约 25s），否则报
  `no webview devtools socket`。`adb root` 会重启 adb server 并清掉 forward，所以顺序必须是
  root → 启动 → 等 → forward。
- 手机横屏/竖屏下 WebView 的逻辑视口就是设备宽度（实测 **412 CSS px**，dpr 2.625），而 v1.9.8 起
  UA 去掉了 `" Mobile"` —— 即"桌面版渲染 + 412px 视口"。这是提问卡/侧栏窄宽度排版问题的前提条件。
- **`Input.dispatchMouseEvent` 的坐标是网页视口坐标，`adb shell input tap` 的坐标是屏幕坐标**：
  应用自己在 WebView 上面画了一条标题栏，所以屏幕坐标要加上那条高度才会落在页面上（实测直接拿
  DOM rect 去 `input tap` 会点空）。要么用 CDP 的 Input 事件，要么先量出 WebView 的屏幕偏移。
- 现成脚本：`powershell -File verify\card-layout-verify.ps1 -DshWebUrl <带 token 的 URL>` 会在模拟器上装机、
  开应用内浏览器、进会话、量提问卡并把 `card-layout.png` + `card-layout-report.json` 拉回本机并打印 PASS/FAIL。
  没有待答卡时（问题已被作答/过期）它会退化成"用真 CSS 类名复刻一张卡"再量，报告里 `cardSource` 注明来源。

**⚠️ 三条 CDP 新坑（2026-10-15 v1.32.11 QA 实测，血亏一轮换来的）**

- **合成鼠标点击会抢走输入焦点**：`Input.dispatchMouseEvent` 点输入框后，`document.activeElement` **不会**落到该输入框，
  而是被 `SECTION._tabHost_*._pane_*` 抢走 ⇒ 之后 `adb shell input text "/"`、`input keyevent 76`、
  连 CDP KeyEvent 三元组（`rawKeyDown`+`char`+`keyUp`）**全都插 0 字符**（静默失败，极易误判成"菜单弹不出来"）。
  **可用姿势 = `el.focus()`（不点击）+ `Input.insertText("/")`**（实测：文本变 `/`、`[role=listbox]` 出现）。
  **同源**：点按钮"点了没反应"也先查 owner —— `Open sidebar` 的合成点击同样被 `_tab_*` 吃掉，
  改用 `el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}))` 才展开。
  诊断：打印 `document.activeElement` 与 `document.elementFromPoint(x,y)` 的 owner（`TESTER.md` §3 第 6 条同思路）。
- **量"哪一层在画背景"不能只读 `backgroundColor`**：注入只写 `background-color`，**不会移除 `background-image`**。
  实测 `Dc7zOa_composerSeat` 的 `background-color` 为 0，底色却来自 `linear-gradient(...)`；surface 类的底色也可能在 `::before/::after`。
  ⇒ 排查"浮层为什么还透"必须同时量 **`backgroundImage` + `getComputedStyle(el,'::before'/'::after')`**，
  否则会**整整漏掉一层**（`verify/qa-overlay-layers.mjs` 已实现，照抄）。
- **浮层 alpha 会"时好时坏"⇒ 必须多次采样**：注入的 `apply()` 会跑 4 次以上（首跑 / `setTimeout 1500` / `4000` / MutationObserver 防抖），
  而浮层**渐进渲染**，**最后一次 `apply()` 读到的高度决定终态**。实测同一个菜单 **Run A alpha=0、Run B alpha=0.92**（同一版本同一操作）。
  ⇒ 凡"透明度/观感"类断言**跑 ≥3 次**并记录终态数值；只跑一次会**两个方向都误判**（把不稳定当"已修好"或当"稳定坏"）。
  依据 `TESTER.md` §3 第 5 条「不确定就复现两次」。

**QA 轮次（唱反调用例库 + 一次跑完整轮的 runner）**

- 章程与用例库：`verify\TESTER.md`（角色/环境硬事实/验收铁律/报告格式/P0~P3）、`verify\testcases\{00-core-flows,01-adversarial,02-ux-polish}.md`；每轮结论报告落在 `verify\QA-ROUND-<版本>.md`。
- 跑一轮：`powershell -File verify\qa-round.ps1`（默认 10 条），聚焦几条就 `-Cases "QA-C05,QA-P04"`。
  它把 `verify\qa-round-driver.mjs` 送到模拟器宿主，**在同一条 ssh 会话里**跑完所有用例（页面内点击走 CDP 真输入，截图一律 `adb screencap` + `adb pull`，每张截图都与同一时刻的 DOM 复核绑定），再把截图与报告拉回 `-OutDir`。
- 报告文件名**带时间戳**（`qa-report-<ISO 时间>.json`），同一天跑两轮不会互相覆盖（首轮就是被覆盖丢过 DOM 证据）；结尾对 <100KB 的截图告警（那是采集失败，不是"页面没变化"）。
- runner **不启模拟器、不切 GPU 模式、不重启笔电**；超过 `-DriverTimeoutSec`（默认 1800s）判 BLOCKED 退出，客机半死时报告 Lead 而不是自己冷启动。

**改应用注入 JS（Kotlin 里内嵌 JS）——两层转义，必须抽出来校验**
- `WebActivity.onPageFinished` 里的注入是一堆 **Kotlin 字符串拼接出来的 JS**，所以**每个反斜杠都要按两层算**：
  Kotlin 源码写 `\\d` → JS 里才是 `\d`。踩过：正则写成 `\\\\d`（Kotlin 4 个反斜杠）→ JS 收到 `\\d` ==
  **匹配字面反斜杠 + d**，`exec()` 返回 null，函数**静默 return**（面板底色没生效，没有任何报错）。
- 校验办法（改完注入 JS 必跑）：把 `.kt` 里那段 `evaluateJavascript(...)` 的**双引号字符串抽出来、按 Kotlin 规则
  反转义（`\\`→`\`、`\"`→`"`）拼成一个 `.js`，再 `node --check` 它（`tmp\extract-patch.mjs` 就是这么做的）。
  顺便核对关键正则的反斜杠个数：源码里应是**两个**反斜杠而不是四个。
- 另一条同源坑：**内联 `!important` 优先级高于样式表 `!important`**。所以想让样式表规则赢，必须让写内联样式的那段
  注入**主动让开这个元素**（例如玻璃化那步加 `skipBg`），光靠 `!important` + 更高特异性压不住。

**验收纪律：肉眼截图是硬门槛，computed style 不算数（2026-10-13 翻车教训）**
- **`getComputedStyle` 说 `position:fixed` + `width:280px`，跟"实际画出来只有 56px 宽被裁"可以同时成立。**
  踩过的实例：玻璃化注入给 `BynINW_sidebarCol`（56px 宽网格列、`overflow:hidden`）加了
  `backdrop-filter:blur(12px)`，而 `backdrop-filter`/`filter`/`transform`/`contain` 会让该元素成为
  **fixed 后代的包含块** → 那条 fixed 侧栏浮层被锚死在 56px 列里再被裁掉；`getBoundingClientRect()`
  仍报 280px，所以只量样式/矩形会误判为"好的"，而真机/截图里只有一条碎片。
- **CDP 的 `Page.captureScreenshot` 拍不出这种裁剪**（同一时刻 `adb screencap` 拍得到）。
  判断"渲染对不对"必须用 **`adb screencap`（或 `adb exec-out screencap -p > file`）**，然后 **自己 `read_image`
  看那张图**。顺带一条：`cmd /c "adb exec-out screencap -p > file"` 偶尔产出 0 字节文件，
  稳妥写法是 `adb shell screencap -p /data/local/tmp/x.png` + `adb pull`，并且**校验文件大小 >100KB**。
- **截图必须和状态复核绑定**：真点击之后**立刻**截图，并在同一时刻用 CDP 复核 DOM 状态
  （展开/收起、可见宽度）。否则会出现"点击成功 → 应用被网络回连触发 reload → 截图拍到回到轨道"的空欢喜。
- 给 fixed 后代做注入时：不要给它的**祖先链**加 `backdrop-filter`/`filter`/`transform`/`contain`；
  非要用就得同时给那些祖先写 `backdrop-filter:none!important` 等中和规则 —— 注意**内联 `!important` 优先级
  高于样式表 `!important`**，所以注入 JS 那边也要跳过这些容器，光写样式表压不住。
- **截图要看整页壁纸，不能只盯改动的那块**（v1.32.6 教训）：主题壁纸是 WebView **后面**的原生 ImageView，
  只有 `adb screencap` 拍得到（CDP 截图里网页透明处显示成白/黑，看不出壁纸）。v1.32.5 把玻璃化的
  `if(大容器)transparent else {45%}` 重构成两个**非互斥**分支，大容器被 45% 白覆盖、多层叠加成 ~91% 白，
  壁纸整个消失 —— 当时验收只看了面板区域就放行了。现成工具：`verify\gate-shot.ps1`（一次 ssh 内：
  重启 WebActivity → 收起态截图 → CDP 点「Open sidebar」→ DOM 复核（大容器必须 `rgba(0, 0, 0, 0)`、
  面板 280px/fixed/alpha）→ 展开态截图 → `screencap -p /sdcard` + `adb pull` 拉回本地），两张图都要 `read_image`。

**装机 / 产物命名（别互相覆盖）**
- **`adb install -r` 对版本降级会静默失败**（`INSTALL_FAILED_VERSION_DOWNGRADE`），旧版本不会被装上、
  仍是新包 —— 做"旧版本对照"必须 `adb install -r -d <apk>`，并在装完后**打印
  `dumpsys package <pkg> | findstr versionCode`** 证明装进去的到底是哪个版本。
- **产物名带版本号**：编译脚本不要把输出写死成某个文件名（踩过：写死 `dsh-push-1322.apk`，
  后面编 v1.32.3/v1.32.4 时把真正的 v1.32.2 包覆盖了，"旧版本对照"装到的其实是新包）。
  统一用 `dsh-push-<versionName>.apk`。
- **`verify\build-install.ps1` 不同步源码**——它只做「vm1 上 gradle + 回传 APK + 装机」，编译的是 vm1 仓里的旧源码。
  改完本地代码必须先手动同步（姿势同 `qa-test.ps1` 开头三步）：`ssh vm1 "rm -rf work/projects/dsh-push/android-app/app/src"`
  → `scp -r android-app\app\src` → `scp android-app\app\build.gradle.kts`。症状极具欺骗性：明明修了编译错误，vm1 还报同一条。
  完整流水线 `dsh-app-verify.ps1` 自带这步（build-vm1 先 rm+scp src/build.gradle.kts/settings/gradle.properties），
  坑只咬单独用 build-install.ps1 的人（v1.32.9 自测实测踩中）。

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

### 版本指纹与竞态纪律（2026-10-15 v1.32.11 实战新增，**四条必需**）

> 背景：本轮**连续三次**出现"**验了，但验的不是那个版本**"——采样横跨换版 / 哈希标签张冠李戴 /
> 误判"构建没生效"。全部源于**没有把"被验的字节"钉死在采样那一刻**。

1. **APK 哈希必须"夹逼"读（bracket）**：**采样前读一次、采样后立刻再读一次**，两者相等且等于冻结哈希。
   探针把期望哈希做成**参数**，不匹配就 **fail-closed 拒绝采样**（本轮 Part B 即如此，输出 `stable=true`）。
   ⚠️ **只写一个哈希、不写"何时读的" = 没有证据**：本轮 Part A 采样于 `00:06–00:16`（当时设备是 0.92），
   哈希却读于 `00:22` 装机**之后** ⇒ 把 **0.92 的数据贴上了 0.96 的哈希**。
   判据命令：`adb shell pm path <pkg>` → `adb shell sha256sum <base.apk>`，
   与 **vm1 产物**、**commit 源码**三者对齐。
2. **判定"构建有没有生效"看 DEX 字面量**（比看哈希/命令行都硬）：
   `unzip -o -q app-debug.apk "classes*.dex" -d /tmp/apkx` 后
   `strings /tmp/apkx/classes*.dex | grep -c "18,24,40,0.96"`。
   ⚠️ **别只看产物 sha256/大小/时间**——同一 hash 可能来自"同源重装"而非"没构建"（本轮 lead 就误判过一次）。
3. **`connect()` 必须有界重试**：冷启后 devtools socket 约 **25s** 才出现，单次 `fetch` 会 `fetch failed`，
   别当成"起页失败/链路坏"。
4. **自愈 fail-closed 会杀模拟器，别当产品故障**：采样中途 offline / `renderer: (COULD NOT READ)`，
   **先查 `emu-ladder.log` 的 `VIOLATION` 行**——那是**加固自愈的既定行为**。
   本轮实测：`VIOLATION` → kill + rung 1 重启，**只重启模拟器、没换 build**（重启后 sha 仍一致）。
   ⇒ **被中断的样本丢弃**，最终结论必须来自**一次连续未中断的运行**（别拼凑跨中断样本当 n=5）。
5. **整页目视要断言 App 进程活着**：并发 `adb install -r` 会**杀掉 App 进程**，此时 `screencap` 拍到的是
   **launcher 桌面**（本轮 Part A 的 `QA-P12` 整页目视因此记 BLOCKED）。
   ⇒ 截图前后各取一次 `pidof`（本轮落地为 `P12_ALIVE before=true/3555 after=true/3555`）。
6. **间歇性缺陷必须 ≥5 次采样**：凡涉及**渲染时机/竞态/渐进渲染/`MutationObserver`** 的改动，
   验收必须 **≥5 次采样**确认"**恒为**"期望值，**且覆盖阈值两侧**。
   本轮真菜单 alpha 曾**同版本、同设备、同操作 n=2 跑出 `0` 与 `0.92`**（`apply()` 与菜单渐进渲染竞态）
   ⇒ **单次绿不能证明修好**。

### 两个"判据侧"探针陷阱（2026-10-15 v1.32.12 新增；会让你**误报**）

1. **一类元素有多个匹配时，必须扫全部取"最高/最大"那个**：
   实测 `[class*='_tabHost']` 有 **6 个匹配**（含**面板关闭时的 `0x0` 占位**）⇒
   `querySelector` 会拿到 `0x0` 那个，把"**面板其实开着**"**误报成"没打开"**。
   **同类陷阱**：v1.32.5 的侧栏（多条同 class 记录）。
   ⇒ 判据写法：`Array.from(document.querySelectorAll(sel))` → 取 `getBoundingClientRect().height`
   **最大的**那个，而不是第一个。
2. **截图/输出路径不能塞进"可选 argv 位"**：`overlay-run.ps1` 只传 `(outJson, tag)` 两个参数，
   **第 3 个参数恒为空** ⇒ 截图**被静默跳过**，却会得出"**截不到图**"的错误结论
   （v1.32.11 就这样误报过一次，白查半天）。
   ⇒ **路径必须硬编码**，或**显式断言参数非空**（空则 fail-closed 报错，别静默 continue）。

### 🔴 "语义特征" ≠ "结构特征"：CSS 注入判据的两条铁律（2026-10-15 v1.32.13 换取）

> 背景：用户指示修「聊天里的大代码块透明」。**难点不是"怎么给它加底"（机制现成），
> 而是"该不该给"的判据** —— 判据写错会**直接复现 v1.32.6「壁纸整层消失」**。

1. **判据 MUST 用「结构量」，MUST NOT 用「语义特征」**
   - **实测反例**：候选判据「**后代含 `pre`/`code`**」**命中 4 个元素**，其中包含
     **`Dc7zOa_root`**（`304x671`，**布局容器/聊天根**）—— 因为**整棵聊天树里本来就含代码块**
     ⇒ 该判据把**布局容器**一起命中 ⇒ `wouldChange=2` ⇒ 多层白叠 ⇒ **复现 v1.32.6**。
   - **正解**：用「**这一层里还套着几层大容器**」这种纯结构计数 ——
     `innerBig` = 后代中「自身也超过 `50%×50%` 视口」的元素个数，判据 `innerBig <= 2`。
     实测**分离度 20 倍余量**：目标 **2** vs `BynINW_frame` **70** / `centerCol` **42** / `Dc7zOa_root` **41**。
2. **判据的失败方向要选「安全侧」：宁可漏修，不可误修**
   - 漏修 = 用户仍见瑕疵，**可以再开一轮**；误修 = 壁纸消失，**等于复现历史事故**。
   - 实证决策：**否掉"类名 OR `innerBig`"**（类名依赖上游 CSS-module 哈希，v1.32.5 教训是"改名即静默失效"；
     多一条分支就多一条会静默失效的路径，且**本轮无证据表明需要这种冗余**）。
3. **附：注入类改动必查的两条量化**（每次都要算，不是"看起来对"）
   - **`wouldChange = ?`** —— 理想是「**恰好且仅有**目标元素」（本轮 = **1**）；
   - **关闭相关 UI 后复跑** —— 本轮**关面板态零变化**（确认没有条件外的副作用）。
4. **🔴 「稳定态测量」≠「动态态安全」**（2026-10-15 v1.32.13→14 实测，代价是一次漏检）
   `innerBig ≤ 2` 在**稳定态**有 **20 倍余量**（目标 `2` vs 三个布局容器 `41/42/70`），
   v1.32.12/13 的 `wouldChange=1` 也**都基于稳定态测量** ⇒ **看起来非常安全**。
   **但 `innerBig` 是"运行时量"** ⇒ **首屏 / 局部重渲染 / 流式生成中后代还没撑开 ⇒ 它会临时失真**：
   实测 `Dc7zOa_root`（稳定态 `41`）在过渡态**掉到 `≤2`** ⇒ 被判成"内容块" ⇒
   按原生色相写出 `rgb(255,255,255)` ⇒ **聊天根在 84%×100% 面积上变不透明白 ≈2s** ⇒ **壁纸被盖**。
   ⇒ **纪律**：**凡判据依赖"运行时测量值"，必须另外验证「该值在过渡态是否会失真」**，
   并**对关键容器（布局/滚动容器）加显式排除** —— **阈值余量不构成保护。**
5. **🔴 注入是"一次性写内联"，而现代前端会"换节点"**（`QA-A32` 抓到真缺陷）
   React 等框架重渲染会**替换 DOM 节点** ⇒ 新节点**不带我们的内联** ⇒
   在**下一次 `apply()`（`MutationObserver` + 400ms 去抖）到达之前**显示**原生背景色**。
   ⇒ **`inline` 为空（`''`）= 注入当前不生效**；**对"原生不透明"的容器，该窗口等于瞬时关闭壁纸通道**。
6. **🔴 测"注入后的样式"必须锁定"注入 settle 之后"**
   判据不是"读到了值"，而是"**读到的值里内联已被写入**"，且**必须连续采样确认稳定**
   （`settledRepeats` 连续 5 次是好做法）。
   ⇒ **报告"某元素值"时必须同时报它的 `inline`** —— 否则无法区分"注入未生效"与"值本来如此"。

## 模拟器测不了什么（正式版仍需真机抽查）

OriginOS 定制层行为：图标陈旧不刷新、后台被杀策略、深链落点、heads-up 白名单、系统下载组件（v1.21.1 已绕开）。模拟器负责的是：功能逻辑、数据层（prefs/DB）、UI 渲染、通知结构、Android 16 平台行为（SELinux/权限/WebView）。

## 版本发布纪律

改代码 → 版本号**只在 `build.gradle.kts` 两处**一起 bump（`versionCode` / `versionName`；App 内显示的版本自 v1.32.17 起运行时从 `PackageInfo.versionName` 派生，`PushService.APP_VER` 已删，没有第三处）→ 验证全绿 → `-Deploy`（链接 `?v=` 必须用 versionCode，缓存击穿）→ 真机验收 → openspec 归档 + git push。

发布前先自证脱敏（不推远端）：`powershell -File verify\export-public.ps1 -DryRun` —— 只跑 scrub 映射 + 密钥闸门，
逐条打印「哪个个人值被替换成了什么占位符」（IP 显示原值，token/用户名只显示计数），命中泄漏就非 0 退出、绝不静默放行。

### 🔴🔴 脱敏闸门的四条铁律（2026-10-15 v1.32.14 事故换取）

> **事故**：公开镜像里 `verify/vm1-dshnet-check.sh` 含**真实内网 IP `<tailnet-vm1>`**，
> **从 `db65c51` 起泄漏了多个版本**（GitHub + Gitee 都有），而 `export-public.ps1` **每次都打印
> `exported to GitHub + Gitee public`、退出码 0** —— **看起来完全正常**。

1. **覆盖面 MUST NOT 用「扩展名白名单」**，要用**「二进制黑名单」**（默认扫一切文本）。
   白名单一定会漏掉"没人想起要加"的扩展名 —— 旧脚本的 `$exts` 里**没有 `.sh`**，
   于是那个文件**清洗跳过、闸门也跳过**。
2. **安全闸门的扫描集 MUST 等于（或宽于）清洗集**。
   旧脚本的闸门**比清洗更窄** ⇒ 同一批文件**两次都漏** ⇒ **闸门越"成功"越危险**。
   （同一 bug 还有一处：`$map` 里三条 LAN 值**本来就在清洗表里**，闸门却只挡了其中一条。）
3. **每次同步后 MUST 独立复查公开镜像**，**别只信脚本自己打印的 `exported`**。
   判据：对公开仓 `git ls-files` 的**全部文件**跑一遍个人值正则 ⇒ **期望 0 命中**。
   （本轮就是靠这一步才抓到已存在多个版本的泄漏。）
4. **同步前先 `-DryRun` 自证** —— 它打印替换计数且**不推送**；
   同时看 `scrub/gate scope: N text file(s)` 确认覆盖面合理（本轮 `339 text file(s)`）。

## 模拟器自愈与 GPU 回退阶梯（笔电 `<win-host-a>`，2026-10-13）

笔电是模拟器机：`dsh-app-verify.ps1` 通过 ssh 过去、清 AVD 锁、起模拟器、装机、断言、截图。
现在**不需要人介入**：计划任务 `emu-selfheal`（Interactive，开机 + 登录 + 每 5 分钟）与
`emu-selfheal-svc`（**S4U**，同样的触发，只管 sshd）一起覆盖"有人登录/没人登录"两种情形，
脚本是 `G:\Android\emu-selfheal.ps1`（ASCII，PS 5.1），判定结果全部写 `G:\Android\emu-ladder.log`。

### 阶梯怎么走

1. **sshd 自愈**：不在 Running 就 `Start-Service`，StartType 不是 Automatic 就顺手设成 Automatic。
   （今天就是因为 sshd 没自启把所有人锁在门外；实测 `Stop-Service sshd` 后跑一次脚本 → `Running` 恢复。）
2. **幂等**：已经有模拟器且 `adb shell` 能回话 → 只写一行 `already healthy`，什么都不动。
3. **rung 1 = 真 GPU**（`-gpu host`），预算 90s；**rung 2 = 软件 GPU**（`-gpu swiftshader_indirect`），预算 240s。
   判据是**客机真的起来**：`adb shell getprop sys.boot_completed` = 1 **且** `adb shell echo ok` 有回应
   —— **`adb devices` 看得到 ≠ 客机健康**（`offline`/框架半死都会骗人）。
4. **僵尸判定**：qemu 在、`adb shell` 连续 3×20s 不回话 → `taskkill /F /T`；10s 后还在（今天那种杀不掉的
   qemu 僵尸）→ 日志写死 **"THIS MACHINE NEEDS A REBOOT"** 并推**一条** ntfy（这是这个脚本唯一会推的情况）。

### 真 GPU 需要交互会话

`-gpu host` 要一个带 GPU 上下文的 console 会话：有人登录着（`query session` 里 `console  <user>  Active`）时
实测 **18s 起好**；`Interactive` 身份的 `dsh-emu` 任务在**没人登录时根本不会运行**，而以非交互身份跑
`-gpu host` 会崩（`glTexImage2D 0x502`）。所以阶梯在检测到"没有交互会话"时**直接跳到 rung 2**（软件 GPU，
`swiftshader_indirect` 冷启实测 24s），而不是白等 90s。

### 踩坑：**锁住的日志文件会让 `run-emu.cmd` 秒退**

2026-10-13 实测：某次强杀后 `G:\Android\emu-out.txt` / `emu-err.txt` 被一个"看不见的"进程占着
（`Get-Process` 里没有 qemu/emulator，但 `[IO.File]::Open(...,'Append')` 报"文件正由另一进程使用"），
于是 `run-emu.cmd` 那句重定向**打不开文件**，`cmd` **6 秒内 exit 1 且一个字节都没写** ——
表现为"真 GPU 起不来"，看着像显卡问题，其实是文件锁。
**阶梯因此不再走 `run-emu*.cmd`**：它自己注册一个一次性任务 `emu-ladder-rung` →
`G:\Android\emu-ladder-rung.cmd`，把 GPU 模式与 AVD 名通过 `emu-ladder.gpu` / `emu-ladder.avd` 两个小文件传进去，
日志写自己的 `emu-ladder-rung.log/.err`（不会撞锁）。`run-emu*.cmd` 保持原样不动
（`20989215E6B5DB02DC777A2B517E67CF` / `BF80AC225A37A5C2F65F6E2898DD53C4`）。

### 验收（2026-10-13 真跑，四条全过）

| 项 | 证据 |
|---|---|
| a sshd 自愈 | `Stop-Service sshd` → `Stopped` → 跑脚本 → `sshd: Running -> Started (StartType=Automatic)` → `Running` |
| b 真 GPU 阶梯 | 杀掉模拟器 → `no emulator process running` → `rung 1: real GPU` → `[host-gpu] boot_completed=1 and shell responsive after 18s` → `RESULT: host-GPU ladder OK in 18s (real GPU)`（qemu 命令行含 `-gpu host`，`adb devices` = device） |
| c 回退 | 用 `-BreakHostRung`（把 rung 1 的 AVD 名换成不存在的名字）→ `[host-gpu] 6s: no qemu process -> attempt failed` → `rung 2` → `[sw-gpu] boot_completed=1 ... after 24s` → `RESULT: software-GPU fallback OK in 24s`；`run-emu*.cmd` md5 前后一致 |
| d 幂等 | 健康时再跑 → 只写 `already healthy: guest responsive, boot_completed=1 -> nothing to do`，不杀不动 |

### 手工用法

```powershell
# 笔电上（管理员）：
powershell -NoProfile -ExecutionPolicy Bypass -File G:\Android\emu-selfheal.ps1     # 走阶梯
powershell -NoProfile -ExecutionPolicy Bypass -File G:\Android\emu-selfheal.ps1 -SshdOnly   # 只保 sshd（S4U 兄弟任务用）
Get-Content G:\Android\emu-ladder.log -Tail 20                                       # 看判定结果
Get-ScheduledTask emu-selfheal,emu-selfheal-svc | Select TaskName,State              # 看两个任务
```
