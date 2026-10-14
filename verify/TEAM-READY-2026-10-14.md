# dsh-push 团队就绪记录（2026-10-14 19:1x，leader）

> **本轮目标（用户原话）**：「把 dsh-push app 开发的成员都先建立起来，让他们先把一切准备好，进入随时可以开工的状态」。
> **本文件回答三件事**：① 团队建成了吗、谁是谁；② **队友的模型能不能改**（用户首要提问）；③ 各角色的工具链**实测**就绪状态。
> **配套**：`TEAM-START.md`（章程）、`HANDOVER.md`（§3.11 本轮纠错）、`verify/STATUS-READY-2026-10-14.md`（tester 取证就绪报告）。

---

## 1. 团队构成（3 人，已全部建立并实测在跑）

| 角色 | 目标名 | 模型 | 写入范围（钉死） | 本轮任务 | 状态 |
|---|---|---|---|---|---|
| **leader** | `lead` | `Deepseek-V4.1-Flash` | 全局；**独占发布链**（`-Deploy`）与基础设施 | 编排、验收、发布、交接 | 运行中 |
| **developer** | `developer` | `Deepseek-V4.1-Flash` | `android-app/**`、`host-plugin/**`、`openspec/**` | task-1 工具链就绪自检 | ✅ **READY**（已 complete） |
| **tester** | `tester` | `Deepseek-V4.1-Flash` | `verify/**` | task-2 取证链路就绪自检 | 进行中 |

判据：`list_agents` 返回三行，每行带 `model` 字段；两个队友的 `provider` 均为 `spawn`（**这是子代理 provider，不是 LLM 路由**）。

---

## 2. **能不能改队友的模型？——不能（本轮首要问题的结论）**

**结论：Agent Teams 队友的模型在 `spawn_teammate` 那一刻继承 Lead，之后没有任何工具能改。**

| 项 | 事实 | 判据 |
|---|---|---|
| `spawn_teammate` 入参 | 只有 `name` / `description` / `prompt` / `context` —— **没有 `provider` / `model`** | 工具 schema；skill `dsh-team-model-control` §0（源码行号 `dsh-experimental-tool-agent-team/lib/index.js:242-266`） |
| 队友模型来源 | **`spawn` 那一刻 Lead 会话的模型** | `dsh-experimental-agent-team/lib/index.js:444-458`、`:698`（取自 `root.options.model`） |
| 之后能否改 | **不能**：团队工具集里**没有** set-model，也**没有** kill-member；`interrupt_agent` 只打断当前回合、不重置模型 | 工具清单实测 |
| **唯一可靠杠杆** | **先定 Lead 模型 → 再 spawn** ⇒ 队友继承 | 本会话实测：Lead = `Deepseek-V4.1-Flash`，两个队友均 = `Deepseek-V4.1-Flash` |
| 面板上的模型标签 | **纯显示、点不动**（卡片可点 = 切换"当前成员"，不是模型选择器） | client UI 源码；skill §4 |
| `allowedModels` 清单 | **只管子智能体族**（`subagent`/`subagent_fork`/`workflow`），**不覆盖 Agent Teams 队友** | skill §3；prompt 在**会话创建时**钉死，改设置后须**新开会话** |

**要给队友换模型的唯一做法**：**新开一个对话** → 先把 Lead（本会话）模型选成目标档 → 再 `spawn_teammate`。
（本会话已经 spawn 完，所以**本会话内换不了**；要换只能下个新对话重来。）

**需要"多模型并行"的活**：用 `workflow` 的 `agent(prompt, {provider, model})`——它**不受会话代际限制**，本会话即可用。

---

## 3. 任务链（已入板，含依赖与并行纪律）

| id | 任务 | owner | 状态 | 依赖 |
|---|---|---|---|---|
| task-1 | developer 就绪自检：工具链 + 宿主插件基线端到端验证 | developer | ✅ completed（**READY**） | — |
| task-2 | tester 就绪自检：模拟器档位 + 截图/起页/CDP 取证链路 + 用例库盘点 | tester | ✅ completed（**A–E 全绿**，F 已由 lead 提交转绿） | — |
| task-3 | App 侧流水线就绪自检：vm1 构建 + 模拟器装机端到端（**不发布**） | developer | ✅ completed（**READY**，exit 0 / 24s，零发布） | ~~task-2~~ 已解锁 |
| task-4 | 修 H-1：QA 起页链缺 `adb root` | tester | ✅ completed（**FIXED**，回归 7/7，lead 复核并提交 `44129b4`） | ~~task-3~~ 已解锁 |

**为什么这两组必须串行（不是形式主义）**：只有**一台**笔电模拟器（`emulator-5554`）。
- task-3（developer 装机）↔ task-2（tester 截图/起页/`adb root`）：并发会互相污染（装机换版本 / `force-stop` 关掉被测页 / `adb root` 清掉 CDP forward）。
- task-4（tester 改 `adb root`）↔ task-3：developer 特意**把 adbd 的 root 态留给 tester**，所以 task-3 跑完才能动 root。
⇒ 纪律：任务描述里凡出现 `adb install` / `am start` / `force-stop` / `adb root` 的，先问"另一端是否也在用这台模拟器"，是则用 `blocked_by` 串行。

---

## 4. developer 就绪结论（task-1，✅ READY）

| 项 | 断言 | 实测 | 判定 |
|---|---|---|---|
| A | 宿主插件 selftest | **`101/101 checks passed`，exit 0** | ✅ 绿 |
| B | vm1 构建机可达 + 工具链 | ssh exit 0；`openjdk 17.0.20.1`、`/home/user/android-sdk`（build-tools/platforms/platform-tools/licenses 齐）、`gradlew` 可执行、`openspec 1.14.1`、`~/.local/bin/node` v22.22.3 **带 `stripTypeScriptTypes`** | ✅ 绿 |
| C | openspec 校验 | **修复前 RED** → 修复后 `validate --changes --strict` **3 passed / 0 failed**、单 change strict **exit 0** | ✅ 已转绿 |
| D | 版本号三处一致 | `versionCode=76` / `versionName="1.32.10"` / `APP_VER="1.32.10"`（台式机与 vm1 各 3 行全等） | ✅ 绿 |
| E | 工作树 | developer 范围内干净（脏项均属 lead/tester 范围） | ✅ 范围内绿 |

**本轮由 developer 发现、lead 亲自复跑确认的 4 条纠错**（详见 `HANDOVER.md` §3.11）：
1. **selftest 真基线 = `101/101`，不是 `82/82`**（82 是 0.2.0 之前数字；`2c971ec` 补 4 条回归后 82→101）——**lead 已改** skill §2.1 与 HANDOVER。
2. **selftest node 路径纠正**：真路径 `D:\programs\dsh\resources\runtime\primary-runtime\dependencies\node\bin\node.exe`（**`app.asar` 不在路径上**）。
3. **`openspec validate --strict` 是无效用法**（`Nothing to validate` + exit 1）⇒ **必须带目标**（`--changes` 或 `<change> --type change`）。
4. **vm1 仓是陈旧快照**（`HEAD 92147dd`，与台式机 `f2fbd20` 差 54 ahead / 198 behind，工作树脏、`host-plugin/` 不存在）⇒ **上机前必须确认已 scp 同步**。

**本轮修复的一处既有缺陷（lead 复核并提交）**：commit **`c215691`** ——
`openspec/changes/dsh-push-web-link-out-of-box/specs/dsh-host-plugin/spec.md` 的 MODIFIED 需求
「提问推送（宿主插件路径）」**漏抄现网 scenario `载荷缺字段`**（现网 spec:48），正撞 AGENTS.md 红线
（MODIFIED 整块替换现网 ⇒ 漏抄 = 删场景 ⇒ `openspec archive` 会被拒）。引入于 `168cd03`。
修法：逐字照抄插回 delta 第 31 行之后，**+5 行、零删改零润色**。
判据（**lead 独立复跑**）：`tools/openspec-modify-check.mjs` → `2 modified requirement(s) checked, 0 problem(s)` exit 0；
vm1 真 CLI 单 change strict exit 0、`--changes --strict` 3 passed / 0 failed。

---

## 4.5 tester 就绪结论（task-2，A–E 全绿 / F 已转绿）

**结论：RED → 实质 READY**。红项只有 **F 工作树**，且那是**自指**（报告自身未提交 ⇒ 必然非空）+ 混着 lead 的在飞编辑；
lead 已用一次提交（`f7c2c27`）把 F 清零 ⇒ **A–F 全绿**。

| 项 | 断言 | 实测 | 判定 |
|---|---|---|---|
| A | 档位闸门 | `emu-gpu-verdict.ps1` → **exit 0**，renderer = `NVIDIA GeForce RTX 4060 Laptop GPU`，1s。旁证 `-SelfTest` **6/6**（证明它会报 3/4，**不是恒 PASS**） | ✅ 绿 |
| A′ | 几何 | `wm size/density` = **1440x3168 / 640**；CDP 实测 **innerWidth=360 / dpr=4** | ✅ 绿 |
| A″ | 自愈未误杀 | 全日志 **`VIOLATION` 0 行、`NEEDS A REBOOT` 0 行** ⇒ 自愈本轮**没 kill 过**，无需当故障解释 | ✅ 绿 |
| B | 截图链路 | **2,036,754 B**（门槛 20 倍），**tester 亲自 `read_image` 看整页**：状态栏/壁纸/Dock/dshpush 图标红点/手势条完整，无花屏无裁剪。耗时旁证：本地 adb 465–654ms(n=4)、经 ssh 1.39–1.92s(n=3) | ✅ 绿 |
| C | 起页链路 | 取 `web.log` **最后一条** token（len 43）→ `http://<tailnet-windows>:3080/?token=…` → force-stop → `am start …WebActivity` → **`topResumedActivity=…WebActivity`**，肉眼确认是真 DSH Web（「DSH 网页·台式机」/Chat/Trajectory/输入框/立绘透出），**不是 authentication required** | ✅ 绿 |
| C′ | CDP | forward `tcp:9222→…webview_devtools_remote_4780`；`/json/version` = `xyz.cpyh.dshpush` Chrome/133；`/json/list` 1 target；`Runtime.evaluate` 拿到 innerWidth=360/dpr=4 | ✅ 绿 |
| D | 工具链解析 | `qa-round.ps1`(4289B) / `gate-shot.ps1`(6557B) / `card-layout-verify.ps1`(14866B) 全在，**parseErrors=0、非 ASCII=0**（只解析未真跑） | ✅ 绿 |
| E | 用例库盘点 | **3 文件 / 45 条**有标题用例（C10+A25+P10）；另有 **6 条只在 runner**（`qa-round-driver.mjs` 的 `CASES_IMPL` 16 个 key）⇒ A17/A18/A19 编号缺口**不是丢用例**。**411 宽失效基线 = QA-A14 / A15 / P04**，已就地加 ⚠️ 作废标注（**只加标注，未动步骤/断言/预期**） | ✅ 绿 |
| F | 工作树 | 原 5 行脏；lead 提交 `f7c2c27` 后**干净** | ✅ 已转绿 |

**tester 额外贡献的两条工具事实**（值得记）：
- **token 提取在"被 DSH 独占锁的 `web.log`"上仍可用**：`Select-String` OK，而 `File.ReadAllLines` 直接抛 IOException ⇒ **别改写法**。
- 笔电上 `-Node D:\Program\nodejs\node.exe` 真实存在（v22.14.0）。

**tester 显式列出的 BLOCKED / 未覆盖（下轮别当已验）**：
U-1 `gate-shot`/`card-layout-verify` 未真跑；U-2 `qa-round` 未真跑任何用例（本轮替代证据 = C+D）；
U-3 QA-A10/A16 的版本相关几何数字未标注；U-4 CDP **真输入**（`Input.dispatchMouseEvent`）未验，只验到 `Runtime.evaluate`；
U-5 截图耗时未按稳态口径 n≥3 重打（仅旁证）；U-6 真机 OriginOS 未覆盖；**U-7 H-1 未修**（→ **后已由 task-4 修复，见 §4.6.1**）；U-8 本轮 0 条 ntfy。
**并声明：无任何一条结论建立在"跑了没量到"之上。**

---

## 4.6 ✅ H-1（已发现 → 已开 task-4 → **已 FIXED**）

### 4.6.1 修复结论：FIXED（lead 独立复核 + 提交 `44129b4`）

| 文件 | 改动 |
|---|---|
| `verify/qa-round-driver.mjs` | 新增 `requireRoot(tag)`（`whoami` 断言 + **fail-closed throw**；`whoami` 带 15s 超时，wedged guest 不挂死整轮），**三处**调用：① `startApp()` 开头 ② `connect()` 开头（**forward 之前**，把不变量钉在最底层）③ `QA-A02`（**原代码第二处起页点，最易漏**） |
| `verify/gate-shot.ps1` | 起页前补 `& $adb root` + `whoami` 断言（**非 root 即 `exit 1` 打印 `BLOCKED:`**）+ `topResumedActivity` 自证行；照 `card-layout-verify.ps1:220` 写法对齐 |
| `verify/card-layout-verify.ps1` | **未动**（本来就对） |

**① 顺序铁律是"承重的"，不是保险条款（实测 CONFIRMED）**：
tester 第一版实验**翻车**——显示"`adb root` 后 forward 仍非空"，看似顺序无所谓。按纪律**先怀疑判据**，根因是那一步 adbd **本来就是 root**、`adb root` 只是 no-op（原文 `adbd is already running as root`）。
重做（先降非 root → 建 forward → 再真 root）：
```
whoami = shell
forward AFTER create (non-root) = 'emulator-5554 tcp:9227 ...'
adb root said: restarting adbd as root
forward AFTER a REAL 'adb root' = ''      <- 被清掉
ORDER_PROOF = CONFIRMED
```
⇒ **若把 `adb root` 放在 forward 之后，CDP 链路会被静默清空** —— 这个顺序要求必须保留。

**② 回归 7/7 PASS**（先 `adb unroot` 造出 H-1 条件，再让修复后的 driver 自救；只跑最小 1 条 `QA-C05`）：
非 root 被检出并 `adb root` ✅ / `whoami=root` ✅ / `topResumedActivity=WebActivity` ✅ / **`forward --list` 非空** `emulator-5554 tcp:9225 …` ✅ / `SHELL_READY=true` ✅ / **用例真 RAN**（CDP 端到端 4962ms）✅ / `ROUND_DONE` ✅。
**负对照**（证明断言承重）：修复后再手工 `adb unroot` 起页 → `SecurityException=True`。

**③ lead 独立复核**（不只信报告）：两文件 **非 ASCII=0 / 无 BOM**；`gate-shot.ps1` `Parser::ParseFile` **parseErrors=0**；`qa-round-driver.mjs` **`node --check` rc=0**；`requireRoot` 出现 4 处（1 定义 + 3 调用）；`gate-shot` 内确有 `adb root`。

**④ 设备与 root 态已复原**：`whoami=root`（**复原，未破坏 developer 留给 tester 的 root 态**）、`pidof` 空、`forward --list` 空、`font_scale=1.0`、`airplane=0`、无 `wm` override。

**报告**：`STATUS-READY-2026-10-14.md` 新增 **§8 H-1 修复记录**（8.1 复现 / 8.2 改动+diff / 8.3 回归+负对照 / **8.4 顺序反证含判据翻车** / 8.5 复位 / 8.6 交付物）；
**U-7 → ✅ 已修**、**U-2 → 已覆盖**（最小 1 条）、**U-1 → 部分覆盖**（`gate-shot` 新 root 块只解析未真跑）。

---

## 4.7 🔴 H-1 的发现过程与机理（保留原记录，供追溯）

**lead 已独立复核为真（代码级计数）**：

| 脚本 | `adb root` 命中 | `WebActivity` 命中 |
|---|---|---|
| `verify/card-layout-verify.ps1` | **有**（`:220` `& $adb root`；`:78` 注释「adb root restarts the server and drops previous forwards」） | 6 |
| `verify/qa-round.ps1` | **0** | 0（起页在 driver） |
| `verify/qa-round-driver.mjs` | **0**（`:169-171` 直接 `am start`） | 2 |
| `verify/gate-shot.ps1` | **0** | 3 |

**机理**：`am start -n xyz.cpyh.dshpush/.WebActivity` 隐式要求 **adbd 为 root**；非 root（uid 2000）时报
`SecurityException: Permission Denial: … not exported from uid 10216`（Activity 未导出）。`adb root` 后立刻成功（tester 首次即因此失败）。
**为什么现在更要紧**：README L83 记「模拟器重启后 adbd 掉回非 root」，而**加固后的自愈会在检出 CPU 软渲染时主动重启模拟器**
（见 `INFRA-HEALTH-2026-10-14.md` §9）⇒ 触发概率**比过去更高**，一旦发生整轮 QA 起页会 BLOCKED。
**修法**：`adb root` 必须排在**任何 forward 之前**（root 会重启 adb server 清掉 forward）+ 起页前 `whoami` 断言为 root，否则报 BLOCKED。
**已开 `task-4`**（owner=tester，`blocked_by: task-3` —— 两者都要动同一台 `emulator-5554`，必须串行）→ **已 FIXED，见 §4.6.1**。

---

## 4.8 developer task-3 结论：App 侧流水线端到端跑通（✅ READY，零发布）

**执行**：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File F:\work\work_dsh\tmp\task3-nopublish-run.ps1` → **exit 0 / 24 秒**。

| 项 | 断言 | 实测 | 判定 |
|---|---|---|---|
| A | 是否能用 `dsh-app-verify.ps1` 走"不发布" | **没有可用组合** ⇒ 不调用它，改手工三件套（三条判据见 §5.5） | ✅ 有意绕开 |
| B | vm1 真构建 | **`gradle clean assembleDebug`** → `BUILD SUCCESSFUL in 8s`、exit 0；APK `10,992,184 B`、sha256 `663FEB91…`、**mtime = 构建时刻**（确为本次新产出）。环境：JDK `17.0.20.1`、Gradle `8.7` | ✅ 绿 |
| C | 装机（**三段哈希闸门全绿**） | 源码闸 `PushService.kt` 台式机==vm1 `4FCA7D41…`；回传闸 vm1==台式机 `663FEB91…`；笔电闸 `G:\Android\dsh-push.apk`==产物 `663FEB91…`；`INSTALL: Success`；**`versionName=1.32.10` / `versionCode=76`**（与 HANDOVER §3.11 相符，无出入） | ✅ 绿 |
| D | 不发布（**机械证明**，非口头） | 三个执行文件全文检索 `ntfy\|curl\|Deploy\|aliyun\|POST\|adb root` → **零命中**；流程只含 `scp`+`ssh`+`gradle`+`adb install/dumpsys/force-stop` | ✅ 绿 |
| E | 复位 | `force-stop` 已执行、`pidof` 空、`adb forward --list` **前后皆空**、`font_scale=1.0`；**未动 `adb root`**（root 态留给 tester task-4）；**仓库零新增** | ✅ 绿 |

**developer 自查出并自曝的两个"不合格证据"（价值很高，已沉淀）**：
1. **首跑 B 项是弱证据**：`gradle assembleDebug` 显示 `35 actionable tasks: 1 executed, 34 up-to-date` ⇒ **近乎 no-op，不能证明"现在能构建"**。
   改为 **`clean assembleDebug`** 重跑（`16 executed`），并以 APK mtime = 构建时刻佐证。
   > 纪律：**"命令成功"不等于"真的做了活"**——构建/校验类证据必须看**实际执行任务数**或产物 mtime，别只看 `BUILD SUCCESSFUL`。
2. **首跑差点又造一个假 FAIL**：step 4 用嵌套引号 `ssh host "powershell -Command \"…\""` 取笔电哈希 → 引号层被绞碎 →
   误报 **`LAPTOP APK HASH MISMATCH`**，而**文件其实早已 scp 成功**。
   修法：把该步合进笔电侧 `-File` 脚本（用 `-ExpectSha256` 做闸门），**不再走嵌套引号**。
   > 与 tester 的 `-EncodedCommand` 截断坑同源：**跨 ssh 传复杂命令，一律 `scp` + `-File`**。

**task-3 对任务描述的两处纠错**（以实测为准，已写入 skill 与 TEAM-START §3.3）：
① vm1 **`gradle` 不在 PATH**（须 `export PATH=$HOME/gradle-8.7/bin:$JAVA_HOME/bin:$PATH`）；
② **`android-app/local.properties` 已含 `sdk.dir`** ⇒ SDK **不必**显式给。

**复用产物**（在 `F:\work\work_dsh\tmp\`，**未进仓**，均语法校验过）：
`task3-nopublish-run.ps1`（总编排）、`task3-cleanbuild-vm1.sh`、`task3-install-laptop.ps1`、`dev-task3-runbook.md`（手册）。

---

## 5. 角色就绪判据（"随时可开工"的定义，下轮照此复核）

一个角色算就绪，**必须每条都有实测输出**，不接受"应该可以"：

| 角色 | 就绪判据（全绿才算 READY） |
|---|---|
| **developer** | ① selftest `101/101`（用正确 node）；② vm1 ssh + JDK17 + SDK + gradlew 可执行；③ `openspec validate --changes --strict` exit 0；④ 版本号三处一致；⑤ 范围内工作树干净 |
| **tester** | ① `emu-gpu-verdict.ps1` **exit 0**（真 GPU，非 3/4）；② 截图链路 >100KB 且**自己 `read_image` 看过**；③ App 起页链路（token 现取 + force-stop + start + 截图确认）；④ QA 脚本可解析；⑤ 用例库盘点并标出依赖旧 411 宽基线的用例；⑥ 工作树干净 |
| **leader** | 生产 DSH 健康（3081/3080 在听、插件 0.2.1）；发布链可用（`-Deploy` 期望 `SUMMARY: 9/9`）；笔电模拟器真 GPU；交接文档同步 |

**"BLOCKED ≠ PASS" 纪律**：判不了（exit 4 / 无响应 / 没量到）一律记 BLOCKED，**不得**记为通过。这条本轮已被两次真实假判（假 PASS / 假 FAIL）证明必要。

---

## 5.5 ⚠️ 本轮最有价值的一次拦截：`dsh-app-verify.ps1` 会静默推用户真机

**发现者**：developer（task-3 只读准备阶段）。**lead 亲自读源码复核成立**，已沉淀为 `HANDOVER.md` §3.12。

**问题**：`verify\dsh-app-verify.ps1` **没有"只构建不发布"模式**。不传 `-Deploy` 只跳过了第 6 段（上传 aliyun + 更新通知），
**第 3 段的测试推送是无条件的**：

| 事实 | 判据 |
|---|---|
| `Stage "publish"` 无条件 `POST ($ntfy + "/" + $topic)` | `verify/dsh-app-verify.ps1:319` → `:321`，**不在任何 `$Deploy` 守卫内** |
| 全文仅一处 `$Deploy` 守卫 | `:398` `if ($Deploy -and …)`，只管第 6 段 |
| **命令行 `-Topic` / `-Ntfy` 改不动它** | `:54` `config.local.ps1` 在 param 块（`:29-45`）**之后** dot-source；该文件自述 *"override script param defaults (but also override same-named command-line args)"* |
| 现值即生产 topic | `config.local.ps1`：`$Topic = "dsh"`（原文注释 *"production mirrors to real phone!"*） |

⇒ **不加 `-Deploy` 跑它，用户真机照样收到一条 `auto-verify <epoch>` 卡片。**
**后果**：一次"做个自检"就会惊动用户手机，且违反「QA 一律 `qa-` 前缀」纪律。

**裁决（lead）**：task-3 **不调用该脚本**，改走 developer 提供的**手工最小三件套**（零 ntfy）：
vm1 `gradle assembleDebug` → `scp` APK → 笔电 `adb install -r` + `dumpsys package … versionName` + `am force-stop`。
若要验脚本本身，须先把 `config.local.ps1` 的 `$Topic` 临时改为 `qa-…`（属 tester/lead 范围）验完还原。

**task-3 执行包（developer 已备好，3 个文件在 `F:\work\work_dsh\tmp\`，未进仓）**：

| 文件 | 作用 | 自检 |
|---|---|---|
| `task3-nopublish-run.ps1` | 总编排 1→5 步；**不调用** `dsh-app-verify.ps1`，全文无 ntfy/curl/POST/aliyun/`-Deploy` | 纯 ASCII + PS parse 0 error |
| `task3-build-vm1.sh` | vm1 `gradle assembleDebug`（显式 `JAVA_HOME` + `$HOME/gradle-8.7/bin`） | 纯 ASCII + `bash -n` OK |
| `task3-install-laptop.ps1` | 笔电侧 install + 版本核对 + force-stop | 纯 ASCII + PS parse 0 error |

**两条由 lead 要求、developer 已实现的硬闸门**：
1. **防"构建陈旧源码"**：构建前先按 `:191-194` 顺序同步 src，并**比对 `PushService.kt` 的 sha256（台式机 vs vm1），不一致即 abort**
   —— 直接对冲 `HANDOVER` §3.11 的「vm1 仓是陈旧快照」。
2. **防"装旧包"**：APK 是**三段哈希闸门**（vm1 产物 → 台式机 `%TEMP` → 笔电 `G:\Android\dsh-push.apk`），任一段不符即 abort；
   装机后**再用 `versionName`/`versionCode` 核对**，不假定 `Success` 等于装对版本。

**边界（developer 守住）**：执行包**不启停模拟器、不切 GPU、不冷启**；档位只消费 tester 的 task-2 结论。

**顺带三条环境事实（已核实，写入 HANDOVER §3.12）**：
- **vm1 `gradle` 不在 PATH** ⇒ 须 `export PATH=$HOME/gradle-8.7/bin:$JAVA_HOME/bin:$PATH`；`JAVA_HOME=/usr/lib/jvm/java-1.17.0-openjdk-amd64`（脚本 `:197` 硬编码，实测在位）。
- **`android-app/local.properties` 已含 `sdk.dir=/home/user/android-sdk`** ⇒ SDK 不必显式给（**与 TEAM-START 旧描述出入，以此为准**）。
- vm1 Gradle **8.7**。

---

## 5.6 总体就绪结论（截至 2026-10-14 19:2x）

| 角色 | 就绪 | 依据 |
|---|---|---|
| **developer** | ✅ **READY** | task-1（工具链 §4）+ task-3（App 侧端到端 §4.8）全绿 |
| **tester** | ✅ **READY** | task-2（取证链路 A–E 全绿 §4.5）+ **task-4（H-1 已 FIXED，§4.6.1）** |
| **leader** | ✅ **READY** | 生产 DSH 健康、发布链可用、笔电真 GPU、交接文档同步 |

**⇒ 团队已进入"随时可以开工"状态**：写 App 功能（developer 构建→装机链路已端到端验证）、
跑 QA 取证（tester 档位/截图/起页/CDP 全通 + **H-1 已修**）、发布（leader 一条命令，期望 `SUMMARY: 9/9`）三条路径**都有实测判据**，
不再有"第一次摸环境"的隐性成本。

**四个任务全部 completed**：task-1 READY / task-2 A–E 全绿 / task-3 READY / task-4 FIXED。

**开工前建议先做的一件事**：确认 `diff <(git show HEAD:verify/...)` 之类**没有未提交变更**，并跑一次
`verify\emu-gpu-verdict.ps1`（exit 0）与（若改 host-plugin）`plugin-selftest.mjs`（101/101）。

---

## 6. 未就绪 / 待办（诚实列出，别让下轮当已验）

1. **task-4 已闭环**（H-1 已修，回归 7/7）；`STATUS-READY` 的 **U-7 已转已修**。**剩余未闭环项仅下列几条。**
2. ✅ **已闭环（2026-10-14 20:00 真机验证 FIXED）**：~~「软渲染实例被自愈 kill+重启拉回真 GPU」仍未真机验证~~
   用户批准后由 lead 实测：造出真 SwiftShader 实例 → 生产自愈 37s 内 `VIOLATION → kill → rung 1 -gpu host`，
   **渲染器回到 NVIDIA RTX 4060**、`LastTaskResult=0x0`、选择器还原 `host`。
   详见 `INFRA-HEALTH-2026-10-14.md` §9.7（含时间线/日志原文/两条如实说明）。
   **🔎 附带实测（§9.7.5）**：自愈重启模拟器**真的把 adbd 打回非 root**（`whoami=shell`）⇒ **自动坐实了 H-1 的因果链**
   （不需要人工 `adb unroot`）；纪律：**自愈重启后不要假定 adbd 仍是 root**。
3. **tester 已显式列出的未覆盖项 U-1…U-8**（见 §4.5 与 `STATUS-READY-2026-10-14.md`）：
   U-1 `gate-shot`/`card-layout-verify` 未真跑；U-2 `qa-round` 未真跑用例；U-3 A10/A16 版本相关几何未标注；
   U-4 CDP **真输入**（`Input.dispatchMouseEvent`）未验；U-5 截图耗时未按稳态口径重打；U-6 真机 OriginOS 未覆盖；U-7 H-1；U-8 本轮 0 条 ntfy。
4. **F4/F5/F6 未做**（AVD `config.ini` 重复键与 `hw.gpu.enabled=no`、三个启动器并存、阶梯加可判据输出）。
5. **host-plugin 遗留 QA：P02–P06 未跑**（P01+P07 已完成）。
6. **真 GPU 冷启基线未重打**（巡检的 6s 是 quickboot 快照引导，不可用）。
7. **openspec `--all --strict` 仍有 6 项失败**（其余 5 项为 WARNING 级：Purpose 占位/过短、requirement >500 字符）——
   本轮只修了阻塞 `archive` 的那 1 条 ERROR，**WARNING 项未处理**。
8. **task-3 复用产物在 `F:\work\work_dsh\tmp\`（未进仓）** ——若下轮还要用，考虑落进 `verify/` 长期化
   （注意：那是 tester 的写入范围，须先协调）。
