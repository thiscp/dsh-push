# STATUS task-19：流程优化（脚本化 + 新对话 3 人团队启动配方）

状态：**已完成**（task-21 补齐了发布脚本与探针提拔；仅剩"gradle 提速"与"skill 化"两项，见文末）

## task-21 交付（2026-10-13 晚）

### 1. `verify/release.ps1`（新建，ASCII，已实跑验收）
- 步骤：**[0] 解析目标版本 → [1] 三处幂等同步（build.gradle.kts 的 versionCode/versionName + `PushService.APP_VER`）→ [2] 调既有发布链 `dsh-app-verify.ps1 -Deploy -DeployNote`（没有重新发明）→ [3] 线上 `?v=<versionCode>` 确认（HEAD 取 Content-Length 与本地 APK 比对；行为确认引用当轮 QA 报告）→ [4] `export-public.ps1`**。
- `-DryRun` 只打印步骤与版本 diff，**不写文件、不构建、不上传、不推送**。
- **验收（在 v1.32.8 = 74/1.32.8 上实跑）**：
  - `release.ps1 -DryRun -DeployNote "..."` → 走**"ALREADY SYNCED（三处都已是目标版本）→ idempotent skip"** 路径，步骤清单四段齐全 ✓；
  - 另跑一次 `-DryRun -Version 1.32.9 -VersionCode 75` → 正确打印 `NEEDS EDIT` 与逐项 diff（`versionCode 74→75 / versionName 1.32.8→1.32.9 / APP_VER …`），**跑完磁盘上三处仍是 74/1.32.8/1.32.8**（已核对）✓。
- 参数：`-Version -VersionCode -DeployNote -DryRun -SkipExport -SkipOnlineCheck`。

### 2. 探针提拔进 `verify/qa-round-driver.mjs`（沿用既有约定）
- 新增 **`QA-N1`（离线横幅时序）**：飞行模式开→量横幅入 DOM 的毫秒数（判据 ≤2s）、关→量移除毫秒数；并核对横幅自身属性（文案精确匹配、`position:fixed`+`rect.y=0`、`pointerEvents:none`、`z-index/背景色`）+ 两张截图。
- 新增 **`QA-N4`（横幅下的命中区 + 真实点击复核）**：`elementFromPoint` 网格（视觉中心/视觉四边/命中框两边，逐点记 owner 与 `isBanner`）→ 再对中心点做**真实 CDP 点击**（捕获阶段探针读回实际触发者，探针可撤销 `if(!window.__qaSpy)return;`）；断言"任何探针点都不会返回横幅"+"每个按钮视觉中心命中自己"+真实点击命中自己。
- 沿用 driver 既有约定：证据一律 `adb shell screencap -p /sdcard/...` + `adb pull`（>100KB 校验）；每个用例先 `ensureShell`，"跑了但没量到"= BLOCKED；探针可撤销；单用例 150s 看门狗；报告带时间戳。

### 3. 新增常驻用例 `QA-A19`「命中区几何审计」
- 判据：同层（浮层面板 vs 页面，**不同层不互比** —— 首跑就是这么误报的）同一行的相邻按钮，`中心距 < (A框宽+B框宽)/2` 即 **FAIL**（v1.32.7 round1 的 P1 类 bug 从此机器拦截）；3 档字号 1.0 / 1.15 / 1.5 各跑一遍。
- **CSS360 基线（真 360 宽实测，`innerWidth=360 / dpr=4`；设备已由 Lead 改成 AVD 物理 1440x3168@640）**：

| 相邻对 | gapCentre | halfSum | overlap | 框宽 | 判定 |
|---|---|---|---|---|---|
| Search sessions \| View options | 32 | 32 | **0** | 32 / 32 | ok（相切） |
| View options \| Add workspace | 32 | 32 | **0** | 32 / 32 | ok（相切） |
| Agent Team \| Open in File Explorer | 46 | 25.5 | -20.5 | 28 / 23 | ok |
| Open in File Explorer \| More ways to open | 22.8 | 21.5 | **-1.3** | 23 / 20 | ok（+1.3px 缝） |

  - **1.0 / 1.15 / 1.5 三档数字完全相同**（不随字号漂移），`failures=[]`；
    本轮覆盖 **7 个按钮 / 2 行 / 4 对**（270 宽那一版只有 6 个按钮、1 对，因为 280px 面板超出 270 视口）。
  - `singles=["Collapse sidebar"]` —— 面板里它没有同排邻居，正确地不计入相邻对；`skippedOffscreen=[]`。
  - **QA-N1（同轮 360 复测）**：横幅 **appearMs=153**、**goneMs=2522**，文案/`fixed`+`rect.y=0`/`pointerEvents:none` 全对，横幅宽 360。
  - **QA-N4（同轮 360 复测）**：10 个可见按钮**视觉中心 10/10 命中自己**、**没有任何探针点返回横幅**、真实 CDP 点击命中 `Open sidebar`。
    唯一非绿点：`More ways to open` 的**命中框最右边缘**采样为 `null`（那一像素本来就没有按钮，是缝上的死条，不是误触；它的视觉中心与视觉四边全部命中自己）。

### 4. ~~环境问题~~（已由 Lead 根治）
- 首跑时实测 `innerWidth=270`（guest 只有 density override 640、缺 size override）→ Lead 改成**改 AVD 物理配置**（`config.ini` 的 `hw.lcd.width=1440/height=3168/density=640` + 冷重启），实测 `Physical size: 1440x3168`、无 override、`innerWidth=360 / dpr=4`。
- 结论写进 TEAM-START/TESTER.md（commit `534d3f4`）：**wm override 会丢，以后 override 一律 reset，尺寸走 AVD 物理配置。**
- 附注（历史）：270 宽下 280px 侧栏面板超出视口 10px，`Collapse sidebar` 被裁 —— 那是视口裁切，不是命中区 bug。

## 待办（剩余）
1. **gradle 提速**（`org.gradle.parallel/caching/configuration-cache/jvmargs`，前后各测一次 `assembleDebug` 耗时）——未做。
2. **skill 化 `dsh-push-app-dev`** —— 等用户点头。
3. **CSS360 基线**：`QA-A19` **已按 360 重打完**（上表）；剩 A14/A15/P04 的 411 宽旧基线要在下一轮 QA 里整体重打。

## 已完成（本次提交内容）
1. **`verify/TEAM-START.md`（新建）** — 三角色章程（leader/developer/tester + 写入范围互相钉死）、三个启动 prompt 模板、任务链模板（实现 → 改动验证轮 → 发布）+ 并行化纪律、**环境速查**、"本轮已验证 vs 待下轮确认"分栏。
   环境速查已写入用户点名的新事实：CSS360 同构（`wm size 1440x3168` + `wm density 640`、CDP `innerWidth=360/dpr=4`）、**几何基线全部作废重制（基线版本 = CSS360，v1.32.8 起）**、动态改分辨率挂死 screencap → 冷重启配方（可复用 `tmp\emu-cold-1440.ps1`）、swiftshader vs 真 GPU、桌面 web token 每次重启必换（web.log 取最后一条 + 3081→<tailnet-windows>:3080）、子代理发不了 ask_user_question、timed 由 waterfall 纠正、`claimForeground` 两种作答时序语义（实测 3726ms 即时）、笔电 Tailscale 地址（不要用会漂的 LAN IP）。
2. **`verify/TESTER.md` 附录 A** — 上述硬事实的可执行版 + **新用例 QA-A18 的判据**（watcher 给 `[dsh-push-host]` 行打毫秒时间戳；`answered (foreground)` 即时 vs `returned pending`+`answered (continued)` 折回，参考 `QA-ROUND-v1.32.8.md` 的 `call_5841f145…`）。
3. **`verify/build-install.ps1`（新建，ASCII，PARSE OK）** — `gradlew assembleDebug`（本地、带耗时打印）→ scp 到笔电 → `adb install -r` → `am start -a android.intent.action.VIEW -d <url>`；token **自动**从 `C:\Users\<user>\.dsh\web.log` 取最后一条 `dsh web:` 行，默认 URL 走 `http://<tailnet-windows>:3080/?token=<fresh>`；参数 `-Url/-Apk/-Laptop/-Adb/-Package(默认 xyz.cpyh.dshpush)/-Serial/-SkipBuild/-SkipLaunch`。

## 待办（未完成，规格已定，可直接接手）
1. **`build-install.ps1` 实跑验收**：`verify\build-install.ps1`（不带 `-SkipBuild`）在 v1.32.8 上跑通一次，贴 build 耗时 + 安装 + `am start` 输出。**注意**：脚本尚未实跑过（本次只做了语法与编码自检）。
2. **`release.ps1`（Lead 专用）**：**不要重新发明发布链**，既有单命令发布 = `verify\dsh-app-verify.ps1 -Deploy -DeployNote "…"`（vm1 构建 → 装机断言 → 上传 → 通知，期望 `SUMMARY: 9/9`）。
   规格：版本号三处同步（`build.gradle.kts` ×2 + `PushService` 的 `APP_VER`，**幂等：已是目标版本就跳过**）→ 调 `dsh-app-verify.ps1 -Deploy` → 线上确认（`?v=<versionCode>` 大小比对已在 deploy 步内，行为确认引用当轮 QA 报告）→ `export-public.ps1`。
   `-DryRun` = **只打印将执行的每一步 + 版本号 diff**，不构建、不上传、不推送。
3. **gradle 提速（台式机本地测）**：`android-app\gradle.properties` 加 `org.gradle.parallel=true`、`org.gradle.caching=true`、`org.gradle.configuration-cache=true`、`org.gradle.jvmargs=-Xmx4g`；**前后各测一次 `assembleDebug` 耗时**贴报告。注意 configuration-cache 对 AGP 版本可能报兼容告警 —— 跑不通就只留 parallel+caching+jvmargs，**如实记录**。
4. **探针提拔（任务描述第 4/5 条）**：把 v1.32.8 轮 `tmp/` 现写的横幅/时序计时探针与"真实 CDP 点击复核"探针并入 `verify/qa-round-driver.mjs`；新增常驻用例**"命中区几何审计"**（3 种字号下量全部按钮中心距 vs 命中框宽，重叠自动 FAIL）。**注意**：几何断言必须按 **CSS360** 打新基线，旧 411 宽数字作废。
5. **skill 化（第 8 条）**：把 `TEAM-START.md` 沉淀成 skill `dsh-push-app-dev` —— **等用户点头再做**。

## 红线遵守
只改 `verify/**`；`.ps1` 纯 ASCII；`.cmd` ASCII+CRLF；含中文文件用 .NET 读写；提交只 stage `verify/**`（`gradle.properties` 本次未改动所以未提交）。没碰模拟器、没 `-Deploy`、没发生产推送。