# dsh-push 本地模型开工简报（LOCAL-MODEL-BRIEF）

> 用途：**在新会话里用本地模型（Qwen3.8-125B，窗口 229,376 tok）继续开发 dsh-push 时，第一条消息让模型读这份文件即可**。
> 原来那条会话积累了约 39 万 token 的史前记录，任何 22.9 万窗口的模型都装不下 —— 不要再试图在旧会话里切本地模型。
>
> 维护：每次发版后把「§1 当前状态」的版本号、大小、镜像 commit 更新掉。

---

## §0 一句话

dsh-push = **手机 App**（`xyz.cpyh.dshpush`，大肥鱼盯梢）+ **DSH 插件**（`dsh-push-host`，npm 包）+ **中继**（阿里云 ntfy/provd）。
作用：DSH 在电脑上跑任务，手机收推送、能远程作答、能直接开 DSH 网页、能配对多台设备。

---

## §1 当前状态（2026-11-03）

| 项 | 值 |
|---|---|
| App 版本 | **1.34.11 / versionCode 171**，16926629 B |
| 线上 APK | `https://ntfy.cpyh.xyz/dl/dsh-push.apk?v=171` |
| 博客下载 | `https://blog.cpyh.xyz/dsh-push-latest.apk`（每小时 :17 由 `blog-dl-sync.py` 自动同步） |
| 插件版本 | **0.7.38**（npm `dsh-push-host`，dist-tag latest） |
| 插件 tgz（博客） | `https://blog.cpyh.xyz/dl/dsh-push-host-latest.tgz` |
| 仓库 HEAD | 见 `git log --oneline -1`（1.34.11 提交 `f7afa8d`） |
| 公共镜像 | gitee / github / origin master / github main 四处同 commit（`export-public.ps1`） |
| 文档 | `verify/HANDOVER.md`（§7.x 按事件编号，最新 §7.58）；技能 `C:\Users\<user>\.dsh\skills\dsh-push-app-dev\SKILL.md`（最新 §62） |

**没有未完成的开发任务**。下一步等用户提。

---

## §2 仓库与三端

```
E:\work\work_dsh\dsh-push\
├─ android-app\        Android 工程（Kotlin，无第三方 UI 框架，全手写 View）
│  └─ app\src\main\java\xyz\cpyh\dshpush\   ← 业务代码全在这（约 14 个 .kt）
│  └─ app\src\main\res\raw\                ← 六套主题的 pose_anim_*.webp 动画
├─ host-plugin\        DSH 插件（node，lib/index.js + lib/client.js + lib/remote.js）
│  └─ plugin-selftest.mjs / selftest-pair.mjs / selftest-remote-bin.mjs / selftest-remote-status.mjs
├─ relay\              阿里云侧脚本（provd / ntfy 配置）
├─ verify\             发布与验收脚本 + HANDOVER.md + 本文件
└─ tools\              ComfyUI 生成动画的脚本（Python）
```

| 机器 | 地址 | 用途 |
|---|---|---|
| 本机（笔电 CPYH） | 本地 | 开发 + 发版指挥；DSH Web 在 `127.0.0.1:3081` |
| 构建机 = 测试VM1 | `user@<tailnet-vm1>`，仓 `/home/user/work/projects/dsh-push` | Gradle 构建 APK；也装插件 |
| 工作VM | `work@<tailnet-work>`（用户是 **work**，不是 <user>） | 装插件 |
| 中继 | `root@47.109.50.167`（ntfy.cpyh.xyz / derp / provd） | 推送 + 发号 + 博客 |
| 工作台式机 | `Yzy04@100.109.109.65`（Bitvise SSH；SFTP 根 = `C:\Users\Yzy04\AppData\Roaming\SPB_16.6`） | DSH 桌面版 |
| 模拟器 | `emulator-5556`（AVD `dsh-pixel`，Android 15） | 唯一可用的点击环境 |

⚠️ `emulator-5554` 的 AVD `dsh-p16`（Android 16/API 36）**触屏全设备级失效**，别用。

---

## §3 常用命令（都是实测过的）

```bash
# ---------- 环境 ----------
export PATH="$PATH:/g/Android/Sdk/platform-tools"   # adb
export MSYS_NO_PATHCONV=1                          # adb shell 里的 /sdcard 路径
adb devices && adb -s emulator-5556 shell getprop ro.build.version.sdk

# ---------- App 构建（在构建机上） ----------
ssh user@<tailnet-vm1> 'cd /home/user/work/projects/dsh-push/android-app && ./gradlew :app:assembleDebug'
# 产物：android-app/app/build/outputs/apk/debug/app-debug.apk
# ★ 判代码进没进去：unzip -p app-debug.apk classes3.dex | grep -ac <你新加的符号>
#   （APK 有 classes.dex / classes2 / classes3 三个，体积可能和上版完全一样，别看字节数）

# ---------- App 发布（在本机，一条命令含构建+安装+断言+上传+通知） ----------
powershell.exe -NoProfile -File verify/release.ps1 -Version 1.34.12 -VersionCode 172 -DeployNote "一句话说明"
# 期望输出 SUMMARY: 10/10 passed（第 10 项是四态几何矩阵）
# ★ 本机没有 pwsh 7，必须写全路径 powershell.exe

# ---------- 插件自测 + 发版 ----------
node host-plugin/plugin-selftest.mjs          # 期望全绿（当前 195/195）
node host-plugin/selftest-pair.mjs            # 59/59
node host-plugin/selftest-remote-bin.mjs      # 21/21
node host-plugin/selftest-remote-status.mjs   # 41/41
# 改 host-plugin/package.json 的 version 后：
cd host-plugin && npm publish
# ★ token 必须勾了 Bypass 2FA，否则 403；registry 读延迟 1-2 分钟，npm view 慢一步是正常的

# ---------- 装插件到某台机器（tgz 直投，绕开 npm 缓存） ----------
scp dsh-push-host-0.7.xx.tgz user@<tailnet-vm1>:/tmp/
ssh user@<tailnet-vm1> 'rm -rf ~/.dsh/profiles/web/node_modules/dsh-push-host && mkdir -p ~/.dsh/profiles/web/node_modules/dsh-push-host && tar -xzf /tmp/dsh-push-host-0.7.xx.tgz -C ~/.dsh/profiles/web/node_modules/dsh-push-host --strip-components=1 && bash /tmp/web-restart.sh'
# ★ 笔电自己要重启会断当前会话 → 用一次性计划任务（C:\Temp\dsh-hard-restart.ps1 + reg-restart.ps1）

# ---------- 公共镜像 + 博客手动同步 ----------
powershell.exe -NoProfile -File verify/export-public.ps1
ssh root@47.109.50.167 'python3 /usr/local/bin/blog-dl-sync.py'   # 平时每小时 :17 自动跑
```

---

## §4 环境硬事实（踩过，别再踩）

1. **本机 agent shell 是 bash**（`/usr/bin/bash`），不是 PowerShell；但**没有 pwsh 7**，`powershell.exe` 是 5.1。
2. **`.ps1` / `.cmd` 一律纯 ASCII**：PS 5.1 按 GBK 读脚本，中文注释会把下一行吞进注释里（`git add` 那次和 `$sshCfg` 那次都是这么死的）。
3. `%TEMP%` 在某些上下文是空的 → `Join-Path $env:TEMP x` 得到空串；用 `C:\Windows\Temp\` 或 `C:\Temp\`。
4. Android 上点不动先查：`adb shell dumpsys input | grep ActivityRecordInputSink`；坐标一律取 `uiautomator dump` 的 bounds，**不要靠肉眼看截图**（偏 60–100px 会让你误判成"按钮没反应"）。
5. `uiautomator dump` 卡 idle：先 `settings put global animator_duration_scale 0`（transition/window 同理）。
6. 相册选码：`adb push` 到 `/sdcard/Pictures/q.png` 后必须 `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/q.png`，否则图库看不到。造码用 `node C:/Temp/mkqr.js '<payload>' out.png`。
7. blog.cpyh.xyz 的图片/字体一年 immutable：**换图必须换文件名**（带日期），同名覆盖老访客永远看不到。
8. 插件市场的版本号来自静态 `plugins.json`，**最长滞后 24h**，不是我们没发。
9. ntfy 发推送：`Authorization: Bearer <write token>` + `Content-Type: text/plain` + `--data-binary @file`（内联 `-d` 带中文会被判 attachments）。
10. 长任务别用 `Start-Process` 假装 daemon：ssh 会话一断就被连坐杀掉，要用**计划任务**。

---

## §5 近三个月修掉的真 bug（同类别再犯就是没看这份）

| 现象 | 真因 | 定论 |
|---|---|---|
| 手机「通行证被拒 403」 | 面板只说"已配置"，token 和 topic 并不配对 | 启动时**真打一次** relay 校验 |
| 远程访问永远「隧道建立中…」 | 隧道失败从不回写设置行；上游端口只看状态码 | 0.7.11 回写 + 0.7.17 用**内容指纹**（`dsh-auth` 头 > "authentication required" > HTML > 裸 401）判上游 |
| 桌面版隧道通、页面 502 | 桌面 DSH 同进程绑多个回环口，邻居 401 空正文被当上游 | 同上，指纹排序 + 排除自家网关页/自身监听端口 |
| 作答不推送 | 凭据缺 `host`；`hostToken` 是从别的机器拷来的 | enroll 现发；0.7.21 起凭 regToken 自愈补发 |
| 同一题推两遍 | `tools/pre-execute`（`pq-<uuid>`）与 `user-questions/request`（`call_…:ptc:1`）两个入口 | 10s 内按内容去重 |
| 手机答了网页收不到 | 默认"事后投递"，而会话投影从不携带该题（`state=undefined`） | **0.7.24 起 `claimForeground` 默认 true（持有前台）**，答案直接当返回值交回 |
| 设置里开了却报「未开启」 | 开关只改根节点，默认预设 `ptc` 里的同名条目是 legacy | 0.7.25 起 `phoneAnswerable = timed !== false || holdsForeground()` |
| 插件往错的 topic 发 | schema 默认值 `topic='dsh'` 被当成"用户显式配置"，顶掉凭据文件 | `resolvePluginConfig` 跳过等于默认值的键；**`cred()` 顺序：freshCreds → resolved → readAny** |
| 广播的 web 链接是上一轮 token | 轮询里 `if (web === sentWeb) break` | 改成一直盯到 deadline；token 一变补发 |
| 「保存名称」保存不了 | 面板写 `webName` 不落盘 | 面板只写 volatile（`nameText`），插件用 `ctx.configEditor.edit()` 自己落盘 |
| 改名后重扫出现两行设备 | `Devices.idOf()` 把机器名算进 id | `upsert()` 归并顺序：id → 名字 → **web 的 host:port** |
| 切走对话几秒后被拽回 | `recheckRestoreTarget()` 按值捕获目标仍写 hash | 每拍重读 + `dispatchTouchEvent` 一触即取消 |

---

## §6 关键设计（改代码前先看）

- **配对载荷**：`dshpush://v1?base=&topic=&token=&name=&web=`。`web` 是手机可达入口，`name` 是用户手填的机器名。
- **链接自动续期（修法 2）**：插件每次上线推一条静默消息 `#syslink` + `#web <当前webUrl()> [#name]`；App 收到只更新该设备的 web，不提示、不弹窗。
- **topic 漂移**：`#sysmove` + `#topic` + `#token` + `#web` + `#name`，App 收到原地改行、不重扫码。autoEnroll 换 topic 时必须发。
- **通行证作用域**：中继 `/usr/local/bin/dsh-provd.py`，`GET /list?topic=`、`POST /revoke` 带 `{name, topic}`，三台机器各自只看到自己的（旧行为是所有人都看到同一份、谁都能吊销谁）。
- **设备清单**：主页不再常驻，点**头像**弹出；已吊销的不显示；「＋ 加一台（扫码/相册）」在里面。
- **网页顶栏标签**取设备名（`Devices.nameForWeb()`），跟创建二维码时设的名字走。

---

## §7 工作纪律（用户的硬要求）

1. **首轮**：我改码 + 编译 + 发包上传，**用户自己去下载安装测试**；首轮**不要**跑模拟器端到端（install/push/assert/screenshot/geom-matrix 都不跑）。
2. **只有用户反馈有问题时**，第二轮才开模拟器复现/验证。
3. 每次发版后更新 `verify/HANDOVER.md`（新 §7.x）与技能 `SKILL.md`（新编号），然后 `export-public.ps1` 推四处镜像。
4. 大改前先看 `verify/HANDOVER.md` 对应章节，别重踩。
5. 报告用中文，先给结论，再给判据（命令 + 输出），不吹"已验证"——没跑过就说没跑过。

---

## §8 本文件怎么用

新会话（本地模型）第一条消息发：

> 读 `E:\work\work_dsh\dsh-push\verify\LOCAL-MODEL-BRIEF.md`，读完用三句话复述当前版本状态，然后等我指令。

如果本地模型仍然报 413，说明这份文件 + 系统提示 + 一轮对话已经超过窗口，可以把 §4/§5 折起来（只留 §1/§2/§3/§7），或者按需让模型 `grep` 具体段落而不是整份读入。
