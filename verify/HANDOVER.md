# 交接索引（HANDOVER）

> **谁读这个**：新开对话的 leader（以及他 spawn 的 developer/tester）。
> **怎么用**：先看「当前轮次状态」，再按角色跳到你需要的交接产物；本文件只做索引与状态快照，
> **细节在各自产物里**（`verify/QA-ROUND-*.md`、`openspec/changes/*`、`host-plugin/README.md`、本 skill）。
> **谁维护**：leader（每轮收尾登记一行；developer/tester 只写自己的产物，不改本文件）。
> 纪律与产物清单见 skill `dsh-push-app-dev` §5。

---

## 1. 当前轮次状态（快照）

| 字段 | 值 |
|---|---|
| 本轮主题 | **建团队 + 三角色就绪自检**（用户：把成员建起来、进入随时可开工状态）；承接上一轮的**基础设施巡检 + 模拟器禁 CPU 软渲染加固部署** |
| **当前阶段** | ✅ 就绪自检完成，**三角色均 READY**（developer task-1+task-3、tester task-2、leader）；仅 **task-4（修 H-1）** 在进行 |
| **收尾状态** | 收官于 2026-10-14 19:3x。就绪记录：`verify/TEAM-READY-2026-10-14.md`；QA 就绪报告：`verify/STATUS-READY-2026-10-14.md` |
| **下轮第一件事** | ① 确认 **task-4（H-1）已闭环**（`STATUS-READY` 的 U-7 转为已修）；② 用户若要开工，直接派功能任务——**三条路径（写功能/跑 QA/发布）都已有实测判据**，不需要再摸环境 |
| 团队（本轮建立） | lead + **developer**（`android-app|host-plugin|openspec`）+ **tester**（`verify/**`）；**模型均 = spawn 时 Lead 的模型 `Deepseek-V4.1-Flash`，之后无法更改**（见 §3.10 与 `TEAM-READY` §2） |
| 笔电现网（上轮变更，仍有效） | `G:\Android\emu-selfheal.ps1` = **加固版 sha256 `21C1856BB181476C882D05A4981F6CAA84BFDEADF6B155045A49BA1FE0358C3D`**（源在 `verify/laptop-emu-selfheal.hardened.ps1`）；**旧脚本备份 `emu-selfheal.ps1.bak-f13`（`BE99A7F9…`）可回滚，不需重启 DSH**；选择器 `emu-ladder.gpu=host` |
| 生产环境 | 桌面 DSH：插件 **0.2.1**（HTTP 401 = 预期，无 token）。token **每次重启必换**，从 `~/.dsh/web.log` 最后一条现取 |
| vm1 环境 | `dsh-net.sh` **运行中**（3080→3081，三地址自检全可用）；`~/.local/bin/node` v22.22.3；**构建工具链齐全**：JDK `17.0.20.1`、Gradle `8.7`（**不在 PATH**）、SDK `/home/user/android-sdk`（见 §3.12/§3.13） |
| 笔电环境 | SSH 通；宿主 GPU **RTX 4060 Laptop / 驱动 616.92**；模拟器 **真 GPU** `1440x3168@640`（`emu-gpu-verdict.ps1` exit 0） |
| 版本基线 | App **v1.32.10 / versionCode 76**（三处一致：`build.gradle.kts` ×2 + `PushService.APP_VER`）；host-plugin **0.2.1** |
| **QA 未完成** | 照旧：task-10 的 **P02–P06 未跑**（P07+P01 已完成，`verify/QA-ROUND-plugin-0.2.0.md`）；另有 tester 本轮列出的 **U-1…U-8**（见 `STATUS-READY` / `TEAM-READY` §6） |
| 本轮遗留（新） | **H-1**（QA 起页需 `adbd root`，task-4 修中）；**F4/F5/F6 未做**；~~「软渲染实例被 kill+重启拉回」仅干跑证明~~ → **✅ 2026-10-14 20:00 真机验证 FIXED**（§3.14）；真 GPU **冷启**基线未重打；`openspec --all --strict` 仍 5 项 WARNING |
| 0.2.0 处置 | **作废、禁止进生产**（详见 §3.5） |
| 0.2.1 产物 | sha256 `59B0A9D9EB7B20148C6AAFB1FEA7F09C5E0FE2742ECF016D4D684F320B456D31`（46,652 B），与 `HEAD` 四文件**逐字节 MATCH**（§3.7）。**首包 `59B0B97C…` 已作废** |
| 回滚路径 | host-plugin：`verify/prod-rollout-plugin.ps1 -Rollback` → `-DispatchRestart` → `-Check`（备份 `*.prodroll-20261014-181419`）；模拟器自愈：`Copy-Item G:\Android\emu-selfheal.ps1.bak-f13 G:\Android\emu-selfheal.ps1 -Force` |
| 新增/更新 skill | **`dsh-team-model-control`**（换队友/子智能体模型）；**`dsh-push-app-dev`** 本轮大改：GPU 判据重写、`emu-gpu-verdict.ps1` 一条命令判据、F1–F3 加固版、**新增 6 条硬事实**（推真机陷阱/QA 起页需 root/vm1 构建易错点/openspec 用法/长脚本下发禁令/.NET 死锁/证据纪律） |

## 2. 本轮交接产物

| 产物 | 位置 | 内容（下轮必须知道的） |
|---|---|---|
| **团队就绪记录（本轮核心产物）** | [TEAM-READY-2026-10-14.md](F:\work\work_dsh\dsh-push\verify\TEAM-READY-2026-10-14.md) | 三角色构成 + **「队友模型不能改」的完整结论**（§2）+ 任务链与串行纪律（§3）+ developer task-1/task-3 结论（§4/§4.7）+ tester task-2 结论（§4.5）+ **H-1**（§4.6）+ 推真机陷阱（§5.5）+ **各角色就绪判据**（§5）+ 总体就绪结论（§5.6）+ 待办诚实清单（§6）。**新对话开场读完这份 = 知道团队能不能开工** |
| **QA 就绪报告** | [STATUS-READY-2026-10-14.md](F:\work\work_dsh\dsh-push\verify\STATUS-READY-2026-10-14.md) + [evidence-ready-2026-10-14/](F:\work\work_dsh\dsh-push\verify\evidence-ready-2026-10-14) | tester 的 A–F 逐条断言/实际/证据 + **U-1…U-8 未覆盖项显式列出** + §7 收笔后记（判定 `RED`→`READY` 的诚实过程）+ 两张证据图（B 截图 2,036,754 B / C 起页 1,041,919 B） |
| **GPU 判据工具** | [emu-gpu-verdict.ps1](F:\work\work_dsh\dsh-push\verify\emu-gpu-verdict.ps1) | **一条命令判模拟器跑真 GPU 还是 CPU 软渲染**：exit `0`=PASS / `3`=SOFTWARE(违反"禁 CPU"约束) / `4`=BLOCKED。判据 = 客机 `dumpsys SurfaceFlinger` 的 `^GLES:` 行（两条件封死：渲染器含 `NVIDIA` → PASS；含 `SwiftShader`/`Google (Google)` **或** qemu `-gpu` 是 swiftshader → SOFTWARE）。只读、不启停笔电任何东西。`-SelfTest` = 6 条合成用例（无需 ssh，实测 6/6）。**顺带闸门**：实例已是真 GPU 但 `emu-ladder.gpu` 仍是 swiftshader 时会告警「下次启动会回退到 CPU」 |
| **F1–F3 加固版（✅ 已部署 19:02）** | [laptop-emu-selfheal.hardened.ps1](F:\work\work_dsh\dsh-push\verify\laptop-emu-selfheal.hardened.ps1) | 笔电 `emu-selfheal.ps1` 的**现网版本**（sha256 `21C1856B…`，与 HEAD 逐字节一致）：F1 rung 1 无条件先试（会话检查降为纯日志）｜F2 渲染器纳入健康判据、非真 GPU 即 `VIOLATION` 并纠正、读不到则 **fail closed**｜F3 软渲染只作临时救援、成功后**把选择器重写回 host**。测试钩子 `-DryRun`/`-TestRendererOverride`/`-ForceLadder` 带自锁（不带 `-DryRun` 使用会 exit 2）；**`-SelfTest` 只读**（含**实时**渲染器探测，是防死锁类 bug 的永久回归） |
| **干跑证明脚本** | [drive-hardened-dryrun.ps1](F:\work\work_dsh\dsh-push\verify\drive-hardened-dryrun.ps1) | 在笔电跑 6 场景（真 GPU 健康／软渲染违规／无法识别 fail-closed／rung1 失败→软渲染救援+选择器还原／rung1 成功／测试钩子安全闸）。**实测 `FINAL: PASS - 6/6, machine mutated: NO`**：前后快照逐项相等（qemu pid、选择器哈希**与 mtime**、真阶梯日志行数、渲染器）。**v1 曾有假测**（`-BreakHostRung` 单独用会停在"已健康"闸口、根本没到阶梯）→ v2 加 `-ForceLadder` 才真打到降级分支 |
| **部署驱动脚本** | [deploy-emu-selfheal-f13.ps1](F:\work\work_dsh\dsh-push\verify\deploy-emu-selfheal-f13.ps1) | 在**笔电**执行的步骤 4–5：状态核查 → 降级分支复验 → 安全闸测试 → **幂等**覆盖现网脚本 → **生产模式**跑真任务 + 断言表。**必须 `scp` 后 `powershell -File` 跑，别走 ssh 命令行**（超 ~8191 字符会被截断且静默不执行，本轮踩过） |
| **部署手册** | [RUNBOOK-emu-selfheal-hardening.md](F:\work\work_dsh\dsh-push\verify\RUNBOOK-emu-selfheal-hardening.md) | 把加固版部署到笔电的**五步手册**：备份（记哈希）→ 下发 → **真机 `-DryRun` 复核**（须见 `already healthy ON THE REAL GPU`）→ 复验降级分支 → 覆盖 → **观察一个 5 分钟自愈周期**。含 5 条验收断言、**残留风险如实告知**、回滚（还原备份 + 复查档位，不需重启 DSH）、收尾清单。**已执行完成，保留为复现/换机器/回滚指南** |
| **巡检报告** | [INFRA-HEALTH-2026-10-14.md](F:\work\work_dsh\dsh-push\verify\INFRA-HEALTH-2026-10-14.md) | 三台机器健康实况；CPU 软渲染违规态取证（SurfaceFlinger 渲染器行）；**旧前提「无交互会话⇒真GPU起不来」被证伪的实测**；根因链①–⑤；真 GPU 基线（截图 1.0–1.25s；6s 是 quickboot 非冷启）；**§9 = 实际部署记录 + 生产验收断言表 + §9.4 `Run-Timeout` 死锁根因与修法 + §9.6 假 PASS/假 FAIL 两次工具缺陷** |
| **task-3 复用产物（未进仓）** | `F:\work\work_dsh\tmp\task3-*.{ps1,sh}` + `dev-task3-runbook.md` | 「不发布构建+装机」的手工三件套：总编排 / `clean assembleDebug` / 笔电侧 install（含三段哈希闸门与 `-ExpectSha256`）。**未进仓**；若长期化需与 tester 协调（`verify/**` 是其写入范围） |
| 实现 | [host-plugin/lib/index.js](F:\work\work_dsh\dsh-push\host-plugin\lib\index.js) / [lib/client.js](F:\work\work_dsh\dsh-push\host-plugin\lib\client.js) / [package.json](F:\work\work_dsh\dsh-push\host-plugin\package.json) | volatile 期望态 + `ctx.on('loader/volatile-update')` 触发 + `configEditor.edit` 热改 tool-ask-user + 备份 + 失败回写状态；`dsh.client{platform:"web"}` + `exports "./client"` |
| 规格 | [openspec/changes/plugin-timed-switch/](F:\work\work_dsh\dsh-push\openspec\changes\plugin-timed-switch\proposal.md) | 新 capability `dsh-host-plugin` ADDED 需求 7 场景（vm1 `validate --strict` PASS） |
| 插件文档 | [host-plugin/README.md](F:\work\work_dsh\dsh-push\host-plugin\README.md) | 设置页开关链路表 + 生效范围（新会话立即/老会话代际钉死）+ **selftest 运行时坑** + 网页提问卡生命周期根因；`:267` 记 **101/101** 真基线 |
| 一键安装 | [deploy/windows/install-user.ps1](F:\work\work_dsh\dsh-push\deploy\windows\install-user.ps1) | 无 UI 场景的等价路径；幂等 marker；`[]` 空模板整体替换 |
| QA 用例 | [verify/QA-ROUND-plugin-0.2.0.md](F:\work\work_dsh\dsh-push\verify\QA-ROUND-plugin-0.2.0.md) | P01-P06 声明式用例 + 设计期实测事实（设置页入口选择器、Edge headless CDP 链路、scratch 起法） |
| 硬事实 | skill `dsh-push-app-dev` §2 / §2.1 / §5 | GPU 判据与 `emu-gpu-verdict.ps1`；host-plugin 改动专用事实；**本轮新增 6 条**：推真机陷阱、QA 起页需 root、vm1 构建易错点、openspec 用法、长脚本下发禁令、`.NET Process` 死锁、证据纪律 |
| **模型控制** | skill **`dsh-team-model-control`** | 队友（spawn_teammate）与子智能体（subagent/workflow）换模型的分野；`allowedModels` 与设置页开关；实测判据与源码行号。**下一轮若要用"给成员换模型"，开场就读它** |
| 生产上线工具 | [prod-rollout-plugin.ps1](F:\work\work_dsh\dsh-push\verify\prod-rollout-plugin.ps1) + [RUNBOOK-plugin-0.2.1-rollout.md](F:\work\work_dsh\dsh-push\verify\RUNBOOK-plugin-0.2.1-rollout.md) | `-Check/-Install/-DispatchRestart/-Verify/-Rollback` 五模式；验收断言表 |
| vm1 环境与推送 | [vm1-dshnet-check.sh](F:\work\work_dsh\dsh-push\verify\vm1-dshnet-check.sh) / [vm1-host-onboard.sh](F:\work\work_dsh\dsh-push\verify\vm1-host-onboard.sh) / [RUNBOOK-vm1-push-onboarding.md](F:\work\work_dsh\dsh-push\verify\RUNBOOK-vm1-push-onboarding.md) | 零写入回归（带锁）；推送凭据开通（`status/write/restart/verify --probe/cleanup-seed`） |

## 3. 逐轮登记（新→旧）

| 轮次 | 改了什么 | 去哪看 | 遗留 |
|---|---|---|---|
| **建团队 + 就绪自检（2026-10-14 19:1x–19:3x）** | 建立三成员团队（lead/developer/tester，模型均继承 Lead=`Deepseek-V4.1-Flash`）；task-1 工具链自检 **READY**；task-2 取证链路 A–E 全绿；task-3 App 端到端 READY；**task-4 修 H-1 FIXED**；**修掉 1 条阻塞 `openspec archive` 的既有 ERROR**（`c215691`）；**拦截「`dsh-app-verify.ps1` 不加 `-Deploy` 也会推用户真机」的陷阱**；纠正 4 条过时硬事实；**20:00 真机验证软渲染自愈拉回 FIXED** | [TEAM-READY-2026-10-14.md](F:\work\work_dsh\dsh-push\verify\TEAM-READY-2026-10-14.md)、[STATUS-READY-2026-10-14.md](F:\work\work_dsh\dsh-push\verify\STATUS-READY-2026-10-14.md)、本文件 §3.11（纠错）+ §3.12（推真机陷阱）+ §3.13（证据纪律）+ §3.14（自愈真机验证） | F4/F5/F6 未做；真 GPU 冷启基线未重打；`openspec --all --strict` 仍 5 项 WARNING |
| **基础设施巡检 + F1–F3 加固部署（2026-10-14 18:4x–19:0x）** | 三台机器巡检；**证伪「无交互会话⇒真 GPU 起不来」旧前提**（实测 console 已断开仍 `-gpu host` OK、渲染器=RTX 4060）；**当场把模拟器从 swiftshader 切回真 GPU**；定位 CPU 档稳态固化根因链；产出 `emu-gpu-verdict.ps1` 一条命令闸门；**加固版 F1–F3 已部署**（含部署途中挖出并修掉的 `Run-Timeout` 死锁 + `-SelfTest` 永久回归） | [INFRA-HEALTH-2026-10-14.md](F:\work\work_dsh\dsh-push\verify\INFRA-HEALTH-2026-10-14.md)、[RUNBOOK-emu-selfheal-hardening.md](F:\work\work_dsh\dsh-push\verify\RUNBOOK-emu-selfheal-hardening.md)、skill `dsh-push-app-dev` §2（GPU 判据重写 + 死锁/ssh 长度两条新坑） | **F4/F5/F6 未做**；「软渲染被拉回」仅干跑证明；真 GPU 冷启基线未重打；截图耗时样本不对称 |
| host-plugin 0.2.0（进行中） | 设置页「手机作答模式」开关；网页提问卡生命周期根因归档；一键安装脚本；deploy 文档 | 本文件 §2 | task-10 执行段未跑；老会话 legacy 僵卡靠「跳过」；DSH 上游补丁（默认 timed + `ask()` AbortController）未提 |
| App v1.32.10 | 逐条「已读」同步撤该条通知（markAllRead 语义统一） | `verify/QA-ROUND-v1.32.10.md`（PASS 15/15）、`openspec/specs/companion-app/spec.md` | QA 报告 §6 未覆盖项（真机 OriginOS、30 条满载、C03/C04） |
| App v1.32.9 | 一键全部已读（状态卡按钮 + `markAllRead`） | `verify/QA-ROUND-v1.32.9.md`（PASS 24/24） | — |

## 3.5 P0 事故记录：0.2.0 反向降级生产配置（2026-10-14）——**上线前必读**

**一句话**：host-plugin 0.2.0 的「手机作答模式」开关在**没有任何用户表态**的情况下，开机自动把生产
`tool-ask-user` 从 `timed` 改写成 `legacy`，并真写了 `cordis.patch.yml`。

| 项 | 内容 |
|---|---|
| 时间线 | 16:11 备份 + 换装 0.2.0（patch 哈希 `D8F12BC0…`）→ 16:12 重启（端口持有者 5452→28772，8/8）→ 启动日志 `[dsh-push-host] 手机作答模式：timed → legacy，已备份 …bak-1791965527486` → 哈希变 `12A0B552…`、文件尾多出 `- id: tool-ask-user / mode: legacy` |
| 根因（读代码定位，行号对 `lib/index.js`） | `:142` `askUserMode` 默认 `'legacy'`；`:873` `desired()` 兜底 `'legacy'`；`:945` 开机即 `sync()` → `:884` 判「需切换」→ `:896-903` 备份 + `configEditor.edit` **真写文件**。即「未表态」被当成「要求 legacy」 |
| 测试盲区 | selftest 14c 只覆盖「legacy 期望 + legacy 实际 = 零写入」，**缺「legacy 期望 + timed 实际」这条降级路径** → 当轮 **82/82** 全绿仍漏网（⚠️ **82/82 是当轮历史数字，已被 101/101 取代，见 §3.11**） |
| 止损 | ① 证据留档（插件自己的备份 `cordis.patch.yml.bak-1791965527486`）；② patch 文件还原为 `D8F12BC0…`（两处 `mode: timed` 健在）；③ 生产插件回滚 **0.2.0 → 0.1.1**（`lib/client.js` 已不在）；④ 再重启一次清掉进程内 legacy 态 |
| 影响面 | 生产 web 提问能力一度降级为 legacy（前台抢答仍可用，失去 timed 的迟到折回与卡片自愈）；**用户真机未受不可逆影响**（作答链路未损，仅配置被改写） |
| 修复 | developer 出 **0.2.1**：永不降级（只允许升 timed）+ `askUserMode` 去默认（未表态=inert）+ edit 前断言 `desired === 'timed'` + 展示读实际态 + selftest 补 4 条回归（含「期望 legacy + 实际 timed → 零写入」） |
| QA 补测 | tester 加 **P07 开机零写入回归**（真实例：哈希逐字节不变 + 无新增 `.bak-*` + 日志不出现切换行），报告单开「P0 事故记录」节 |
| 纪律沉淀 | 「开机自愈式写入」必须**双向覆盖四种组合**（期望×实际），尤其「实际比期望更好」时绝不允许回写；任何写用户配置文件的功能，上线前必须有「未表态 = 零写入」用例 |
| **二次降级（16:13–16:14）** | 只回滚磁盘**不够**：仍在运行的 0.2.0 进程会再次降级——`.bak` 时间戳 16:12:07（开机）、16:13:22、16:14:37，后两次都是我 `Copy-Item` 还原文件后触发的 reconcile 又跑了一遍 sync。⇒ **活体自愈写会把外部修复当成待纠正状态反复覆盖**；修复需加「同进程内同一目标最多成功写一次」 |
| 附带缺陷 | 同一批日志有 `[dsh-push-host] 手机作答模式切换失败：HMR transactions cannot be nested`——在 HMR 事务内调 `configEditor.edit` 会失败，sync 需排队到事务外 |
| 恢复步骤（可复用） | ① 还原 patch 文件；② 回滚插件版本（`Remove-Item node_modules\<pkg>` + `dsh plugin add <旧 tarball>`）；③ **重启宿主**（清进程内存态 + 杀掉会自我重写的旧进程）；④ 复查：哈希 20s 不变 + 无新增 `.bak-*` + 新 boot 日志无「手机作答模式：」切换行 |

## 3.6 vm1 独立验证环境（2026-10-14 建，**验 host-plugin 一律用它，别动生产**）

**为什么有它**：在桌面生产 DSH 上验插件开关＝重启承载 agent 自己的宿主（0.2.0 正是这样打出了生产事故）。
vm1 上现在有**两套**可用环境，**用户已拍板（2026-10-14）：标准验证环境 = 他自己那套 `dsh-net.sh` 服务**
（他已手动把它升到 **0.2.0-rc.2**，与桌面生产同版，且自带代理，设置页 UI 可直接验）。

| | ✅ **标准：vm1 服务**（用户拍板） | 备用：隔离 QA 环境 |
|---|---|---|
| 入口 | `~/work/cp_learn_vmware/deepseek-harness/dsh-net.sh {start\|restart\|status\|version\|pin}` | `verify/vm1-qa-env.sh` |
| 版本 | **0.2.0-rc.2**（npx 缓存 `7eff65a5…` + `~/.dsh/.guard-pin` 钉住） | 0.2.0-rc.2（`~/dsh-qa/node_modules`） |
| DSH_HOME | 真实 `~/.dsh`（profile `web`） | 隔离 `~/dsh-qa/home` |
| 端口 | 3080（代理，isLoopback 改写生效）→ 3081 | 3099（要 UI 得另起代理 3098→3099） |
| 用途 | **验 host-plugin 的主环境**；`profile web` 未装 dsh-push-host（干净基线） | 需要完全隔离、不碰用户 `~/.dsh` 时用 |

### 标准用法（脚本：`verify/vm1-dshnet-check.sh`）

```bash
scp verify/vm1-dshnet-check.sh user@<tailnet-vm1>:/tmp/ && ssh user@<tailnet-vm1> 'sed -i "s/\r$//" /tmp/vm1-dshnet-check.sh'
ssh user@<tailnet-vm1> 'bash /tmp/vm1-dshnet-check.sh status'                       # 服务+profile+哈希+备份数
ssh user@<tailnet-vm1> 'bash /tmp/vm1-dshnet-check.sh check /tmp/<tarball>'          # 装→重启→判定
ssh user@<tailnet-vm1> 'bash /tmp/vm1-dshnet-check.sh cleanup'                       # 卸插件+还原 patch+重启+复查稳定
```

判定四态（exit code 即结论）：**PASS** `boot wrote nothing`(0) / **WRITE DETECTED**(3) / **BLOCKED** `plugin never loaded`(4) / 环境错误(2)。
判据四条同时满足才算 PASS：patch 哈希不变 + 备份数不变 + 日志无「手机作答模式」切换行 + patch 无 `- id: push-host` 条目。
脚本 `check` 会先把 profile 快照成 `<patch>.baseline-check`，`cleanup` 用它**逐字节还原**（插件自己的 `.bak-*` 是 seed 之后拍的，不能当基线）。

### 三条实测硬事实（都踩过）

1. **node 运行时（本次把服务搞挂的坑）**：dsh 0.2.0-rc.2 要求**官方 node 且带 TypeScript stripping**。
   vm1 的 `/usr/bin/node`（Ubuntu 包，v22.22.1）**没有 `stripTypeScriptTypes()`** → dsh 拒绝启动
   （`ERR_NO_TYPESCRIPT`）→ `dsh-net.sh restart` 失败、服务躺下。**必须先**
   `export PATH=$HOME/.local/bin:$PATH`（`~/.local/bin/node` → `~/.hermes/node/bin/node` v22.22.3，可用）。
   脚本已内置 preflight（缺该 API 直接 exit 2 并提示）。
2. **boot 有效性闸**：首轮 `vm1-qa-env.sh` 出现过**假 PASS**——启动参数写成 `--profile <p> web` 被拒
   （`too many arguments … got 1: web`），插件没加载却因「没写入」报 PASS。判据：日志里**没有 `dsh-push-host` 一律 BLOCKED**。
3. **0.2.0 在 vm1 服务上稳定复现生产事故**：`check` 输出 `WRITE DETECTED`、`timed → legacy`、新增 1 个 `.bak`、
   patch 尾部多出 `- id: tool-ask-user / mode: legacy`。**验完已逐字节还原**（sha256 回到 `4a449604…`、138 行、
   0 条 tool-ask-user、插件已卸、我方备份已清）——**动用户 profile 必须留基线并还原**，这是纪律。

**第 3 个缺陷（干净环境暴露）**：插件会把显示用的状态字符串 `askUserStatus` 用 `configEditor.edit` 写进用户 `cordis.patch.yml`：
```yaml
- id: push-host
  name: dsh-push-host
  config:
    askUserStatus: 未找到 tool-ask-user 配置项：…
```
⇒ 即使「无需切换」，插件也会为显示状态而改用户配置文件。修复要求：状态只留 volatile（内存），**落盘只允许发生在真正把 tool-ask-user 改成 timed 那一次**。

## 3.7 0.2.1 放行验证：PASS（2026-10-14，vm1 用户服务）

**结论**：`vm1-dshnet-check.sh check /tmp/dsh-push-host-0.2.1.tgz` → **PASS (exit 0)**，插件在用户自己的
vm1 服务（DSH_HOME=`~/.dsh`，profile `web`，dsh 0.2.0-rc.2）上**开机零写入**。

```
plugin version          : 0.2.1   (client.js=yes)
patch hash before/after : 45717dc5df0e4e0a9e513f1dd58c6f3bed2d764fa264cb06673938197ae61dcc / (same)
backups before/after    : 0 / 0
switch log lines        : 0          (无任何 timed→legacy 之类切换)
patch '- id: push-host' : 0          (状态没落盘 = 第③缺陷已修)
patch mode: timed       : 1
patch mode: legacy      : 0
VERDICT: PASS - boot wrote nothing (hash, backups, switch log, entries all clean)
```

**同环境同脚本对照**（同一把尺子量两版，这是最有力的证据）：
| 版本 | 判定 | 现场 |
|---|---|---|
| 0.2.0 | **WRITE DETECTED (exit 3)** | `手机作答模式：timed → legacy` + 新增 1 个 `.bak` + patch 尾部追加 legacy 块 |
| 0.2.1 | **PASS (exit 0)** | 哈希不变、备份 0/0、切换行 0、push-host 条目 0 |

**最终产物指纹（2026-10-14 定稿）**：`dsh-push-host-0.2.1.tgz`
sha256 **`59B0A9D9EB7B20148C6AAFB1FEA7F09C5E0FE2742ECF016D4D684F320B456D31`**（46,652 B，10 文件）。
**注意有一次重打包**：首版 sha `59B0B97C…`（45,964 B）是 `2c971ec` 打的，之后 `c766f19` 改了 README
而 README **在发布白名单里** → 包内 README 会过期，故从 `c766f19` **重打包**为新 sha。
`2c971ec..c766f19` 对 `lib/**`、`package.json`、`plugin-selftest.mjs` **零改动**（`git diff --stat` 为空），
所以旧 PASS 的行为结论继续成立；但仍以**新包重跑了一遍完整验证**（见下）。

**最终产物 vs HEAD(`c766f19`) 逐字节比对（cmd 重定向取 blob）**：
| 文件 | 结果 | 字节 |
|---|---|---|
| `lib/index.js` | **MATCH** | 47,575 |
| `lib/client.js` | **MATCH** | 5,260 |
| `package.json` | **MATCH** | 1,806（version 0.2.1） |
| `README.md` | **MATCH** | 43,739 |
| `plugin-selftest.mjs` | 不在包内 ✓ | — |

**最终产物在 vm1 服务的复验（同一脚本、带锁）**：`PASS (exit 0)` ——
hash `45717dc5…`→`45717dc5…` 不变、backups 0/0、switch log 0、`- id: push-host` 0、`mode: legacy` 0、
正向 load marker 1、**dangling bundle errors 0**；随后 `cleanup` 输出 `hash stable after 20s = yes`、
patch 还原到 `4a449604…`（138 行 / tool-ask-user 0）、package.json 按 baseline 还原、插件卸载。

**教训（新增闸）**：**改了白名单内的文件（README/LICENSE/cordis.patch.yml）必须重打包并重新核对**，
否则「验过的包」与「发出去的包」内容不一致。首版就是这样过期的。

### 验证脚本自身的三处缺陷（都已修，commit `6b40ae9`）——**工具也会有假判，别只信结论**

1. **日志按整文件计数 → 假 WRITE**：`web.log` 是跨重启**追加**的，我原先在整份日志里数「手机作答模式」行，
   把上一轮 0.2.0 的历史行算进本次，于是干净的 0.2.1 被判 `WRITE DETECTED`。
   修：记录重启前的行号偏移，**只判本次重启窗口**（`tail -n +offset`）。
2. **boot 有效性判据太弱 → 假「已加载」**：原先「日志里出现 `dsh-push-host` 即算加载」，但宿主自己的报错行
   `dsh: skipping profile bundle "dsh-push-host": cannot resolve …` **同样含该字样** ⇒ 插件根本没加载也会被判加载。
   修：改用**正向加载标记**（`relay ready|relay disabled|credentials file`），并新增**悬空 bundle 闸**
   （出现 `skipping profile bundle.*dsh-push-host` 直接 `BLOCKED` exit 4）。
3. **cleanup 不还原 `package.json` → 每次开机报错**：`dsh plugin add` 会同时写 `dependencies` 与
   `dsh.profile.bundles`，只删 `node_modules` 会留下**悬空 bundle 条目**，之后每次启动都打
   `dsh: skipping profile bundle "dsh-push-host"`。修：`check` 同时快照 `package.json.baseline-check`，
   `cleanup` 两者一起逐字节还原。

### 并发撞车（新增串行锁）

vm1 服务是**共享**的：我 cleanup 完（patch 回到 138 行 / 插件卸掉 / 悬空条目清零）后再查，发现又变成
seeded 态 + 0.2.1 已装 + `package.json` 两条条目回来 —— 是 developer 的并发自测在跑，**共享环境无锁会互相踩**，
还会让「谁改了 profile」说不清。修：脚本 `check`/`cleanup` 先抢 `~/.dsh/.vm1-check.lock`
（目录锁，>30 分钟视为陈旧自动抢占，`trap` 保证退出释放）。

**纪律**：共享环境只走脚本（手工 add/改绕过锁＝继续撞车）；`check` 后**必须** `cleanup`；
收尾以「哈希 20s 稳定 + 无新增 `.bak` + 悬空条目 0」为准。

### 放行闸：验证过的产物必须与提交逐字节一致（2026-10-14 新增）

0.2.0 的教训是「验的东西 ≠ 发的东西」。所以 0.2.1 起加一道闸：**把 tarball 解包内容与 git 提交逐字节比对**。

```powershell
# 必须用 git cat-file + cmd 重定向取字节（PowerShell 管道会把行尾改坏 → 假 DIFF，实测踩过）
cmd /c "git cat-file blob HEAD:host-plugin/lib/index.js > $tmp\git-index.js"
(Get-FileHash $tmp\git-index.js).Hash -eq (Get-FileHash "$tar\package\lib\index.js").Hash
```

**0.2.1 实测结果（commit `2c971ec` vs tarball）**：
| 文件 | 结果 | 字节 |
|---|---|---|
| `lib/index.js` | **MATCH** | 47,575 |
| `lib/client.js` | **MATCH** | 5,260 |
| `package.json` | **MATCH** | 1,806（version 0.2.1） |
| `plugin-selftest.mjs` | 不在包里 ✓（`files` 白名单正确） | — |

⇒ 验过的那份 0.2.1，就是提交里的那份。

### vm1 环境已还原到字节级原始态（收尾核验，2026-10-14）

```
patch sha256        : 4a44960459a9af49e95f34369e394eab4e60a209f4778c4af8647c2e13317019
byte-identical      : YES（与介入前一致）
hash stable 20s     : yes
patch lines         : 138   (original 138)
tool-ask-user       : 0     (original 0)
push-host entries   : 0
pkg dsh-push-host   : 0
plugin installed    : no
baselines left      : 0
newest boot window  : 0 处 dsh-push-host 提及（无悬空 bundle 报错）
service             : 运行中（3080 → 3081）
```

**另一条工具坑（亲身踩到）**：PowerShell 管道取 git blob 会把行尾改成 CRLF → 逐字节比对**假报 DIFF**
（我第一轮就这样误判了一次，改用 `cmd /c "git cat-file blob … > file"` 后全部 MATCH）。
凡「逐字节一致」类断言，一律用 cmd 重定向或 .NET 写文件，禁用 PowerShell 文本 cmdlet。

## 3.8 生产上线工具（2026-10-14 备好，**待用户点头才执行**）

0.2.0 是**手工**上线的，因此打出 P0。0.2.1 起上线走脚本 + 手册，全部步骤「先快照、再执行、后比对」：

| 产物 | 用途 |
|---|---|
| [prod-rollout-plugin.ps1](prod-rollout-plugin.ps1) | 五个模式：`-Check`（只读预检+写快照）/ `-Install`（双备份+校验哈希+装+断言版本）/ `-DispatchRestart`（一次性计划任务重启）/ `-Verify`（与快照逐项比对，全过才 PASS）/ `-Rollback`（还原 patch **与** package.json + 卸插件） |
| [RUNBOOK-plugin-0.2.1-rollout.md](RUNBOOK-plugin-0.2.1-rollout.md) | 上线手册：前置条件、五步操作、验收断言表（含「为何每条都要」）、回滚、边界与残余风险 |

**已经跑过的**（2026-10-14 18:06）：
- `-Check` **exit 0** —— patch `D8F12BC0…` == 期望、当前插件 0.1.1、26 个历史备份、3081 持有者 14860、
  tarball sha `59B0A9D9…` 与定稿一致、patch `timed=2 legacy=0`；快照写入
  `F:\work\work_dsh\tmp\prod-rollout-state.json`（`webLogLines: 306` 作为重启窗口偏移）。
- `-Verify` 冒烟（**故意在未安装未重启状态下跑**）→ **exit 3 / FAIL**，如实报「插件 0.1.1、正向加载标记 0、
  端口持有者未变（= 没真重启）」。**这一步是为了证明验收脚本不会假报 PASS。**

**脚本自身的坑（已修）**：运行中的 DSH 占着 `web.log`，`File.ReadAllLines` 会抛
`being used by another process` → 改用 `FileShare.ReadWrite` 共享读，且读失败只告警不中断验收。

**执行顺序（待用户同意重启）**：`-Install` → 通知用户 token 将换 → `-DispatchRestart`（本轮会话当场断，正常）
→ 重置回来跑 `-Verify`（须 exit 0）→ 取新 token 发用户 + 通知 tester 开跑 P02。

## 3.9 vm1 推送开通：完成并 PASS（2026-10-14 18:2x）

**用户症状**：vm1 上装了插件、任务也跑完，**手机收不到 vm1 的任何推送**。

**根因**（不是没装插件，是**推送子系统被凭据缺失整体关掉**）：
```
[dsh-push-host] relay disabled (set host + hostToken, or DSH_PUSH_HOST_TOKEN): push/answer off
```
实测：`relay disabled` **11 行** / `relay ready` **0 行** / `~/.config/dsh-push/credentials.json` **不存在** /
五个 `DSH_PUSH_*` 环境变量**全未设置**。插件的 `apply()` 照常注册钩子、设置页照常出现，但 `host.start()`
在解析不到凭据时**提前返回** ⇒ 提问推送 / 作答轮询 / 回合结束通知三条链路全不存在。**这是 fail-safe 设计，不是 bug。**

**处置（用户批准方案 A：共用 topic `dsh`）**：

| 步骤 | 命令/结果 |
|---|---|
| relay 开号 | `bash /root/vm1-relay-provision.sh vm1 dsh` → host 表从 `[desktop, test1, testhost, work]` 变 `[desktop, test1, testhost, **vm1**, work]`，`vm1 topic=dsh`；载荷落在 relay `/root/vm1-payload.json`（**600，脚本从不打印令牌**） |
| 写凭据 | `vm1-host-onboard.sh write <payload> --web-base http://<tailnet-vm1>:3080` → `~/.config/dsh-push/credentials.json`（**mode 600**）；`host=vm1 topic=dsh`、`webBase=http://<tailnet-vm1>:3080`、`webName=测试VM1`，四个令牌 len 32/32/51/32 齐全 |
| 重启 | `dsh-net.sh restart`（带 node preflight）→ 自检 3 地址全可用 |
| **验收** | `vm1-host-onboard.sh verify --probe` → **PASS (exit 0)**：日志出现 `credentials file: …` 与 **`relay ready host=vm1 topic=dsh poll=3000ms`**；实推 `POST https://ntfy.cpyh.xyz/dsh → HTTP 200` |
| 收尾 | `cleanup-seed`：删掉我留的 2 个 `.baseline-check` 快照与 seed 注释行（**`tool-ask-user: timed` 保留**，手机作答依赖它）→ patch 145 行 / 1 条 tool-ask-user |

**为什么必须给 vm1 独立 host id（不能抄台式机凭据）**：relay 是**按 host 隔离队列**
（`hosts.json {hostId:{token,topic}}`、`queue.json {hostId:[…]}`），插件只轮询**自己 host 的队列**。
若抄 `host: desktop`，两台插件轮询同一队列 → 台式机（3 s 轮询）**抢走 vm1 的作答项**、又因不认识该 callId 丢掉
→ 手机显示「已答」而 vm1 永远等不到答案。**topic 可以共用**（手机 readToken 按 topic 授权）⇒ 免重新配对。
`vm1-host-onboard.sh write` 内置护栏：host id 为 `desktop` 时**直接拒写**。

**本轮新踩的两个工具坑（都已修，`verify/vm1-host-onboard.sh`）**：
1. **verify 判定窗口取错** → 假 NOT SATISFIED：插件的启动行（`credentials file` / `relay ready`）打在
   该次 `dsh web: http…` 标记**之前**，所以「取最后一个标记之后」什么都看不到。
   修：改用**行号顺序比较**（`credentials`/`relay ready` 的最后行号必须 **晚于**最后一条 `relay disabled`）。
2. **探针 URL 漏了 topic** → HTTP 400：凭据里 `relay` 与 `topic` 是**两个字段**，必须拼成 `"$relay/$topic"`；
   打裸 relay 主机会 400（我因此白跑一轮）。

**另注**：在 vm1 手工跑 `dsh-net.sh status/restart` **必须先 `export PATH=$HOME/.local/bin:$PATH`**，
否则 `/usr/bin/node`（v22.22.1，缺 `stripTypeScriptTypes`）会让命令直接报错；服务本身是好的。
`vm1-host-onboard.sh` 顶部已内置该 PATH。

## 3.10 团队/子智能体换模型：能做什么、不能做什么（2026-10-14 查实）

用户下一个需求是"修改 team 成员的模型"。**结论先说：队友的模型改不了，只能靠"先定 Lead 再 spawn"继承。**
完整手册见 skill **`dsh-team-model-control`**；这里只留交接要点。

| 族 | 工具 | 能否指定模型 | 依据（app.asar 解包，行号） |
|---|---|---|---|
| **Agent Teams 队友** | `spawn_teammate` 等 9 个 | ❌ **不能**：入参只有 `name/description/prompt/context`，**没有 `provider`/`model`**；模型 = **spawn 那一刻 Lead 会话的模型**，之后**无任何工具可改**（没有 set-model / kill-member） | `dsh-experimental-tool-agent-team/lib/index.js:242-266`（参数表）；`dsh-experimental-agent-team/lib/index.js:444-458`、`:698`（模型取自 `root.options.model`） |
| **子智能体** | `subagent` / `subagent_fork` / `workflow` | ✅ 能（`provider`+`model`+`reasoning_effort`） | `dsh-tool-subagent/lib/index.js:412-425`（仅在 `modelSelectionEnabled` 时注入 schema） |

**三条会让下轮踩坑的事实**：
1. **`spawn_teammate` 的 `provider` 不是 LLM 路由**——那是子代理 provider（`spawn`/`fork`），填错会报校验失败（`agent-team:557`、`:1302` 只比对它）。
2. **会话代际钉死**：设置改完，**已存在的会话不会拿到** `provider`/`model` 参数（工具 schema 在会话创建时定死）→ 必须**新开会话**。这正是用户"新开对话"这个动作的价值。
3. **实测继承链证据**：本会话前半段 Lead 跑 `strata-local/qwen3.8-flash-next-abl-iq3_s`，spawn 出的 developer/tester 都是它；后半段 Lead 切到 `odys/Deepseek-V4.1-Flash`，**两个队友没变**。

**授权清单位置**（决定"能选什么"）：`~/.dsh/profiles/web/cordis.patch.yml` 的
`subagent-model-selection-settings.allowedModels`（当前三条：`goopencode/deepseek-v4.1-flash`、
`strata-local/qwen3.8-flash-next-abl-iq3_s`、`odys/Deepseek-V4.1-Flash`）；该字段带 `.volatile()`
⇒ 设置页（**设置 → 插件 → 子智能体**）改的是内存值、热生效，**不写回 yml**；顶部总开关关掉即整条策略失效。
**该策略只管子智能体族，不覆盖 Agent Teams 队友。**

**给下一轮 leader 的建议开场**：新对话里**先把 Lead 模型选成目标档 → 再 spawn 队友**（队友随之继承）；
需要"多模型并行"的活直接用 `workflow` 的 `agent(prompt,{provider,model})`（不受会话代际限制）。

## 3.11 就绪自检纠错（2026-10-14 19:1x，developer task-1 + lead 复核）

本轮"建团队→就绪自检"期间由 developer 发现、**lead 亲自复跑确认**的四条纠错。**这些是旧文档里的错，别再照抄**：

| # | 旧记载（作废） | 实测事实（2026-10-14 19:1x） | 判据 |
|---|---|---|---|
| 1 | selftest 真基线 **82/82** | **`101/101 checks passed`（exit 0）** | lead 亲跑 `& "D:\programs\dsh\resources\runtime\primary-runtime\dependencies\node\bin\node.exe" host-plugin\plugin-selftest.mjs`；旁证 `host-plugin/README.md:267` 原文 + commit `2c971ec` 提交信息（该 commit 补「永不降级」4 条回归后 82→101）。**82 是 0.2.0 之前的数字** |
| 2 | selftest node 路径 = `<DSH 安装目录>\resources\runtime\...` | **`D:\programs\dsh\resources\runtime\primary-runtime\dependencies\node\bin\node.exe`**（`app.asar` **不在**路径上；`resources\` 与 `app.asar` 同级） | developer 实测路径；preflight 守卫未触发（exit 0） |
| 3 | `openspec validate --strict` 这样用 | **裸 `validate --strict` 无效**（`Nothing to validate` + exit 1）→ **必须带目标**：`openspec validate --changes --strict` 或 `openspec validate <change> --type change --strict` | developer 实测；这是**用法**问题，别误判成"环境坏" |
| 4 | vm1 仓可直接拿来跑构建/validate | **vm1 仓是陈旧快照**：`HEAD=92147dd`（2026-10-11），与台式机 `f2fbd20` 差 **54 ahead / 198 behind**，且工作树很脏（30+ modified、50+ untracked）、`host-plugin/` 整个不存在 | developer 实测。**⇒ 在 vm1 跑任何构建/校验前，必须确认它已被 scp 同步**，否则结论不可信（流水线本身每次 scp 覆盖 src，属正常设计） |

**顺带确认的两条好消息**（下轮可直接依赖）：
- **vm1 工具链齐全**：JDK17（`openjdk 17.0.20.1`）在 PATH、SDK `/home/user/android-sdk`（build-tools/platforms/platform-tools/licenses 齐）、
  `android-app/gradlew` 存在可执行、`openspec 1.14.1` 在 `/usr/local/bin`、`~/.local/bin/node` v22.22.3 **带 `stripTypeScriptTypes`**。
- **台式机确实没有** node / openspec / JDK（`Get-Command` 全 not found）⇒ 「本地跑不了 gradlew」属实，构建只能在 vm1。

**仍挂红的既有缺陷（交下一轮，非本轮范围）**：
`openspec validate --changes --strict` → **exit 1**，`dsh-push-web-link-out-of-box` 的 MODIFIED 需求
「提问推送（宿主插件路径）」**漏抄现网 scenario `载荷缺字段`**（现网 spec:48），正撞 AGENTS.md 红线
（MODIFIED 整块替换现网 ⇒ 漏抄=删场景 ⇒ `openspec archive` 会被拒）。引入于 `168cd03`。
**developer 已获授权单文件修复中**，本轮结束前会给出修复后的 strict 输出。
> **🔧 本轮已修复（lead 复核并提交 `c215691`）**：逐字补回 `载荷缺字段`（+5 行、零删改），
> 判据 `tools/openspec-modify-check.mjs` exit 0（2 modified / 0 problem）+ vm1 真 CLI `--changes --strict` **3 passed / 0 failed**。
> **残余**：`openspec validate --all --strict` 仍有 6 项失败，其中 5 项为 **WARNING 级**（Purpose 占位/过短、requirement >500 字符）——**未处理**。

## 3.12 ⚠️ 陷阱：跑 `dsh-app-verify.ps1` **不加 `-Deploy` 也会推用户真机**（2026-10-14 发现并拦截）

**由 developer 在 task-3 只读准备时发现，lead 亲自读源码复核成立。** 这条能直接造成"做个自检却惊动用户手机"的事故。

| 事实 | 判据（行号） |
|---|---|
| **第 3 段 `Stage "publish"` 是无条件发推** | `verify/dsh-app-verify.ps1:319` `Stage "publish"` → `:321` `POST ($ntfy + "/" + $topic)`。**不在任何 `$Deploy` 守卫内** |
| **全文只有一处 `$Deploy` 守卫** | `:398` `if ($Deploy -and (...).Count -eq 0) { ... }` —— 只管**上传 aliyun + 更新通知（第 6 段）**，管不到第 3 段的测试推送 |
| **命令行 `-Topic` / `-Ntfy` 改不动它** | `:54` `if (Test-Path config.local.ps1) { . ... }` 在 param 块（`:29-45`）**之后** dot-source；`config.local.ps1` 自己写「Values here override script param defaults (**but also override same-named command-line args**)」 |
| **现值就是生产 topic** | `verify/config.local.ps1`：`$Topic = "dsh"`（原文注释 *"production mirrors to real phone!"*）、`$Ntfy = "https://ntfy.cpyh.xyz"` |

⇒ **只要跑 `dsh-app-verify.ps1`（哪怕完全不传 `-Deploy`、哪怕传了 `-Topic qa-xxx`），用户真机都会收到一条 `auto-verify <epoch>` 卡片。**

**处置（lead 裁决）**：
1. **凡"不发布"的验证（如本轮 task-3 构建+装机自检）→ 不要调这个脚本**，改走**手工最小三件套**：
   vm1 `gradle assembleDebug` → `scp` APK → 笔电 `adb install -r` + `dumpsys package … | grep versionName` + `am force-stop`。**零 ntfy**。
2. 若要**验脚本本身**，必须先编辑 `verify/config.local.ps1` 把 `$Topic` 临时改成 `qa-…`（**改配置属 tester/lead 范围**），验完**还原**。
3. **别指望命令行覆盖**——已被源码证明无效（param 默认值再好看也会被 config.local 压掉）。
4. **纪律不变**：纯测试推送一律 `qa-` 前缀 + epoch 唯一串、最少条数；生产 topic `dsh` 直连用户真机。

**顺带三条环境事实（developer task-3 只读探测，lead 已核实）**：
- **vm1 `gradle` 不在 PATH**（`which gradle` 空）⇒ 必须显式 `export PATH=$HOME/gradle-8.7/bin:$JAVA_HOME/bin:$PATH`；
  `JAVA_HOME=/usr/lib/jvm/java-1.17.0-openjdk-amd64`（脚本 `:197` 硬编码此路径，实测在位）。
- **`android-app/local.properties` 已含 `sdk.dir=/home/user/android-sdk`** ⇒ SDK 不必再显式给（与 TEAM-START 旧描述的"需显式给"有出入，**以本行为准**）。
- 手工构建前**必须先按脚本 `:191-194` 的顺序同步 src**（`rm -rf android-app/app/src` → `scp -r app\src` → `scp app\build.gradle.kts` → `scp build.gradle.kts settings.gradle.kts gradle.properties`），
  否则**构建的是 vm1 上的陈旧源码**（vm1 仓本身是陈旧快照，见 §3.11）。

## 3.13 证据纪律：两条"命令成功 ≠ 真的做了活"（2026-10-14 developer task-3 自查自曝）

这两条都是 developer **主动报告自己的证据不合格**，价值高于一个漂亮的 PASS。下轮凡做"构建/校验类"断言，先照这两条自检。

| # | 症状 | 真相 | 纪律（判据） |
|---|---|---|---|
| 1 | **弱证据**：`gradle assembleDebug` 报 `BUILD SUCCESSFUL in 8s`，看着像通过了 | 实为 `35 actionable tasks: 1 executed, 34 up-to-date` ⇒ **近乎 no-op，根本不能证明"现在能构建"** | 改 **`clean assembleDebug`** 重跑（`16 executed`），并用 **APK mtime = 构建时刻** 佐证。**判据：构建/校验类证据必须看「实际执行任务数」或产物 mtime，禁止只看 `BUILD SUCCESSFUL` / exit 0**。注意 `from cache` 是 Gradle 缓存、**不等于没跑**，要区分"缓存命中"与"up-to-date 没执行" |
| 2 | **假 FAIL**：报 `LAPTOP APK HASH MISMATCH`（看着像链路断了） | 文件其实**早已 scp 成功**（10,992,184 B）；是取哈希那步用了**嵌套引号** `ssh host "powershell -Command \"…\""`，被 PowerShell/ssh 引号层绞碎（报 `无法将"\"识别为 cmdlet` + `Cannot find path`） | **跨 ssh 传复杂命令一律 `scp` + `-File`**（把哈希闸门合进笔电侧脚本、用 `-ExpectSha256` 参数）。**嵌套引号是坑，与 `-EncodedCommand` 超长截断同源** |

**放大结论（本仓已累计 4 次工具假判：假 PASS / 假 FAIL 各 2 次）**：
凡"判据报错"，**先怀疑判据本身**，再怀疑被测链路。**空值/异常必须判 BLOCKED，绝不当 PASS。**

**task-3 完整结论**见 `TEAM-READY-2026-10-14.md` §4.7：三段哈希闸门（源码/回传/笔电）全绿、`INSTALL: Success`、
`versionName=1.32.10`/`versionCode=76` 与本文 §3.11 相符、**不发布已做机械证明**（三执行文件检索
`ntfy|curl|Deploy|aliyun|POST|adb root` **零命中**）、设备已复位且**未动 `adb root`**（root 态留给 tester task-4）。

## 3.14 ✅ 自愈真机验证 FIXED：SwiftShader 实例被拉回真 GPU（2026-10-14 20:00，用户批准）

**背景**：F1–F3 加固版部署后，「真出现软渲染实例时自愈能否把它拉回真 GPU」**一直只有干跑（注入）证明**。
用户 2026-10-14 批准执行（"可以做验证"）⇒ **这是该链最后一块实测闭环**。**由 lead 执行**
（`verify/TESTER.md` 明令 tester 不得自己切 GPU 模式/冷启笔电）。

### 结论

> **FIXED**：真的造出一个 **SwiftShader（CPU 软渲染）** 实例后，**生产模式**自愈
> （`schtasks /Run /TN emu-selfheal`，**无参数**）自动完成
> `检出 VIOLATION → kill 整树 → 清 AVD 锁 → rung 1 -gpu host → 拉回真 GPU`（**37s**），
> 选择器写回 `host`，任务 **`LastTaskResult=0x0`**。**全程无需人工干预。**

### 时间线与承重判据（权威 = 客机 `dumpsys SurfaceFlinger` 的 `^GLES:` 行）

| 时刻 | 事件 | 判据 |
|---|---|---|
| 19:59:54 | 前态 | pid `34436`、`-gpu host`、渲染器 **NVIDIA RTX 4060**、选择器 `host` |
| 19:59:54 | **故意降级**（kill 整树 + 选择器 `swiftshader_indirect` + 起 rung） | — |
| 20:00:25 (+31s) | 软渲染实例就绪 | 渲染器 = **`Google (Google Inc.) ... Google SwiftShader, OpenGL ES 3.0 (SwiftShader 4.0.0.1)`**，`-gpu swiftshader_indirect`，pid `28596` |
| 20:00:42 | 自愈判 **VIOLATION** → kill | 日志：`VIOLATION: guest is healthy but NOT rendering on the host GPU` + `killing emulator tree, pids 40744,28596` |
| 20:00:54 | 清锁 → **rung 1 无条件先试** | `rung 1: real GPU (-gpu host) -- attempted unconditionally` |
| 20:01:20 (+24s) | 客机起、**渲染器确认 NVIDIA** | `RESULT: host-GPU ladder OK in 24s (real GPU confirmed by renderer)` |
| 20:02+ | 收尾 | `State=Ready`、**`LastTaskResult=0x0`**、选择器 `host`、`-gpu host`、pid `36308`、`boot_completed=1` |

**这张日志同时把 F1/F2/F3 三条修复全部钉死为实测**：
- **F1**：`interactive console session: False` 却仍 `rung 1 ... attempted unconditionally` ⇒ 旧的假前提岔路确实已移除；
- **F2**：`VIOLATION → correcting → kill` ⇒ 渲染器判据**真在决策**（不是只写日志）；且切换前后两轮均正确判 `already healthy ON THE REAL GPU`（**未误判健康实例**）；
- **F3**：选择器被写回 `host` ⇒ 软渲染没变成持久默认。

### 两条必须如实说明的细节

1. **一个"看起来像失败"的中间读数**：步骤 2 刚跑完立刻读任务状态 = `State=Running`、`LastTaskResult=267009`（`0x41301` = **正在运行**，**不是错误码**）；等收尾后复读 = `Ready` / `0x0`。
   ⇒ **纪律：读 Windows 计划任务结果必须等它离开 `Running`**。
2. **用户禁止的稳态窗口 ≈ 23s**（20:00:19→20:00:42 检出），全程 ~86s。已压到最短；**且验证本身即证明该状态不再需要人工脱离**。

### 复位与设备末态（复核通过）

选择器 **`host`**｜`-gpu host`｜渲染器 **NVIDIA RTX 4060**｜`boot_completed=1`｜pid `36308`（全新实例）｜
`adb forward --list` **空**｜`pidof xyz.cpyh.dshpush` **空**｜自愈任务 `Ready` / `0x0`。

**验证脚本**：`F:\work\work_dsh\tmp\t5-swiftshader-correction.ps1`（纯 ASCII、语法通过；`scp` + `-File` 下发，未用 `-EncodedCommand`）。
**完整报告**：`INFRA-HEALTH-2026-10-14.md` **§9.7**（含时间线、日志原文、两条如实说明、复位表）。

### 2.1 🔎 附带实测（2026-10-14 20:02）：自愈重启模拟器**真的会把 adbd 打回非 root**

验证收尾时读到 **`whoami = shell`**（非 root），而验证**开始前是 `root`**（tester task-4 特意复原）。中间只发生一件事：**自愈 kill 旧模拟器 + 重起新实例**。

⇒ **H-1 的因果链被实测坐实**（此前只有 tester 用 `adb unroot` 人工复现）：
```
自愈重启模拟器 → adbd 掉回非 root (whoami=shell)
              → am start .WebActivity 被拒 (SecurityException, Activity 未导出)
              → QA 脚本若没有 requireRoot() 前置 ⇒ 整轮起页 BLOCKED
```
**关键**：这条路径**自动发生**，不需要任何人工 `adb unroot` —— 只要自愈纠正过一次（如本次验证本身），**下一次 QA 轮就会撞上非 root**。
⇒ **task-4 的 `requireRoot()` 不是保险条款，是必需的**；与 §4.6.1「顺序铁律是承重的」是同一条结论的两半。

> **纪律**：**模拟器被自愈重启后，不要假定 adbd 仍是 root**。判据 `adb shell whoami`（QA 脚本已自带断言，非 root 即报 BLOCKED）。

### 2.2 真机验证的末态复核（清理后）

| 项 | 值 |
|---|---|
| 验证脚本残留 | 已清（`validationScriptGone=True`） |
| 加固版本体 / 备份 | `21C1856B…` / `BE99A7F9…` 均在（deliverables 未损） |
| 选择器 / qemu / 渲染器 | **`host`** / `-gpu host` / **NVIDIA RTX 4060**（pid `36308`，`boot_completed=1`） |
| 几何 | `1440x3168` / density `640`，无 override |
| 设备 | `forward --list` 空、`pidof` 空、`font_scale=1.0`、`airplane=0`、`whoami=shell`（见 §2.1，**非缺陷**） |
| 自愈任务 | `State=Ready`、`LastTaskResult=0`、最近窗口 `VIOLATION=False` |

## 3.15 三个仓库与云端同步状态（2026-10-14 20:1x 核对并推送，下轮照此复核）

| 仓库 | 路径 | 云端 remote | 本地 HEAD | 同步 |
|---|---|---|---|---|
| **dsh-push**（私有主仓） | `F:\work\work_dsh\dsh-push` | `origin` = **gitee** `cnopone/dsh-push` | `6fe6ff2` | ✅ **已对齐**（本次推 `141c2da..6fe6ff2`，**129 个提交**此前一直只在本地） |
| **skills**（技能仓） | `C:\Users\<user>\.dsh\skills` | `origin` = **gitee** `cnopone/cp_learn_dsh_skill_windows` | `4dbf432` | ✅ **已对齐**（推 `ec8bb95..4dbf432`） |
| **dsh-push-public**（开源镜像） | `F:\work\work_dsh\dsh-push-public` | `origin` = **GitHub** `thiscp/dsh-push`；`gitee` = `cnopone/pub-dsh-push` | `db65c51` | ✅ **双远端均已对齐** |

### ⚠️ 陷阱：`dsh-push` 的**上游被设成了 `vm1`**，`git status` 会误报"有 217 个提交没推"

`master` 的 upstream 是 **`vm1/master`**（`user@<tailnet-vm1>:work/projects/dsh-push`），而 vm1 那台仓是**陈旧脏快照**（曾 `HEAD 92147dd`，见 §3.11）。
所以 `git status -sb` 会显示 **`ahead 217, behind 54`** —— **这是对 vm1 的差距，不代表云端落后**。
**判据（别被误导）**：
```powershell
git fetch origin; git log --oneline origin/master..HEAD   # 对 gitee 云端：应为空
```
⇒ **要判断"云端是否落后"，一律比 `origin/master`（gitee），不要比 `vm1/master`。**

**本次实际核对结果**：推之前 `origin/master..HEAD` = **129 个提交**（含本轮建团队/就绪自检全部产物 + 上一轮基础设施加固），
以及 `dsh-push-public` 落后私有仓约 9 小时（`b6e755b` 10:58 → 私有 `6fe6ff2` 20:04）。**均已推送对齐。**

### skills 仓本次提交内容（`4dbf432`）

- **新增两个从未入库的 skill**：**`dsh-push-app-dev`**（本轮大幅更新：GPU 一条命令判据、F1–F3 加固+真机验证、6 条新硬事实）、
  **`dsh-team-model-control`**（队友模型不可改 vs 子智能体可指定）。
- 同步 5 个 skill 的更新：`gpu-mode-switch`（+`REFERENCE-strata-engine-startup.md`）、`dsh-peer-supervision`（+`dsh-restart-resume.{cmd,mjs}`）、`aliyun-relay-ops`、`dsh-push-nightly-watch`。
- **提交前做了 diff 级密钥扫描**：新增 660 行中 `tk_*` / `Bearer` / 私钥 **零命中**（`gitee` 仓无 `export-public` 那样的自动脱敏闸门 ⇒ **提交前必须手扫**）。

### 开源同步纪律（重申）

`dsh-push-public` **不是手改的**，一律由私有仓镜像：`verify\export-public.ps1`（`git archive` 私有 HEAD → 脱敏 map → 密钥闸门 → 镜像 → 推 GitHub+Gitee）。
**改完私有仓要同步开源时**：先 `-DryRun` 自证（脱敏命中数 + 闸门，零副作用），再正式跑。**别手工往 public 里改文件**（下次 `/MIR` 会覆盖）。

## 4. 跨轮未决（在下轮开工前处理或显式推迟）

1. **DSH 上游两条补丁**（源码仓，非本仓）：`tool-ask-user` 默认值 `legacy`→`timed`；`UserQuestionService.ask()` 加完成作用域 AbortController。做掉后连 legacy 会话都不再僵卡，新用户零配置。
2. **A14/A15/P04 命中区基线在 CSS360 下未重打**（旧 411 宽数字作废）。
3. **GPU 模式下的截图耗时基线未重打**（swiftshader 数字不可对照）。
4. **QA 报告 §6 未覆盖面**：真机 OriginOS 通知栏行为、30 条消息满载、C03/C04 用例。
5. **`claimForeground` 两种设置的用户可感差异**：产品取舍待用户拍板。
