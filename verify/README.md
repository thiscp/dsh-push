# dsh-app-verify —— APP 一键验证流水线（AI 作业手册）

目标：**任何一台新机器上的 AI，克隆本仓库后照本手册就能把"改代码 → 编译 → Android 16 模拟器装机 → 推送断言 → 截图复核 → 上架分发"整条链路跑起来，全程 0 人工。**

## 拓扑（四个角色，可以同机可以分开）

| 角色 | 现网实例（示例，实际值在 `config.local.ps1`） | 职责 | 关键依赖 |
|---|---|---|---|
| 编排机 | DSH Windows（跑 DSH Web 这台） | 跑 `verify/dsh-app-verify.ps1`，持有到其余三方的 ssh key | ssh + curl.exe + scp |
| 编译机 | Linux VM（ssh 目标写在 `config.local.ps1`） | gradle assembleDebug | JDK17 + Android SDK34 + gradle-8.7 |
| 模拟器机 | 家里笔电（Windows，tailscale 可达） | Android 16 (API 36) AVD 常驻 + adb | WHPX、计划任务 `dsh-emu`、`G:\Android` SDK 树（`emu-bootstrap.ps1` 一键装） |
| 分发/中继 | 云主机（ssh 别名 `aliyun`）+ ntfy 服务器 | APK 下载 `https://<ntfy>/dl/dsh-push.apk?v=<versionCode>`；推送 topic `dsh` | 写令牌发消息、读令牌给 APP |

## 一键用法（编排机上）

```powershell
# 全链路：编译 → 装机 → 发测试推送 → 断言 → 截图（截图在 $env:TEMP\dsh-verify\）
powershell -File verify\dsh-app-verify.ps1

# 常用变体
... -Deploy                 # 全绿后自动上架阿里云，打印 ?v=<versionCode> 链接
... -Fresh                  # pm clear + 重新种 token（干净状态验证）
... -SkipBuild -Apk <path>  # 跳过编译用现成 APK
... -Topic <t>              # 换 topic（默认 dsh 是生产 topic，见下方警告）
```

退出码 0 = 全部断言通过。断言清单：模拟器在线(API) → 编译产物 → install Success → 推送落库（prefs 里能按唯一正文找到条目）→ mid 唯一 → read=false → 截图 >100KB（**必须 read_image 肉眼看截图**，prefs 断言不能替代视觉验收）。

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
- 模拟器**只能**由计划任务 `dsh-emu` 拉起：sshd 退出会杀掉会话子孙进程，nohup/Start-Process 都会死
- 真进程名是 `qemu2.exe`（launcher 是 `emulator.exe`），杀要两个都杀：`Get-Process qemu2,emulator | Stop-Process -Force`
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
- **模拟器默认订阅生产 topic `dsh` + 生产读令牌 = 镜像真手机的全部推送**（方便对照），但作答路由会被模拟器抢走——测作答流程先换测试 topic
- 推送正文里别放和断言正则冲突的字样（本项目 mid 断言曾被正文里的 "mid" 字样干扰）

**PowerShell 5.1（编排/远端脚本）**
- `bash -s` 喂脚本时，脚本里的 **gradle/JVM 会吃掉剩余 stdin**（它后面的行全部蒸发且 exit=0）——所有子命令都要 `< /dev/null` 或先把脚本落成文件再跑
- 脚本文件 ASCII only（BOM-less UTF-8 里的中文会变 ? 且坏正则）；要中文输出就 `chcp 65001 >nul &` 前缀
- 函数参数别叫 `$args`（自动变量，会坏 adb 参数转发）
- **`${var.Method('a','b')}` 内插表达式在 5.1 里静默变空串**（引号把 `${}` 解析截断）——先 `$x = $var.Method(...)` 存变量再插值
- 远端 PS 一律 `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File <path>`，脚本先 scp 上去再跑（远程默认 shell 可能是 cmd，PATH 里没有 powershell）

## 模拟器测不了什么（正式版仍需真机抽查）

OriginOS 定制层行为：图标陈旧不刷新、后台被杀策略、深链落点、heads-up 白名单、系统下载组件（v1.21.1 已绕开）。模拟器负责的是：功能逻辑、数据层（prefs/DB）、UI 渲染、通知结构、Android 16 平台行为（SELinux/权限/WebView）。

## 版本发布纪律

改代码 → 版本号双跳齐（`PushService.APP_VER` + `build.gradle.kts versionCode/versionName`）→ 验证全绿 → `-Deploy`（链接 `?v=` 必须用 versionCode，缓存击穿）→ 真机验收 → openspec 归档 + git push。
