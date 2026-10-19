# QA-ROUND v1.32.9 报告（改动验证轮 · 一键全部已读：状态卡 pill + 撤消息通知 + toast）

```
QA-ROUND v1.32.9 结论: PASS（无 P0/P1，不打回）
用例: 本轮跑 24 项：新功能验收 7（QA-C09 + QA-A20~A25）+ 定向回归 4（QA-C10 逐条已读、qa-readstate 两分支、
      原生 pill 三档字号几何、QA-A19 CSS360 基线）+ 驱动 12（C05/A01/A02/A06/A07/A08/A12/A14/A15/A17/A19/P04）
      + 主流程补测 3（C01/C06/C02 真提问）。
      通过 24 / 首轮阻塞 2（QA-A07 150s 看门狗、C06 第二步探针抢跑——均复跑/复核通过）/ 失败 0。
被测: v1.32.9 / versionCode=75（developer commit 72cf623）；装机 emulator-5554，App 状态卡显示「已连接 (v1.32.9)」
环境: emulator-5554 / 1440x3168@640（CSS360/dpr4，与真机同构）/ adb root / API 36 / 2026-10-13 19:0x–21:2x 本地
证据: F:\work\work_dsh\tmp\shots\qa\（本轮新增 ~40 张图 + acttop/notif/prefs 取证文本，全部 >100KB，
      关键图逐张 read_image 看过）；F:\work\work_dsh\tmp\shots\v1329-qa\（c01/c06）
      回归 JSON：qa-report-2026-10-13T21-04-29.json（12 条）、qa-report-2026-10-13T21-10-41.json（A07 复跑）
      主流程 JSON：task17b-c01c06-report.json、task17b-c06-report.json
```

**结论怎么来的**：一键全部已读的断言四件套（prefs 全 read=true / 消息通知撤净且服务通知仍在 / toast 文案 N 精确 / 整页视觉）实测全绿；6 条对抗角度（新推仍未读、徽章不动、监督者代答被翻、连点幂等、撤通知后仍可作答、cancel 不存在 nid 静默）全绿；被改动邻域（逐条「已读」、作答即已读两分支、命中区几何、面板/字体/主题/断线/滚动/会话切换）**没有一条相对 v1.32.8 基线变坏**，玻璃红线（大容器 `rgba(0,0,0,0)` + veil + 立绘透出）在每张截图里都在。没有 P0/P1 → 不判 FAIL。

---

## 1. 被测物身份

| 证据 | 值 | 来源 |
|---|---|---|
| 版本 | `versionName=1.32.9`（驱动 meta 与状态卡文案「已连接 (v1.32.9)」双处一致） | `qa-round.ps1` VERSION 行 + 每张 App 截图 |
| 行为指纹 ① | 状态卡 statusText 下方存在「全部已读」pill（仅未读>0 可见），坐标从 `dumpsys activity top` 解析：(1136,1324) 352x192 | `acttop-qa-core1791925178-before.txt` |
| 行为指纹 ② | 点击后 toast `TextToastRecord text=已全部标为已读（N 条）`（v1.32.8 无此文案） | `notif-qa-core1791925178-qa-core-after.txt` |
| 行为指纹 ③ | 点击后消息通知逐条 `nm.cancel`（nid==mid），服务通知 id=2 不动 | 同上 + `-late.txt` |

## 2. 本轮口径（Lead 派单原文映射）

Lead：「task-3 认领后开跑改动验证轮：核心 8 项 + QA-C09/A20~A24 + 定向回归（逐条『已读』按钮、qa-readstate.ps1 两分支、QA-A19 几何审计 3 档字号含新按钮）… 报告 verify/QA-ROUND-v1.32.9.md，P0/P1=FAIL 打回」+ developer 手递角度（cancel 不存在 nid 静默 → 落成 QA-A25）。

- 「核心 8 项」沿用 v1.32.8 口径 = QA-C01~C08（映射见 §5）。
- 「QA-A20~A24」+ 新增 A25/C10 全部由 `verify\qa-markallread.ps1`（本轮新资产，纯 ASCII，6 模式 + lib）自动执行。
- 「A19 含新按钮」拆两半：原生 pill 三档字号（`tmp\qa\a19-native.ps1`，复用脚本 lib 模式）+ Web 侧 CSS360 基线（驱动 QA-A19）。
- 红线遵守：没跑 `-Deploy`、没改 App 代码/`config.local.ps1`、没切 GPU、没冷启动、推送全部 qa- 前缀生产 topic 最少条数。

## 3. FINDING 列表

### FINDING-1 [P3] QA-A07 深色主题首轮又超 150s 看门狗（与 v1.32.8 FINDING-1 同款，非本轮回归）
- 首轮 BLOCKED（150170ms 无截图）；复跑 RAN 88953ms，DOM 结论正确（`bodyColor rgb(15,17,21)`、patch 存活、veil=true）。
- 两轮数据合并：复现率 3/4，耗时 80~150s。归因仍待真 GPU 现场（沿用 v1.32.8 建议，不重复计）。

### FINDING-2 [P3] C06 补测驱动第二步抢跑（探针缺陷，非产品缺陷）
- 现象：第一次切换 `match=true`；第二次点「DSH 会话监督者选择」后标题不变 `match=false`。
- 判据：`c06-miss.png` 里侧栏是**收起态轨道**——第一次导航后面板自动收起，驱动 re-expand 与 tap 之间面板又收了，坐标落进聊天区。核心断言（切换成功、标题与内容对应、shell=true）第一步已证。
- 处置：QA 侧待修（tap 前 re-assert 面板展开态）；不挡发布。

### FINDING-3 [info] 本轮钉死的取证硬事实（已同步 README 与 QA-C09 备注，developer 补测同样受益）
1. `input tap` 注入即返回，App 处理点击→cancel→toast 入队要 0.3~0.8s：tap 与 dumpsys 之间**必须隔 1s**（`& ping -n 2 127.0.0.1 >nul &`），否则「通知没撤 + toast 没弹」全假 FAIL（我首轮 3 条 FAIL 即此因；developer 断言②④补测用同法一次过）。
2. PS 5.1 递给 ssh.exe 的内嵌双引号会丢 → 远端命令里**不能放设备侧 `>`/`|`**；prefs/dumpsys 改走 stdout 捕获（job 内 `[Console]::OutputEncoding=UTF8`），PNG 才走 screencap+pull+scp（scp 远端路径要正斜杠）。
3. `Start-Job` 里别用 `cmd /c "adb ..."`（引号被再转义→「系统找不到指定的路径」）；直连 `& ssh <target> <单参数>`。
4. **推送前必须 `am start MainActivity`**：force-stop 后 WS 断开，ntfy 发了没人听（developer 自测收尾 force-stop，直接推会 40s 假 never arrived）。
5. API 36 上 `run-as cp` 读 /sdcard 被 SELinux 拦 → prefs 写回走 root cp + chown + restorecon（adbd 已是 root）。
6. 含中文的 .ps1 被编辑工具重写会**丢 BOM** → PS 5.1 按 GBK 解码中文 → 监督者前缀乱码假 FAIL（qa-readstate.ps1 本轮中招，已补 BOM 修复）。

### FINDING-4 [info] 逐条「已读」不撤通知，一键全部已读撤——语义不对称（设计如此，登记备查）
- `PushService.markRead`（v1.18.0）只翻 read；`markAllRead`（v1.32.9）翻 read + cancel 通知。用户视角：点单条「已读」后通知还在，点「全部已读」通知全没。
- 我首轮 single 模式误按「撤通知」写断言 FAIL，对照源码确认设计后改为「状态不变」断言 → PASS。若产品想让两者一致，改一行即可（超出本轮范围）。

## 4. 新功能验收（QA-C09 四件套 + QA-A20~A25 + QA-C10）

| 用例 | 结果 | 关键实测 | 证据（全部肉眼 read_image 判过） |
|---|---|---|---|
| **QA-C09 一键全部已读四件套** | PASS | tag qa-core1791925178：未读 4→0、两条 read=true、nid 双时点（tap+1s / +10s）都已撤、服务通知 id=2 仍在、toast N=4==tap 前未读、pill 从 acttop 消失 | `qa-core-before/after.png`（after 里 toast 入镜）、`acttop/notif/prefs` 全套 |
| **QA-A20 一键后新推仍未读** | PASS | 新条目 read=false、未读=1、pill 重现；肉眼：新卡蓝点不淡化、旧卡保持淡化 | `qa-newmsg-late.png` |
| **QA-A21 answered 徽章逐字节不动** | PASS | 「【监督者自动唤醒】 qa proxy」tap 前后 `-eq` 全等；__expired 徽章共存 | `qa-answered-*.png`、`qa-inapp-opttap.png` |
| **QA-A22 监督者代答未读被翻已读** | PASS | read=false→true，toast N 计入（Lead 拍板语义） | `qa-answered-after.png` |
| **QA-A23 连点两次幂等** | PASS | 第二下无 N=0 toast（toastN=-1 真实内容断言）、prefs 仍全读、进程存活 | `qa-doubletap-after.png`、`notif-...-tap2.txt` |
| **QA-A24 撤通知后卡片内仍可作答** | PASS | 提问 nid 被撤；optA (418,1769) 真点 → `answered=__expired` + 「这个问题已经过期了」toast | `qa-inapp-opttap.png`（徽章+toast 入镜） |
| **QA-A25 cancel 不存在 nid 静默无害** | PASS | 每轮天然命中（未读条目数>通知数）；六轮进程存活、msgs JSON 完好 | 各轮 A25 断言行 + prefs |
| **QA-C10 逐条「已读」按钮回归** | PASS | tag qa-single1791925128：未读 3→2 只翻自己；自己与其它两条未读的 nid 状态不变；无 mark-all toast；pill 仍可见 | `qa-single-before/after.png`（其它未读卡保持蓝点） |

## 5. 核心 8 项映射 + 定向回归

| 用例 | 结果 | 说明 |
|---|---|---|
| QA-C01 推送落库→列表→内置浏览器 | PASS | `qa-C01-1791926222` ~2s 落库 `read=false`、ENTRY_COUNT 1、MainActivity 焦点、WebActivity `shellReadyMs=1643`、patchCount=1、veil=true | `c01-msglist.png`、`c01-browser.png` |
| QA-C02 提问卡作答→会话继续 | PASS | Lead 真提问 `call_34d76c95d15f4de5b77cf47b`（release-note 文案二选一）：卡片 optA (418,2371) 真点 → prefs `answered=「完整版：一键全部已读——…」`（码点核验 0x5B8C0x65740x7248 前缀）+ read=true；Lead 侧 web.log 指纹 `answered (foreground)`，会话即时继续。**备注（Lead 提供）**：该问 `timed=false` → `note: no timed wait, never enters session projection`——claimForeground=on 下手机作答即时有效但无折回兜底，与 QA-A18 时序语义互补 | `qa-c02-tapped.png`（徽章+回声 toast 入镜）+ Lead web.log |
| QA-C03 通知栏直答 | 未跑 | 本轮没展开通知栏作答（改动不触及通知直答路径；A24 覆盖作答通道） | — |
| QA-C04 快答浮窗 | 未跑 | 本轮未起 QuickAnswer（v1.32.8 已验浮窗本体） | — |
| QA-C05 面板展开/收起 | PASS | 与 v1.32.8 基线数字逐项一致（280/0.92/55.6/0.45/veil） | `qa-C05-expanded/collapsed.png` |
| QA-C06 会话切换 | PASS | 16 真会话行（时间戳过滤），点「dsh-push APP一键全部已读」→ 标题变、shell=true、match=true；第二步 miss=探针抢跑（FINDING-2） | `c06-ok.png`、`c06-miss.png` |
| QA-C07 深浅主题 | PASS | =QA-A07 复跑（FINDING-1 耗时问题沿用） | `qa-A07-dark.png` |
| QA-C08 断线重连 | PASS | =QA-A08：离线横幅「网络已断开，正在等待恢复…」入镜、恢复 `shellBack=true` | `qa-A08-offline/back.png` |
| qa-readstate 两分支 | PASS | A 普通作答→read=true；B 监督者代答→read=false 保持；**顺带修复**：serial 去硬编码 + BOM 丢失导致的 B 分支假 FAIL（FINDING-3.6） | `qa-readstate-b.png`（qa28B 蓝点+已答徽章+已读钮三态同框） |
| 原生 pill 三档字号几何 | PASS | 1.0/1.15/1.5 三档 pill 恒 352x192（≥44dp=176px）、始终在屏内、与卡片按钮零重叠；1.5 档肉眼无裁切；font_scale 已回 1.0 | `acttop-a19native-*-1/1.15/1.5.txt`、`qa-a19native-*-150.png` |
| QA-A19 CSS360 基线（Web 侧） | PASS | 三档字号 4 对按钮 overlap 与 v1.32.8 基线表**数字逐项相同**（0/0/-20.5/-1.3），innerWidth=360 dpr=4 | `qa-A19-geom-font10/115/15.png` |
| 驱动其余（A01/A02/A06/A12/A14/A15/A17/P04） | PASS | 全部与 v1.32.8 基线一致：连点交替 10 态、加载期抢点 shellReady=true、F1 规则三档命中、内层滚动、命中区 7 项 self-hit ok、轨道 55.5 无溢出、滚到底 clearance 133px、P04 仍是已登记的 23 个 <40px 范围问题未变坏 | `qa-A01/A02/A06/A12/A14/A15/A17-*.png`、`qa-report-2026-10-13T21-04-29.json` |

## 6. 没验到的部分（如实）

1. **真机 OriginOS**：pill 在 vivo 桌面通知/后台保活场景无差异数据（本轮全模拟器）。
2. **QA-C03 通知栏直答 / QA-C04 点通知起浮窗**：本轮未跑（改动不触及）。
3. **30 条 msgs 上限边界**：一键已读在 30 条满载 + 大量已答条目下的耗时未量（本轮最多 6 未读）。
4. **桌面 ≥1024px 宽屏**：全程 360 CSS px 窄屏（沿用基线口径）。
5. **A07 深色重载耗时归因**：仍需真 GPU 现场（v1.32.8 遗留）。

## 7. 收尾复位（已实测证明）

`font_scale=1.0` / `airplane_mode_on=0` / `Night mode: no` / App force-stop（cleanup 内置）；prefs 清理两轮：`qa-*` 19 条 + `*qa28*` 4 条删除，保留 7 条真实条目（含 Lead 已答提问）。serial 全程从 `adb devices` 现取。

**到用户真机的推送清单（本轮，全部 qa- 前缀或 QA 会话产生）**：core 6 次×2、newmsg 3、answered 1+回声、doubletap 2×2、inapp 1、single 2、a19native 1、qa-diag 1、qa-readstate 两轮（4 提问+2 回声）、qa-C01 1、Lead 真提问 1+回声——共 ~35 条，prefs 已全部清掉（真机侧通知已撤/已点掉，列表无残留）。

## 8. 给 Lead 的建议

1. **可以发**：一键全部已读（QA-C09 + A20~A25）与全部定向回归无保留意见；FINDING-1/2 都是 QA 侧/遗留项，不挡 `-Deploy`。
2. FINDING-4 的语义不对称（逐条不撤通知 vs 一键撤）值得在 release note 或用户文档里写一句，或下版统一（一行改动）。
3. QA 资产已就位：`verify\qa-markallread.ps1`（6 模式 + lib + cleanup 双模式）、`tmp\qa\a19-native.ps1`、`tmp\qa\task19-c01/c06.ps1`；`qa-readstate.ps1` 已修可复用。
