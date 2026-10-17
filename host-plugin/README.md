# dsh-push-host

DSH 宿主插件：**进程内**把待答问题推到手机（ntfy），并把手机迟到作答灌回 agent。
它是"外部通知器 + 外部作答桥"这条老链路的替代品 —— 插件跑在 DSH 自己进程里，用 DSH 的
`userQuestions` seam，不再需要 cookie、`/api/remote.mux`、RPC，也不再需要伺候 token 轮换。

```
ask_user_question (工具, 进程内)
  └─ ctx.waterfall("user-questions/request")
       ├─ dsh-push-host 监听器（prepend）
       │    ├─ POST relay /answer/register  {callId, agentId, questions, hostId}   ← 手机能答
       │    ├─ POST relay /            (ntfy JSON: 标题/正文/#qid/#opts/#web/#name) ← 手机收到
       │    └─ return next()            ← 前台作答权仍归 DSH Web UI（插件不抢）
       └─ Web UI 作答器（浏览器在线时照旧作答）
     轮询环 ctx.interval(s)
       └─ GET relay /answer/pending?host=X (X-Host-Token)
            ├─ 问题仍在 open 窗口 → 不 ack，留在 relay 队列里等（答案不丢）
            └─ 问题已 continued   → ctx.userQuestions.answer(活根 agent, callId, {answers})
                                   → agent.steer(答案消息) → ack
```

## 两条硬约束（先读，不然会白跑）

1. **`request.wait.timed` 必须为 true，手机作答才可能生效。**
   `answer()` 只能答 **continued** 态（`dsh-user-questions` 的投影只 fold `wait.timed === true` 的调用）。
   而 `ask_user_question` 只有在 `tool-ask-user` 配 `mode: timed` 时才会走 `askTimed()`。
   **本机实测（2026-10-12）**：`web` / `desktop` / `headless` 三个 profile 的 `tool-ask-user`
   都是默认 `mode: legacy`（`--dump-config` 里该条目无 `config`），所以现状是
   `wait = { callId }`、`timed=false` → 投影永远空 → 手机作答无法落地（只能弹通知）。
   插件对每个问题都打 `timed=` 并在 `timed=false` 时明确拒绝（把该答案 ack 掉并打印原因），
   不会静默丢答案。
   要开：`tool-ask-user` 加 `config: { mode: timed, timeout: <秒> }`（0 选项窗口消失，
   工具到点先返回 `pending`、agent 继续干活，之后手机答案以 user 消息形式插回 agent）。
2. **不要和老的 hook 推送同时开。** `deploy/windows/hooks.json` 的 `PreToolUse` 推送与
   本插件是同一件事的两条路径，同时开会双推（通知栏两条卡片）。任务结束（`Stop`）推送目前
   仍归 hook 路径，本插件只做"提问 → 作答"这一环。

## 三个踩过的坑（都在这份代码里修掉了，别改回去）

1. **同一个 URL 反复 GET 会被喂回第一次的响应。** 轮询环最初用固定 URL
   `…/answer/pending?host=X`，实测（2026-10-12 真机）：relay 队列里明明有两三条待答，
   插件却反复只处理最早那一条、新的永远不出现。给 URL 追加一个每次都不同的
   `&_=<毫秒时间戳>` 后立刻正常。**结论：走 DSH 的 fetch（自带代理层）做轮询，URL 必须唯一化。**
   证据：加 `_` 之前日志只有 `delivery deferred for <旧 callId>`；加之后立刻出现
   `queue: 2 item(s) [旧 新]`，两条都被处理。
2. **投影状态是嵌套的。** `sessionProjections.stateOf(session, 'userQuestions')` 返回的是
   fold 的内部 state：`{ timed, questions: { active, settled } }` —— active/settled 在
   **`questions` 下面**（照抄 `dsh-user-questions` 自己 `continued()` 的写法）。少写一层会拿到
   `undefined`，而早期代码把 `undefined` 当"问题已结束"→ 把仍在等待中的问题的答案静默 ack 掉。
   **现在的判据是：只有 `settled` 里明确有该 callId 才丢弃，读不到状态一律留在队列里重试**
   （relay TTL 1h 兜底，日志按 callId 节流）。
3. **前台窗口期内的答案要"扣着"。** `answer()` 只认 `state === 'continued'`；`state === 'open'`
   时调用它返回 `false`。此时**不 ack**、留在队列里，等前台等待结束（timed 的 timeout / UI 作答）
   下一轮再投。

## 生产切换踩过的坑（2026-10-12/13，五个，都在这份代码里修掉了）

1. **schema 校验后的空默认值会盖掉凭据文件。** `apply()` 拿到的 `config` 已经过 schema 校验，
   空串默认值（`host: ''`、`hostToken: ''`、`ntfyToken: ''`、`regToken: ''`…）**全都在**，
   于是 `{...fromCredentials, ...config}` 把文件贡献的每个值都擦成空 → 插件在**完全正常的**
   凭据文件上打 `relay disabled`（旧 hook 已退役 = 手机彻底收不到通知）。
   修法：空串/`undefined`/`null` 一律算"没设置"，`false` 仍然有效（`explicit` 过滤）。
   回归断言：`plugin-selftest-credentials.mjs` 的「① 空 schema 默认值不覆盖凭据文件」
   与「① 显式非空仍赢，`false` 不被当成 unset」两条 —— 用**整份 schema 形状的 config**
   （每个字段都带默认值）打 `resolvePluginConfig`，这是唯一能复现该 bug 的输入形状。
2. **`regToken` 必须同时在两张表里。** `lib/index.js` 的 `CREDENTIAL_CONFIG_KEYS`（决定哪些键
   *可以*来自文件）与 `lib/credentials.mjs` 的 `CREDENTIAL_KEYS`（决定文件里的键怎么*读进来*）
   是两处独立白名单。只改前者 = 文件里的 `regToken` 从来不会出现在 `file.value` 里，
   `pickConfigKeys` 什么也挑不到，`X-Reg-Token` 发空串 →
   `POST /answer/register` 永远 `401 bad reg token`（relay 侧判据：
   `X-Reg-Token != open("/etc/answer-relay/regtoken").read().strip()`）。
   回归断言：`② 每个 CREDENTIAL_KEYS 字段都在 CREDENTIAL_CONFIG_KEYS 里` +
   「`POST /answer/register` 真的带上文件里的 `X-Reg-Token`」（线级断言，不是看 getter）。
3. **`dsh plugin add` 会重写 profile 的 `cordis.patch.yml`**（注释被丢、行尾换成 LF），
   而且**同版本 `file:` 再 add 一次是 no-op**（"Already up to date"，代码不会替换）。
   改完代码要生效必须：`Remove-Item -Recurse ~\.dsh\profiles\<p>\node_modules\<包>` →
   `dsh plugin --profile <p> add <tarball|dir>` →（热加载不生效，见下）重启宿主。
   `hmr` 插件**不会**重载 profile 的 node_modules 里的 bundle 插件：实测改一行注释后
   web.log 十分钟没有新的 `relay ready`。所以「改代码 → 重启」是硬路径。
4. **顶层按 id patch `tool-ask-user` 会 `entry not found`。** 它不在 profile 根节点上，而是
   **嵌在 agent preset 的 `plugins:` 列表里**（`preset-standard` / `preset-ptc` / …，一份 profile
   里可以有好几个同名节点）。改它要么**改进那份 preset 的完整声明里**（patch 会整块替换
   `config`，所以必须逐字重述整份 preset，见 `profiles/web/cordis.patch.yml` 里由
   `make-preset-override.mjs` 生成的那份），要么用顶层 `- insert:` 插一个新节点。
   **`--dump-config` 退出码 0 不等于挂上了**：先看目标 id 那一行的内容。
5. **日志里的 `timed=false` 不一定是真的。** `tools/pre-execute`（竞位兜底触发点）在 waterfall
   之前跑，只能从**工具入参**猜 `timed`（`args.timeout`）；而模型通常**不传**那个可选参数 →
   猜到 `false`，随后真正权威的 `user-questions/request`（看 `wait.timed`）被 `announce()` 的
   去重挡掉，于是"唯一的证据"就是那条错的 `timed=false` + 那句"没 timed wait"的 note。
   2026-10-13 排查 ② 时被它误导过一轮。修法：`timed` 被 waterfall 校正回 `true` 时补打
   `question <callId> timed corrected to true by the request waterfall (…)`，并且
   **register 成功也打一行 `register <callId> -> HTTP 200`**（原来只打失败，401 反而藏在
   "没有 200 那行"里）。
   **权威判据只有两个**：probe/waterfall 打出来的 `wait.timed`，以及"问题到点后返回
   `{pending:true}`"（legacy 模式永远返回不了 pending，它要么等到 UI 作答、要么 `NO_PROVIDER`）。
   反过来，模型显式传 `timeout: -1`（"必须等到答案"）时走的是 **legacy** 路径 ——
   那时 `timed=false` 是真的，手机作答确实落不了地（`{"error":"no user-questions answerer
   accepted the request"}`），这不是配置错。
6. **默认凭据路径曾经是 cwd 相对路径。** `CREDENTIALS_FILE` 原为
   `.config/dsh-push/credentials.json`（相对），经 `path.resolve()` 后**跟着进程 cwd 走**：
   web 实例的 cwd 恰好是 `C:\Users\<user>` 所以一直没事；换个目录起 DSH（工作区、仓库根、
   快捷方式的"起始位置"）就**静默丢失凭据**（缺文件 = 干净 no-op，日志里只剩一句
   `relay disabled`）。修法：默认值改成 `~/.config/dsh-push/credentials.json`（显式 `~`，
   由 `expandHome` 拼到 home）；用户自己写的相对路径仍是 cwd 相对。
   回归断言：`⑤ 默认路径锚在 home 目录，不跟 cwd 走`；另外 `plugin-selftest.mjs` 第 5 节
   现在**显式钉一个不存在的 credentialsFile**——修好路径之后，它才会去读开发机真实的凭据文件。

## 网页提问卡的生命周期：legacy 提问为什么会僵卡锁 composer（2026-10-14，源码级根因，用户真机实遇）

现场：`claimForeground=on` 下手机抢答成功（`answered (foreground)`、工具当场返回、会话继续），
但 DSH Web 的提问卡停在可交互未答态**霸占 composer**，用户发不出新消息只能点「跳过」；**刷新也不会好**
（gateway 把仍挂着的转发请求重投给重连浏览器，未答卡原样重现）。服务端没有任何错：答案已按
`tool/result` 落 transcript，对已结算 callId 再点跳过是无害空操作
（`UserQuestionService.answer` 对不在 `continued` 的直接 `return false`）。

根因（三层同时失效，缺一都不会僵）：

1. **没人取消转发给浏览器的那条 dispatch**：插件（prepend listener）race 赢过 `next()` 提前结算
   瀑布后，`dsh-api-remotes` 的 `forwardWaterfall` 没有"上游已结算"的取消路径，dispatch 悬挂；
2. **cancel 帧不发**：gateway 的 cancel 只由 `request.signal` abort 触发，而 legacy 的 signal 是
   回合 phase 信号，正常完成**永不 abort**（新 phase 只替换 AbortController 不 abort 旧的）；
3. **投影不含 legacy**：`userQuestions` 投影按设计只折叠 `timed` 调用（判据=会话 header 记录的
   工具 schema 是否声明 `timeout`），legacy 提问连 callId 都不带（匿名卡），reconcile 的删除
   通道直接跳过它。

**会话代际钉死**（最容易误判的一点）：ask_user_question 的 timed/legacy 变体在**会话创建时**
钉进会话 header，**改 profile + 重启都不换**老会话的变体。所以 `mode: timed` 配好之后：
新建会话双向同步正常（手机答→wait 关→signal abort→cancel 帧→卡片即关；网页答→回声→手机卡转已答，
2026-10-14 用户真机验收过）；老会话仍是 legacy，僵卡照旧点「跳过」无害解锁。
判据：web.log 该 callId 行 `timed=` 值（注意坑 5 的校正假象，权威判据仍是 `wait.timed`）。

**根治 legacy 的最小补丁**（DSH 源码仓，`packages/user-questions`，编译层
`dsh-user-questions/lib/index.js` 的 `ask()`）：新建 `const dispatchDone = new AbortController()`，
向 waterfall 传 `signal: AbortSignal.any([request.signal, dispatchDone.signal])`，`finally` 里
`dispatchDone.abort()`——瀑布被**任何**应答者（含进程内抢答）结算即触发 gateway cancel 帧关卡，
timed 路径行为不变。插件侧修不了（`firstOf` 赢后够不着那条 dispatch，别在插件里补）。

## 端到端验收记录（2026-10-12，真 agent + 真 relay + 真 ntfy）

测试 profile `pushtest`（`--from-default-profile headless` 新建），覆盖层插入
`tool-ask-user`（`mode: timed, timeout: 60`）与本插件，让一个真 agent 连问两个问题；
在第一个问题的**前台窗口期内**用 curl 从手机侧提交答案：

| 观测 | 证据 |
|---|---|
| 通知层推送 | ntfy topic 收到 `DSH 等你选择 [1054fc8c]`，正文含 `📱 作答: …/answer/<callId>` + `#qid q1` + `#opts q1=first\|second` + `#name win-test`，priority 4 |
| 注册生效 | `GET …/answer/<callId>` 返回作答页；`POST /answer/submit` 回 `{"ok":true,"queued":true,"host":"test1"}` |
| 窗口期内扣住 | `not answerable yet (state=open); keeping the phone answer queued and retrying` |
| 超时后投递 | `answered (continued) call_00_5Y7r…`（`ctx.userQuestions.answer()` 返回 true）→ ack → 队列清空 |
| **agent 真的收到** | agent 最终回复：*"The first call returned pending (no answer before the 60-second timeout); the user later answered it with \"second\"."* |
| 手机清通知 | topic 收到 `DSH 已答` + `#ans <callId> second`，priority 1 |
| **任务结束推送** | topic 收到 `DSH 任务结束 [1150afd5]`，正文 `目录: F:\work\work_dsh` + `#name win-test`，priority 3（同轮只发一次） |
| **UI/任意端作答回声** | 真工具调用返回答案后 topic 收到 `DSH 已答` + `#ans <callId> first`，priority 1（`tools/post-execute` 路径） |
| 挂载验收 | `--dump-config` 尾部 `# == dsh-push-host` / `- id: push-host` / `name: dsh-push-host` |
| 纯逻辑回归 | `node plugin-selftest.mjs` → `48/48 checks passed` |

## 分发（npm 包）

本包按可发布的 npm 包组织（`package.json` 带 `repository` / `homepage` / `bugs` / `author` /
`publishConfig.access: public` / `engines` / `files` 白名单，MIT `LICENSE` 随包）。
发布由仓库维护者做（`npm publish`，本机没有 npm，见下），用户侧只需 `dsh plugin add`：

```powershell
# 从 npm 装（发布后）
& $dsh plugin --profile <profile> add dsh-push-host

# 从 tarball 装（离线/内网，等价路径，已实测）
& $dsh plugin --profile <profile> add ./dsh-push-host-0.2.1.tgz

# 从本地目录装（开发期，改完立即生效）
& $dsh plugin --profile <profile> add "link:<仓库>/host-plugin"
```

三种方式在 profile 里的落点完全相同：`package.json` 的 `dependencies` 多一项、`dsh.profile.bundles`
多一项（DSH 读到本包的 `dsh.bundle.patch` 自动登记 bundle 层）。

**打包**：有 npm 的机器直接 `npm pack`（`files` 白名单已配好）；本机没装 npm（DSH 只带 pnpm），
所以仓库里配了等价工具，输出同样的 `npm notice` 清单与 sha1：

```powershell
& $node tools/pack-npm-tarball.mjs host-plugin --dry-run   # 只看清单，不落盘
& $node tools/pack-npm-tarball.mjs host-plugin             # 落盘 host-plugin/dsh-push-host-0.2.1.tgz
```

实测产物 9 个文件：`LICENSE`、`README.md`、`cordis.patch.yml`、`package.json`、
`lib/{index.js,relay.js,credentials.mjs,pairing-lib.mjs,pairing.mjs}`（合计 85,706 B，tarball 30,300 B）。
`package.json` 里的 `files` 白名单决定这份清单；两个 `*-selftest*.mjs` 与 `relay-selftest.mjs`
**不进包**，需要验收就 `git clone` 仓库跑。

一条命令复现"清单 → 打包 → 装进全新 profile → 验挂载 → 验凭据文件"（8/8）：

```powershell
& $node tools/verify-distribution.mjs --profile pushdist      # 也可 --profile <新名> 全新建 profile
```

## 安装（已验证命令序列）

```powershell
$dsh = '<DSH 安装目录>\resources\runtime\cli\bin\dsh.cmd'      # 不在 PATH 上

# 1. 从随附模板新建 profile（别动 web / desktop 这两个在用的）
& $dsh --profile pushdist --from-default-profile headless --dump-config

# 2. 把包（或 tarball）装进去
& $dsh plugin --profile pushdist add ./dsh-push-host-0.2.1.tgz

# 3. 验收挂载：看 dump-config 尾部
& $dsh --profile pushdist --dump-config | Select-Object -Last 3
#   # == dsh-push-host
#   - id: push-host
#     name: dsh-push-host
```

`dsh plugin add` 后 `profiles/<name>/package.json` 应有两处变化：`dependencies` 多一项、
`dsh.profile.bundles` 多一项（bundle 机制会读本包 `package.json` 的 `dsh.bundle.patch`）。
`pnpm` 报 missing peer（`@deepseek-ai/cordis` 等）是**设计如此**：peer 由宿主 closure 提供。
三个 profile 里 `--dump-config` **不加载**插件（只打印树），所以 dump-config 里看不到插件的
`credentials file:` / `relay ready` 日志——那是启动时才打的。

**一键版**（给用户用，2026-10-14 实测）：上面三步 + timed 切换 + dump-config 验收打包成一条命令，
幂等（marker 判重）、改前带备份、新建 profile 的 `[]` 空模板会整体替换而不是追加
（`[]` 后追加块序列是非法 YAML，实测炸过）：

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File deploy/windows/install-user.ps1 `
    -Profile <profile> -DshCli "<DSH 安装目录>\resources\runtime\cli\bin\dsh.cmd" `
    -Source .\dsh-push-host-0.2.1.tgz
# 成功后照打印的 next steps 走：重启 DSH（工具注册是冷的）→ 用新会话（变体钉在会话创建时）
```

## 设置页开关：手机作答模式（v0.2.1，用户不用碰命令行）

装 0.2.1 后，设置页出现 **dsh-push 手机作答模式** 一行：显示**实际**是 `timed`（手机可作答）
还是 `legacy`（手机只能收通知），右侧一个「启用」按钮。点一下即完成上面「一键版」里
`tool-ask-user` 那步的全部工作——**且不需要重启宿主**。

> **0.2.0 是坏版本，别用**（2026-10-14 生产 P0）：它的 `askUserMode` 默认 `legacy`，把
> 「用户没表态」当成「用户要 legacy」，开机 sync 直接把生产 `tool-ask-user` 从 timed 反向
> 降级成 legacy 并写进 patch 文件；回滚文件后活进程又被 reconcile 触发再降级两次。0.2.1
> 的守卫（下面表格）逐条对着这三个缺陷修。

内部链路（都已源码核实 + selftest 覆盖）：

| 环节 | 实现 |
|---|---|
| 客户端 UI | `lib/client.js` 手写 `window.__ModuleLoader__.load({id:"dsh-push-host"})` 模块，注册 `settings.general.item` 槽行，`whileServed('push-host')` 门控；`package.json` 加 `dsh.client:{platform:"web"}` + `exports "./client"` |
| 状态判定与展示 | 宿主侧 `ctx.tools.get("ask_user_question")` 看 schema 是否含 `timeout` 参数（= timed 变体，判据同 DSH 的 `isTimedAskUserQuestionSchema`）；实际态经 `Symbol.for('cosmokit.volatile.write')` 写进 volatile `askUserActual`（**纯内存不落盘**），设置行读它——**不拿期望态当展示值**；`tools/change` 补激活顺序坑 |
| 客户端→宿主 | 设置行写 push-host 自己的 `.volatile()` 字段 `askUserMode`（**无默认值**：schemastery 不加 `.default/.required` 即 optional——注意它没有 `.optional()` 方法也没有 `z.literal`）；宿主订阅 `ctx.on('loader/volatile-update', paths)`（该事件只投 owning fiber）触发 |
| 永不降级 | **只有显式 `timed` 会写**；未表态或 `legacy` 完全惰性（零写入零备份）；`configEditor.edit` 前还有最后一道闸断言 `desired === 'timed'` |
| 每进程一次 | 成功写一次后置 `done`，后续 sync 直接 return——外部修复（还原文件→reconcile）不会被活进程当成漂移再改回去 |
| HMR 事务 | volatile-update 在 settings RPC 的 HMR 事务内触发，事务里嵌套 `configEditor.edit` 会抛 `HMR transactions cannot be nested`；所有 sync 经 `setTimeout(0)` 延后到事务外合并执行 |
| 写入 | `ctx.configEditor.edit(tool-ask-user entry, …)`——DSH 官方通道：文件锁 + 原子写 + 失败回滚 + 热 reconcile；写非 volatile 字段会热重启该插件 fiber，timed 工具当场重注册 |
| 备份 | `configEditor` 无内建 .bak，edit 前自己 `copyFileSync(patchPath, patchPath + '.bak-<ms>')`（撞名加序号） |
| 失败可见 | 任何失败（含 home 层/CLI overlay 覆盖同 id 的 "overridden by a home patch"）经同一 volatile 符号写进 `askUserStatus`（**内存，不落盘**——0.2.0 曾把状态字符串写进用户 patch），设置行直接显示原因 |

生效范围（UI 上明写，也都是平台事实）：**新会话立即生效**；已在跑的老会话保持旧行为——
`ask_user_question` 的 timed/legacy 变体在**会话创建时**钉进会话 header，改配置/重启都不换
（见下文「网页提问卡的生命周期」）。若老会话踩到 legacy 僵卡，点卡片「跳过」无害解锁。
本开关**只升不降**：要回 legacy 手动改 profile 的 `cordis.patch.yml`（`mode: legacy`）。

无 UI 的场景（headless/VM/自动化）继续用 `deploy/windows/install-user.ps1`，两者干的是同一件事。

**selftest 运行时注意**（2026-10-14 实测坑）：必须用 **DSH 自带 runtime 的 node**
（`<DSH 安装目录>\resources\runtime\primary-runtime\dependencies\node\bin\node.exe`）。
harness 自己的 `~\.dsh\dsh-runtimes\...` 那个 node 同为 v24.21.0、`os.tmpdir()` 同为 `C:\Temp`，
但 `copyFileSync` 被拒（`EPERM: operation not permitted, copyfile`）；14 段前有 preflight
探针，撞到这个坑会打印指引并 **exit 2**（不是假 FAIL）。真基线 **104/104**（v0.2.2 加了 3 条 hash 片段断言）。

## 点推送直达来源会话（v0.2.2）

用户「通过消息通知上的卡片的 dsh 网页按钮进入网页后，似乎是之前默认的对话，能进入后直接进入推送通知的那个对话吗」。

两半都在本插件里，**不需要改 DSH 本体、不需要发 App 版本**：

1. **服务端半**（`lib/index.js:webUrl(sessionId)`）：把来源会话 id 作为 **URL hash 片段**拼到 `#web` 链接尾
   （`…?token=X#session-<uuid>`）。两条推送路径都带：提问（`questionBody(callId, questions, sessionId)`）
   与任务结束（`onTurnStopping`）。
2. **浏览器半**（`lib/client.js:revealFromHash(ctx)`）：读 hash，若当前会话不是它，就展开侧栏、点
   `[data-row-key="session:<id>"]` 那一行；到位后把 hash 抹掉（`history.replaceState`），免得用户切走后
   刷新又被拽回来。

**为什么是 hash 片段而不是查询参数**（两条实测理由，别再改回去）：

- `?token=` 入口回的是 **`303 See Other → Location: ./`**，查询串在这一步被丢掉；而浏览器跨跳转**保留 fragment**。
- 网页客户端**根本没有路由**（`createRouter` 在 bundle 里 0 命中；`pushState`/`popstate` 的命中都在 lodash 注释里），
  所以路径和查询串都没人读。

**选择器全是语义化的**（不依赖哈希类名，改版风险低）：当前会话 `[data-conversation-session="<id>"]`、
侧栏行 `[data-row-key="session:<id>"]`、展开侧栏 `button[aria-label="Open sidebar"]`。这些都是 2026-10-17
在 VM1 的 DSH Web 上实测出来的（窄屏 360 CSS px，模拟器 WebView + CDP）。

**降级安全**：id 形态不对（不是 `session-<uuid>`）就不拼链接；网页端找不到那一行（会话未加载、分组收起）
就静默放弃，最多 20s，等于本功能之前的行为。不认识 hash 的旧网页端也完全不受影响。

## 给一个真实用户开通（凭据文件 + 配对）

**目标**：开通一个用户，操作者要做的只有两件事 —— 在 relay 上跑一条开号命令、把打印出来的
配对载荷存成凭据文件。不需要给用户的 DSH 进程配环境变量，也不需要把令牌写进任何 YAML。

```
① relay 上：bash deploy/relay-user-add.sh alice
     ├─ ntfy 用户 dsh-alice-pub（topic dsh-alice 只写）/ dsh-alice-phone（同 topic 只读）
     ├─ relay 主机条目 host=alice + hk_ 队列令牌
     └─ 打印配对载荷 JSON ──┐
                            │  存成 ~/.config/dsh-push/credentials.json（原始 JSON 直接存）
② 用户的 DSH 主机上 ────────┘
     └─ dsh-push-pair              # 同一份载荷，原样输出给手机
     └─ dsh-push-pair verify       # 真打 relay/ntfy，逐项 PASS/FAIL
③ 手机 App：粘/扫 载荷里的 relay + topic + readToken
```

### 凭据文件（推荐路径，环境变量仍可用）

插件读 `~/.config/dsh-push/credentials.json`（可用 `DSH_PUSH_CREDENTIALS` 或配置项
`credentialsFile` 指到别处）。**直接就是 `relay-user-add.sh` 打印的那份载荷**，字段名一一对应：

```json
{
  "v": 1,
  "relay": "https://ntfy.cpyh.xyz",
  "host": "alice",
  "topic": "dsh-alice",
  "writeToken": "tk_…",
  "readToken": "tk_…",
  "hostToken": "hk_…",
  "regToken": "…"
}
```

> `regToken` 可以写进凭据文件（2026-10-13 起；env 仍优先），因为是**一份文件带走整条链路**这个
> 设计目标的一部分。不想把服务器侧秘密落到文件里的人，继续用 `DSH_PUSH_REG_TOKEN` 即可 ——
> 但**两条路至少要有一条**，否则 `POST /answer/register` 会 401，手机只能收通知、不能作答
> （见下文坑 ②）。

| 载荷字段 | 插件侧含义 | 谁用 |
|---|---|---|
| `relay` | `relayBase`（也用来拼手机作答页 `/answer/<callId>`） | 主机 |
| `host` | `host`，relay 队列的 hostId | 主机 |
| `topic` | `topic`，本机的 ntfy 主题 | 双方 |
| `writeToken` | `ntfyToken`，ntfy **写**令牌（只写权限） | 主机（插件推通知） |
| `readToken` | `phoneToken`，ntfy **读**令牌（只读权限） | 手机 App 订阅 |
| `hostToken` | `hostToken`，relay 队列 `X-Host-Token` | 主机（取答案/ack） |
| `regToken` | `regToken`，relay 注册令牌 → `X-Reg-Token` | 主机（注册问题） |

容错与顺序（都实测过）：

- 键名大小写/连字符不敏感，并接受别名：`writeToken`/`ntfyToken`/`pushToken`/`tkPub`、
  `readToken`/`phoneToken`/`tkRead`、`relay`/`relayBase`/`base`、`host`/`hostId`。
- 多用户一份文件也行：`{"relay": …, "host": "alice", "hosts": { "alice": { … }, "bob": { … } }}`，
  根字段是默认值、`hosts[host]` 覆盖它。
- 覆盖顺序（后者赢）：**内置默认 → 凭据文件 → profile/overlay 配置 → 环境变量**。
  所以老部署（只给三个环境变量）行为完全不变。反向也成立：**显式写下的空串仍算"没设置"**
  （见下文坑 ①），所以一份正常的凭据文件不会被 profile 里 schema 校验出来的空默认值擦掉。
- **默认路径锚在 home 目录，与进程 cwd 无关**（2026-10-13 修，见下文坑 ⑥）：
  `~/.config/dsh-push/credentials.json`。你自己在 `credentialsFile` 里写的**相对**路径仍然
  按 cwd 解析（老行为不变）。
- **没有这个文件 = 干净的 no-op**：插件不报错、不抱怨、不打网络，退化成透明监听器（和今天一样）。
  文件存在但读不了/JSON 坏了，才打一行 `credentials ignored: …` 并继续。
  ⚠ 正因为是静默 no-op，"路径算错了"和"还没开通"在日志里长得一模一样：**启动只信
  `credentials file: <path>` 那一行**（文件被找到才打）。

### 配对载荷：一条命令

`lib/pairing.mjs`（npm bin 名 `dsh-push-pair`，也可 `node <包>/lib/pairing.mjs`）：

```powershell
& $node dsh-push-host\lib\pairing.mjs payload --pretty      # 打印给手机粘的载荷
& $node dsh-push-host\lib\pairing.mjs verify                # 真打 relay/ntfy 自检（5 项）
& $node dsh-push-host\lib\pairing.mjs verify --json         # 机器可读
& $node dsh-push-host\lib\pairing.mjs payload --credentials-file D:\creds\alice.json
# v0.1.1：把网页入口一并写进载荷（存成凭据文件后插件即带 #web 直达链接，基址=手机可达的地址）
& $node dsh-push-host\lib\pairing.mjs payload --pretty --web-base http://100.x.y.z:3080 --web-name 我的机器
```

`payload` 输出**与 `relay-user-add.sh` 逐字同构**（`v` = 1、同样 7 个字段、同样字段顺序），
所以不存在第二套 schema；缺字段时**拒绝输出**并列出缺哪几项，不会吐半份。
`webBase`/`webName` 是**可选追加字段**（v0.1.1）：知道才写、不知道就不写（7 字段老载荷原样），
`relay-user-add.sh` 不知道用户的网络所以从不输出它们——只有跑配对命令的人知道手机该拨哪个地址。

`verify` 检查（只读 + 最多一条测试通知，不动别人的队列、不改 relay 状态）：

| 检查 | 通过判据 |
|---|---|
| `credentials-file` | 文件存在、JSON 合法 |
| `payload-fields` | 7 个字段都齐 |
| `relay-host-token` | `GET /answer/pending?host=<host>` + `X-Host-Token` → 200 |
| `ntfy-read-token` | `GET /<topic>/json?poll=1` + `Bearer readToken` → 200 |
| `ntfy-write-token` | `POST /`（ntfy JSON 发布）+ `Bearer writeToken` → 200 |

实测（真实 relay，占位/换掉的令牌）：`ntfy-read-token` 用真读令牌 = `HTTP 200`；换成别的 topic
= `HTTP 403`（ntfy 的 topic 级 ACL）；`relay-host-token` 用假 `hk_` = `HTTP 401 bad host token`。
即"令牌对不对"这件事在手机上动手之前就能判出来。

> **App 侧现状**：App 目前没有导入按钮——relay / topic / readToken 仍要在 App 里手填
> （见仓库 `README.md` 的"APP 侧"）。导入路径的提案（不改 App，只出方案）在
> `openspec/changes/dsh-push-distribution/specs/companion-app/spec.md`。

### 一个用户跑起来之前需要什么（清单）

1. **relay 上跑过开号命令**：`bash deploy/relay-user-add.sh <user>`（拿到 `hk_` 与两个 `tk_`）。
2. **载荷存成了凭据文件**：`~/.config/dsh-push/credentials.json`（或 `DSH_PUSH_CREDENTIALS`）。
3. **`dsh-push-pair verify` 5/5 PASS**（relay/ntfy 都通）。
4. **插件装进目标 profile**：`dsh plugin --profile <p> add dsh-push-host`，
   `--dump-config` 尾部有 `- id: push-host`。
5. **`tool-ask-user` 是 `mode: timed`**（否则手机只能收通知、答案落不了地，见上文硬约束 1）：
   ```yaml
   - id: tool-ask-user
     config: { mode: timed, timeout: 120 }
   ```
6. **旧的 hook 提问推送已关**（`deploy/windows/hooks.json` 去掉 `PreToolUse` 那组），否则双推。
7. **手机 App 已填** relay + topic + readToken 并订阅成功（App 里能看到 ntfy 的连上状态）。
8. 收尾：让用户提一个真问题、在手机上答一次，确认 agent 真的收到答案。

## 配置

非机密项放 profile 的 `cordis.patch.yml`，或 `--patch` 覆盖层里按 id 定向；**机密项优先走上面的
凭据文件**（文件优先级低于 profile 配置，所以 YAML 里显式写的值仍然能压过文件）：

```yaml
- id: push-host
  config:
    host: test1            # deploy/relay-user-add.sh 开出来的 hostId
    topic: dsh-test1       # 该 host 的 ntfy topic
    webBase: https://<tailnet 网关>   # #web 直达链接基址；不配则回退 web.log 里 DSH 自己打印的 URL（v0.1.1）
    webName: 台式机         # 多 DSH 入口选择器的显示名（#name）
    # credentialsFile: D:\creds\alice.json   # 不写就用 ~/.config/dsh-push/credentials.json
```

**令牌不要写进 YAML**：可以来自凭据文件（推荐），也可以来自环境变量（老部署，仍然支持，
且优先级最高）：

| 环境变量 | 含义 |
|---|---|
| `DSH_PUSH_HOST_TOKEN` | `hk_…`，relay 队列端点（`/answer/pending`、`/answer/ack`）的 `X-Host-Token` |
| `DSH_PUSH_REG_TOKEN` | relay 的注册令牌（服务器 `/etc/answer-relay/regtoken`） |
| `DSH_PUSH_NTFY_TOKEN` | `tk_…`，该 host 的 ntfy 写令牌（topic 权限 write-only） |
| `DSH_PUSH_CREDENTIALS` | 凭据文件路径（等价于配置项 `credentialsFile`） |

其余字段（均带默认值，缺省也能挂载，不会拖垮 host 启动）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `relayBase` | `https://ntfy.cpyh.xyz` | relay 基址，也用于拼手机作答页 `/answer/<callId>` |
| `answerBase` | 空 = 用 `relayBase` | 作答页另走别的域名时用 |
| `host` / `hostToken` | 空 | 二者任一为空 → 整个 relay 侧停用（只当透明监听器） |
| `credentialsFile` | 空 = 默认路径 | 空串表示 `$DSH_PUSH_CREDENTIALS` 或 `~/.config/dsh-push/credentials.json` |
| `pollIntervalMs` | `3000` | 队列轮询间隔（500–60000） |
| `pushQuestions` | `true` | 关掉就只提问不推送 |
| `notifyTurns` | `true` | 轮次结束（`agent/turn-stopping`）推 `DSH 任务结束`，即旧 `Stop` hook 的等价物 |
| `echoAnswers` | `true` | 作答后发 `#ans` 静默回声（撤手机通知；relay 自己的回声写死在 topic `dsh`，多租户下到不了你家 topic） |
| `claimForeground` | `false` | 打开则**抢前台**：把问题挂在 waterfall 上，手机答得更早；代价是与 Web UI 竞速，见下 |
| `webLog` | `~/.dsh/web.log` | 只用来取最后一个 `?token=` 拼 `#web` |
| `webBase` / `webName` | 空 | `#web` 直达链接基址 / `#name` 实例名。**`webBase` 留空不再等于没有网页入口**（v0.1.1）：插件直接改用 web.log 里 DSH 自己打印的那条 URL——能不能打开取决于 DSH 实际绑的地址（绑 `127.0.0.1` 就只对本机可达）。手机要从别的网络打开，就把手机可达的地址写进 `webBase` |
| `log` | `true` | `ctx.logger` + stdout 诊断 |

### `claimForeground` 为什么默认关

通知层骨架的取舍（research 作者建议、本插件采用）：**监听器 prepend + `return next()`**，
前台作答权留给 DSH Web UI —— 浏览器在线时体验与现在完全一致，插件只在旁边推通知。
代价是"窗口期内的手机作答"必须等前台等待结束（timed 模式的 timeout，或 UI 作答）。
实测（2026-10-13，台式机 c-full）：timed `timeout:180` 的提问，手机在 t+30s 经 relay 作答 →
插件日志 `state=open` 排队重试 → t+180s 工具返回 `pending` → 提问进投影（continued）→
下一轮 poll 立即 `answered (continued)` 折回会话。**手机优先的用户应打开 `claimForeground`**，
否则每次手机作答都要白等剩余超时时间。
打开 `claimForeground` 后插件会 hold 住 waterfall 并把手机答案与 UI 答案赛跑（谁先到谁生效），
`mode: legacy`（无 timeout、永久阻塞）的问题也能被手机答，但它与 UI 抢答权，属于实验开关。

## 三个触发点（旧 hook 的逐项等价物）

| 旧 hook / 外部桥 | 本插件 | 说明 |
|---|---|---|
| `PreToolUse`（提问推送）| `user-questions/request` waterfall（prepend） | 拿到的是服务词汇表的问题对象 + `wait.timed`，比读工具入参更准 |
| 同上（兜底） | `tools/pre-execute` | **竞位兜底**：waterfall 里"后 prepend 的作答器"会排到本插件前面，若它直接返回答案而不调 `next()`，waterfall 监听器就永不执行（实测：probe 插件 autoAnswer 就是这样）。两个触发点都按 `exec.callId` 去重，正常情况只推一次，且 waterfall 那次会把 `timed` 校正回来 |
| `PostToolUse`（作答回声 `#ans`）| `tools/post-execute` | 工具带着答案返回 → 推 `#ans`。**注意**：结果是 `{pending:true}`（timed 等超时未答）时**不推**——那问题还能从手机答，推了会把卡片错误地置为已答（旧 hook 在这里会误推，属已知缺陷） |
| `Stop`（任务结束推送）| `agent/turn-stopping` | 取 `agent.session.header.id` / `.cwd`，按 `session:turn` 去重，priority 3，正文 `目录: <cwd>` + `#web` + `#name`，与 hook 逐字一致；推送是 fire-and-forget，失败不影响轮次 |
| 外部 answer bridge | `ctx.interval` 轮询 relay 队列 | 见上文；不依赖 `/api/remote.mux` 与本机 cookie |

## 切到"正在用的" profile（生产部署，需用户确认）

**前提**：`tool-ask-user` 在 `mode: timed` 才会 fold 投影 —— 否则手机只能收通知、不能作答（见上文硬约束 1）。

```powershell
$dsh = '<DSH 安装目录>\resources\runtime\cli\bin\dsh.cmd'
$profile = 'web'                       # 生产 profile 名

# 1. 备份要改的两个文件（它们不在 git 里，没有回滚路径）
Copy-Item "<dshHome>\profiles\$profile\cordis.patch.yml" "<dshHome>\profiles\$profile\cordis.patch.yml.bak-plugin"
Copy-Item "<dshHome>\profiles\$profile\package.json"     "<dshHome>\profiles\$profile\package.json.bak-plugin"

# 2. tool-ask-user 切 timed：把这段追加到 profiles\$profile\cordis.patch.yml
#    （id 定向 patch 会整块替换该条目的 config，tool-ask-user 本来没有 config，所以只写这两个键）
#      - id: tool-ask-user
#        config:
#          mode: timed
#          timeout: 120
# 3. 插件 + 三个令牌（令牌走环境变量，不写 YAML）
& $dsh plugin --profile $profile add "link:F:/work/work_dsh/dsh-push/host-plugin"
& $dsh --profile $profile --dump-config | Select-Object -Last 3      # 期望看到 - id: push-host

# 4. 关掉 hook 的提问推送（避免双推）：deploy/windows/hooks.json 去掉 PreToolUse 里
#    ask_user_question / exit_plan_mode 的组，或整体停用该桥插件；Stop 推送可留可撤（插件已接管结束推送）

# 5. 重启宿主，判据是"端口持有者 PID 变了"+ dump-config 行内容，不看 status 探针
```

令牌（给宿主进程的环境，不是给 App 的）：`DSH_PUSH_HOST_TOKEN`（`hk_…`）、`DSH_PUSH_REG_TOKEN`（relay 注册令牌）、
`DSH_PUSH_NTFY_TOKEN`（该 host 的 ntfy 写令牌）。App 侧继续用生产读令牌 + topic `dsh`（App 的 topic 是硬编码的）。

**回滚**：`dsh plugin --profile web remove <包名>` + 把两个 `.bak-plugin` 覆盖回去 + 重启宿主；
hook 那边恢复 `hooks.json` 即可回到旧链路（两条链路互不破坏数据）。

## 验收

```powershell
# 1) 纯逻辑：假 ctx + 假 relay，48 项断言（含 open 期答案必须留在队列里的回归项）
& $dsh-node host-plugin\plugin-selftest.mjs
#   需要本地 node_modules/@deepseek-ai/schemastery（宿主本来自带，测试时用 junction 指过去）

# 1b) 开通层：凭据文件/优先级/缺文件 no-op/坏文件/配对载荷 + 坑 ①⑤ 的回归，54 项断言
& $dsh-node host-plugin\plugin-selftest-credentials.mjs

# 2) relay 客户端：真打公网 HTTPS（读/写/错误令牌/ack 空表）
node host-plugin\relay-selftest.mjs <hostToken>

# 2b) 配对自检：真打 relay/ntfy，逐项 PASS/FAIL（只读 + 一条测试通知）
node host-plugin\lib\pairing.mjs verify

# 3) 真机进程内冒烟：插 probe 插件造一个合成问题，看插件是否推送+注册
& $dsh --profile pushtest --patch <overlay 见下>
#   [dsh-push-host] relay ready host=test1 topic=dsh-test1 poll=3000ms
#   [dsh-push-host] question pq-… agent=(none) timed=false q=["probe-q1"]
#   ⚠ 这条路**证明不了"答案落回 agent"**：合成问题没有活 agent，deliver() 会停在
#     `no live root agent …`。要验最后一跳用 3b。

# 3b) 【推荐】"手机真的能答"的端到端验收 —— 全自动，不需要人碰手机：
powershell -NoProfile -ExecutionPolicy Bypass -File verify\host-plugin-phone-answer-e2e.ps1
#   真 agent 提 timed 问题 → 模拟器里的 App 自己作答 → 断言三处：
#     register … -> HTTP 200 / probe timed=true / answered (continued) + agent 收到答案
#   期望输出 `SUMMARY: 11/11 checks passed`（脚本全文见 verify\host-plugin-phone-answer-e2e.ps1）

# 4) 看手机侧真实收到的内容（用该 topic 的读令牌）
curl -H "Authorization: Bearer <readToken>" "https://ntfy.cpyh.xyz/<topic>/json?poll=1&since=10m"

# 5) 从手机侧作答，看队列闭合
curl -X POST -H "Content-Type: application/json" \
  -d '{"callId":"<callId>","answers":[{"id":"q1","selected":["second"]}]}' \
  https://ntfy.cpyh.xyz/answer/submit
#   → {"ok": true, "queued": true, "host": "test1"}   插件下一轮轮询取走并 ack
```

### 无人验收配方（2026-10-13 实弹，probe 只能证明"推送+注册"，证明不了"答案落回 agent"）

合成问题（probe 的 `selfTest`）**没有活 agent**，所以 `deliver()` 走到
`no live root agent …` 就停下了 —— 它永远证明不了"手机答案被 apply 进 agent"。
要验这一环必须有一个**真 agent 提一个 timed 问题**，再用模拟器里的 App 作答：

```powershell
# ① 测试 profile（pushtest = dsh-base + dsh-headless + 本插件 + probe）加一层 overlay：
#    - insert: tool-ask-user (mode: timed, timeout: 60)   ← headless bundle 里没有这个工具
#    - id: push-host  config: { webName: e2e-verify, notifyTurns: false }  ← 别往生产 topic 推结束通知
#    - id: agent-default-model + llm-pi-ai               ← 从 profiles/web/cordis.patch.yml 抄，指向同一个模型路由
& $dsh --profile pushtest --patch <overlay.yml> --dump-config   # 先验：exit 0 + 尾部 - id: tool-ask-user (mode: timed)

# ② 让真 agent 提一个问题（单行 prompt！多行 here-string 会被 dsh.cmd 吃掉，见坑）
& $dsh --profile pushtest --patch <overlay.yml> 'Call ask_user_question exactly once ... print RESULT_JSON: ...'

# ③ 同时让模拟器里的 App 作答（笔电 <win-host-a> 的 emulator-5554，ssh 过去跑）：
#    轮询 prefs 等带唯一标记的那条 push → 取 callId → 走 App 自己的作答路径
#      a) UI 路径：am start -n xyz.cpyh.dshpush/.QuickAnswerActivity --es callId <cid> + input tap 选项
#      b) 通知按钮路径（稳，uiautomator 常挂）：am broadcast -n xyz.cpyh.dshpush/.AnswerReceiver \
#           --es callId <cid> --es qid q1 --es label "<选项>" --ei nid <mid>
#    两条路都打 POST https://ntfy.cpyh.xyz/answer/submit（AnswerReceiver 与 QuickAnswerActivity 同协议）
```

看这三处断言（缺一不可）：

| 断言 | 日志/证据 |
|---|---|
| ① 注册通了 | `[dsh-push-host] register <callId> -> HTTP 200` |
| ② 等待是 timed | probe 的 `callId = … timed=true`（权威）／插件的 `timed corrected to true by the request waterfall` |
| ③ 答案落回 agent | `[dsh-push-host] answered (continued) <callId>`（= `ctx.userQuestions.answer()` 返回 true）→ 紧接着 agent 侧收到一条 `answer_to_pending_question` user 消息 |

坑：**模型显式传 `timeout: -1`**（"必须等到答案"）会走 legacy 路径，问题当场以
`{"error":"no user-questions answerer accepted the request"}` 返回 —— 这不是链路坏。
prompt 里要写明"不要传 timeout 字段"。

## 依赖的 relay 契约（`deploy/answer-relay.py`）

| 端点 | 用途 |
|---|---|
| `POST /answer/register` | `{callId, agentId, questions:[{id,question,options:[str]}], hostId, ttl}` + `X-Reg-Token`；带 `hostId` 即进入队列模式 |
| `GET /answer/pending?host=X` | `X-Host-Token` → `{items:[{callId, agentId, qids, answers, ts}]}` |
| `POST /answer/ack` | `{host, callIds}` + `X-Host-Token` |
| `POST /answer/submit` | 手机提交；该问题有 `hostId` → 入队并回 `{ok, queued:true}` |
| `GET /answer/<callId>` | 手机/浏览器作答页（插件推送正文里的链接就是这个） |

推送正文沿用 App 既有语法：`📱 作答: <answerBase>/answer/<callId>` + `#qid` / `#opts qid=a|b|c`
（仅单问题 2–3 选项且标签不含 `|=#`）/ `#web` / `#name`；作答回声 `#ans <callId> <摘要>`，
优先级 1（静默）。问题推送优先级 4（App 走紧急通道）。

## 范围与限制

- **三个触发点都在插件里**（提问推送 / 结束推送 / 作答回声）；`deploy/windows/hooks.json` 那条
  旧 hook **必须保持退役**（现在是 `{"hooks":{}}`），否则双推。
- **`mode: legacy` 下手机只能收通知、不能作答**（见上文硬约束 1）。
- **模型显式传 `timeout: -1` 时也是 legacy 路径**：那个"必须等到答案"的调用没有 timed wait，
  手机答不了（问题会当场以 `NO_PROVIDER` 结束）。这是调用方的选择，不是链路故障。
- 手机作答经过 relay 队列，**队列里的 callId 带 `|`**：任何把它交给 shell 的地方都必须引号包住
  （`--es callId 'call_00_x|uuid'`），否则被当管道符切断、静默失效（2026-10-13 实测踩到）。
- **不查历史**：插件只处理它自己经手（注册）的问题；别人用 hook 注册的问题没有 `hostId`，
  走 relay 的老 bridge 转发，不经过本插件（老 bridge 已于 2026-10-13 停用并禁用，
  回滚：`Enable-ScheduledTask -TaskName DshAnswerBridge` + `Start-ScheduledTask`）。
- **单实例单 host**：一个进程一个 `host`/`topic`；多台机器用 `deploy/relay-user-add.sh <user>` 各开一条。
- 令牌从**凭据文件或环境变量**读（都不写进 YAML）；插件与宿主同进程同权限，装之前按第三方插件审一遍代码。
- **配对只做到"产出载荷"**：载荷怎么进 App 由 App 决定；App 目前没有导入按钮（提案见
  `openspec/changes/dsh-push-distribution/specs/companion-app/spec.md`），所以手机上仍要手填三项。
- **本包不包含 relay 服务端**：`deploy/` 里的脚本与 `answer-relay.py` 是服务端侧，需要操作者自己在
  自己的主机上部署（见 `../deploy/README.md`）；默认 `relayBase` 指向本项目的实例，别家部署要改。

## 相关文档

- `../deploy/README.md`：relay/ntfy 服务端部署与每用户开号
- `../verify/README.md`：App 侧验收流水线与硬事实
- `F:\work\work_dsh\dsh-plugin-api-research.md`：`userQuestions` seam 的源码级契约（本项目外）
