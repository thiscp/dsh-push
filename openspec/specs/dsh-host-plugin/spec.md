# dsh-host-plugin Specification

## Purpose
定义 `dsh-push-host` 宿主插件的行为契约：挂载与生效条件、提问与轮次两类推送、前台作答权归属、手机作答回灌与作答回声、轮询可靠性，以及配置、凭据文件与包分发。

## Requirements

### Requirement: 插件挂载与生效条件

宿主插件 SHALL 以 bundle patch 的 `insert` 语义挂载为稳定插件 id `push-host`，且 SHALL 满足：经
`dsh plugin --profile <profile> add <本地包路径>` 安装后，`--dump-config` 输出含该条目；缺少
`host` 或 `hostToken` 时插件 SHALL 只做透明监听（不推送、不轮询、不抛错），宿主启动 SHALL NOT 因插件失败。

#### Scenario: dump-config 可见挂载

- **WHEN** 插件装入 profile 后执行 `dsh --profile <profile> --dump-config`
- **THEN** 输出尾部含 `# == dsh-push-host`、`- id: push-host`、`name: dsh-push-host`

#### Scenario: 未配置令牌即静默

- **WHEN** profile 未配置 `host`/`hostToken`（也未提供对应环境变量）且宿主启动
- **THEN** 插件仅打印一行"relay disabled"日志，不发起任何 relay 请求，提问请求原样交给下游作答器

### Requirement: 提问推送（宿主插件路径）

插件 SHALL 在 `user-questions/request` waterfall 上以 prepend 认领每个待答问题，向该主机配置的 ntfy
topic 发布 priority 4 的通知，并 SHALL 向 answer-relay 以 `callId` + `hostId` 注册该问题；随后 SHALL
调用 `next()` 把前台作答权交还下游（DSH Web UI）。推送正文 SHALL 沿用 App 既有语法：
`📱 作答: <answerBase>/answer/<callId>`、`\n#qid <首问id>`、单问题 2–3 选项时追加
`\n#opts <qid>=<a|b|c>`、配置了基址时追加 `\n#web <url>`、配置了实例名时追加 `\n#name <名>`。
同一 `callId` SHALL 至多推送并注册一次。

#### Scenario: 选择题提问

- **WHEN** agent 通过 `ask_user_question`（timed 模式）提出单选问题并等待
- **THEN** ntfy 收到 priority 4 通知，正文含问题文本、`→ 选项` 行、作答链接、`#qid`、`#opts`、`#name`，且 relay 中该 `callId` 归属本 host

#### Scenario: 计划审批类提问

- **WHEN** 计划审批走同一问题 seam（`intent.kind = plan-review`）
- **THEN** 插件按同一语法推送该问题与其选项，无需按工具名白名单

#### Scenario: 触发点兜底

- **WHEN** 另一个也以 prepend 注册的作答器排到插件之前并直接返回答案（未调用 `next()`），waterfall 监听器不执行
- **THEN** `tools/pre-execute` 兜底触发同一 `callId` 的推送与注册，用户仍收到通知

#### Scenario: 载荷缺字段

- **WHEN** 问题缺少文本或选项
- **THEN** 正文回落 `DSH 正在等你选择` 且仍带作答链接与 `#qid`，推送照常发出

### Requirement: 前台作答权归属

插件 SHALL NOT 抢前台作答权：默认配置下监听器 SHALL 在推送与注册后立即 `return next()`，使浏览器在线时
仍由 DSH Web UI 作答。`claimForeground` 为实验开关，默认关闭；打开后插件 SHALL 把手机答案与下游答案赛跑，
先到者生效。

#### Scenario: 浏览器在线

- **WHEN** 浏览器连着且用户在 DSH Web 聊天界面作答
- **THEN** 前台工具调用由 UI 的答案结束，插件不干预；插件随后按回声要求补发 `#ans`

#### Scenario: 默认不抢

- **WHEN** 插件以默认配置挂载并收到提问请求
- **THEN** 监听器返回下游的返回值（`next()` 的语义），未认领前台等待

### Requirement: 手机作答回灌

插件 SHALL 以固定间隔轮询 relay 的按主机队列，并对每个答案按问题状态处置：`continued` 时 SHALL 调用
`ctx.userQuestions.answer(活根 agent, callId, {answers})`（答案项 SHALL 补齐为该问题集的一一对应，缺失项按
"跳过"语义补 `{id, selected: []}`）；`open`（前台等待未结束）时 SHALL NOT 丢弃答案，SHALL 保留在 relay
队列中重试；仅当会话投影的 `settled` 中明确出现该 `callId` 时 SHALL 丢弃；无活根 agent 时 SHALL 保留重试；
`timed === false`（legacy 模式，投影永不 fold）时 SHALL 明确记录并丢弃。插件 SHALL 只在答案成功落地后才 ack。

#### Scenario: 窗口期内到达的答案不丢

- **WHEN** 手机在提问的前台等待尚未结束时提交答案
- **THEN** 插件调用 `answer()` 得到 `false`，不 ack，并在前台等待结束后（问题转为 `continued`）下一轮把同一答案投递成功

#### Scenario: 迟到答案灌回 agent

- **WHEN** 问题已 `continued` 且对应 agent 仍活着
- **THEN** `answer()` 返回 `true`，agent 收到一条 `user-question-reply` 用户消息，插件随后 ack 并推 `#ans`

#### Scenario: 答案不完整

- **WHEN** 手机只答了多问题中的第一问（通知栏直答）
- **THEN** 插件补齐其余问题为"跳过"后投递，不因答案集不匹配而被拒

#### Scenario: legacy 模式明确拒绝

- **WHEN** 问题来自 `mode: legacy` 的提问（无 `timed` 等待）
- **THEN** 插件记录"手机答案无法落地，只能由 Web UI 作答"并 ack 丢弃，不无限重试、不静默消失

#### Scenario: 已结束的问题

- **WHEN** 投影的 `settled` 已含该 `callId`，或 agent 已不存在且问题不再可答
- **THEN** 插件 ack 丢弃该答案并记录原因

### Requirement: 轮询可靠性

轮询请求 SHALL 每次携带唯一查询串，使宿主 fetch 链路不得复用同一 URL 的旧响应；任何网络失败 SHALL 只记日志，
SHALL NOT 影响宿主或插件其余功能。

#### Scenario: 队列增长可见

- **WHEN** relay 队列新增答案条目
- **THEN** 主机下一轮轮询即取到该条目（实测：固定 URL 会一直返回首次响应，唯一化后恢复正常）

#### Scenario: relay 不可达

- **WHEN** 轮询请求失败或超时
- **THEN** 插件记录一行失败日志，下一轮继续，不抛错

### Requirement: 轮次结束推送（宿主插件路径）

插件 SHALL 在 `agent/turn-stopping` 时向该主机 topic 发布 priority 3 的通知，标题 SHALL 含会话标识尾部，
正文 SHALL 含 `目录: <cwd>`，配置了基址/实例名时 SHALL 追加 `#web` 与 `#name`；同一 `session:turn`
SHALL 至多推送一次；推送 SHALL 以 fire-and-forget 方式发出，失败 SHALL NOT 阻塞轮次结束。

#### Scenario: 一轮结束

- **WHEN** 一个 agent 轮次停止
- **THEN** 推送到达，标题为 `DSH 任务结束 [<sess8>]`，正文首行 `目录: <cwd>`

#### Scenario: 同轮重复事件

- **WHEN** 同一轮次的停止事件再次触发
- **THEN** 不再推送第二条

#### Scenario: 推送不可达

- **WHEN** ntfy 不可达或超时
- **THEN** 仅记录日志，轮次正常结束

### Requirement: 作答回声（宿主插件路径）

插件 SHALL 在提问工具结束（`tools/post-execute`）且结果为"已作答"时发布 priority 1 的
`#ans <callId> <摘要>`（摘要取各题 `selected[0]` 或 `custom`，`" / "` 连接，空摘要回落 `已作答`），
使任意端（含 DSH Web 聊天界面）作答后订阅端都能撤通知入已答态；结果含 `pending: true`（timed 等待超时未答）
时 SHALL NOT 回声；与插件自身在答案落地后发出的回声 SHALL 按 `callId` 幂等；回声失败 SHALL 静默。

#### Scenario: 聊天界面作答

- **WHEN** 用户在 DSH Web 聊天界面作答，工具带着答案返回
- **THEN** 手机收到 `#ans`，撤通知并置为已答

#### Scenario: 超时未答不得回声

- **WHEN** timed 等待超时、工具返回 `{pending: true}`（问题仍可从手机作答）
- **THEN** 插件不发 `#ans`，手机卡片保持可作答状态

#### Scenario: 与 relay 投递回声幂等

- **WHEN** 答案经 relay 队列落地（插件已发一条 `#ans`）后工具结束
- **THEN** 不再重复发第二条回声

### Requirement: 配置与凭据

插件 SHALL 支持以 profile patch 配置 relay 基址、host、topic、web 基址/实例名、轮询间隔、三类推送开关与
`claimForeground`；三个令牌 SHALL 支持环境变量提供（`DSH_PUSH_HOST_TOKEN`、`DSH_PUSH_REG_TOKEN`、
`DSH_PUSH_NTFY_TOKEN`），SHALL NOT 要求把令牌写入 YAML。三个令牌 SHALL 也可由凭据文件提供
（见"凭据文件"要求），且环境变量 SHALL 优先于凭据文件与 profile 配置。

#### Scenario: 令牌走环境变量

- **WHEN** 配置里不含字面令牌但对应环境变量存在
- **THEN** relay 侧（推送/注册/轮询/ack）正常工作

#### Scenario: 关闭某类推送

- **WHEN** `pushQuestions` 或 `notifyTurns` 置为 false
- **THEN** 该类推送不再发出，其余功能不受影响

#### Scenario: 令牌走凭据文件

- **WHEN** 环境变量不存在但凭据文件提供了该 host 的写令牌与队列令牌
- **THEN** relay 侧（推送/注册/轮询/ack）正常工作，无需设置任何环境变量

#### Scenario: 环境变量压过凭据文件

- **WHEN** 同一槽位既有环境变量又有凭据文件取值
- **THEN** 插件使用环境变量的值

#### Scenario: profile 配置压过凭据文件

- **WHEN** profile patch 显式写了 `topic`/`host`，凭据文件也提供同名值
- **THEN** 插件使用 profile patch 的值，凭据文件仅补足未显式配置的槽位

### Requirement: 包分发
`dsh-push-host` SHALL 是一个可直接发布的 npm 包：元数据齐全、随包带 MIT `LICENSE`、打包清单只含运行所需文件，`main` 与 `dsh.bundle.patch` SHALL 分别指向 `lib/index.js` 与随包的 `cordis.patch.yml`。安装 SHALL 支持三种等价方式（npm 名、tarball、本地目录），三者 SHALL 都把包写入 profile 的 `dependencies` 并在 `dsh.profile.bundles` 登记同名 bundle 层。

#### Scenario: 包元数据与运行入口

- **WHEN** 检查随包发布的 `package.json`
- **THEN** 含 `repository`、`homepage`、`bugs`、`author`、`engines`、`publishConfig.access = public` 与 `files` 白名单（`lib`、`cordis.patch.yml`、`README.md`、`LICENSE`）；包内带 MIT `LICENSE`；`main` 指向 `lib/index.js`，`dsh.bundle.patch` 指向随包的 `cordis.patch.yml`

#### Scenario: 三种安装方式等价

- **WHEN** 分别从 npm 名（`dsh plugin --profile <profile> add dsh-push-host`）、tarball（`… add ./dsh-push-host-<version>.tgz`）与本地目录（`… add link:<dir>`）安装
- **THEN** 三者都把包写入 profile 的 `dependencies`，并在 `dsh.profile.bundles` 登记同名 bundle 层

#### Scenario: 从 tarball 安装即挂载

- **WHEN** 在新建 profile 上执行 `dsh plugin --profile <profile> add ./dsh-push-host-<version>.tgz`
- **THEN** 命令成功，profile 的 `dependencies` 出现该包，`dsh.profile.bundles` 出现该包名，
  且 `dsh --profile <profile> --dump-config` 尾部含 `# == dsh-push-host`、`- id: push-host`、`name: dsh-push-host`

#### Scenario: 打包清单只含运行所需文件

- **WHEN** 对本包执行打包（`npm pack --dry-run`，或仓库内等价的 `tools/pack-npm-tarball.mjs`）
- **THEN** 清单恰好是本包 `files` 白名单加 npm 必带文件（`package.json`、`README.md`、`LICENSE`），
  自测脚本（`plugin-selftest*.mjs`、`relay-selftest.mjs`）不出现在清单里

#### Scenario: 安装后不依赖仓库

- **WHEN** 宿主从 tarball 安装的包里加载插件
- **THEN** 插件的运行期依赖只有 `@deepseek-ai/schemastery`（由宿主 closure 提供的 peer）与包内相对模块，
  不读取仓库里的任何路径

### Requirement: 凭据文件
插件 SHALL 支持从凭据文件读取通道凭据，默认位置 SHALL 为 `~/.config/dsh-push/credentials.json`，并 SHALL 可被配置项 `credentialsFile` 或环境变量 `DSH_PUSH_CREDENTIALS` 覆盖。凭据文件 SHALL 直接接受 `deploy/relay-user-add.sh` 输出的配对载荷字段名与常见别名，并 SHALL 支持多 host 形式（根字段为默认值，`hosts[host]` 覆盖）。取值优先级 SHALL 为**内置默认 < 凭据文件 < profile/overlay 配置 < 环境变量**。凭据文件不存在 SHALL 为干净 no-op（不报错、不打印抱怨、不发起网络请求，插件退化为透明监听器）；文件存在但不可读或 JSON 非法时 SHALL 记录一行含路径的日志并继续挂载。

#### Scenario: 字段名与别名映射

- **WHEN** 凭据文件按 `relay-user-add.sh` 的字段名或常见别名写出
- **THEN** 映射为 `relay`→relay 基址、`host`→hostId、`topic`→ntfy topic、`writeToken`→本机 ntfy 写令牌、`readToken`→手机 ntfy 读令牌、`hostToken`→relay 队列令牌；键名大小写/连字符差异与别名（`ntfyToken`/`pushToken`/`tkPub`、`phoneToken`/`tkRead`、`relayBase`/`base`、`hostId`）SHALL 同样被接受

#### Scenario: 载荷存成凭据文件即生效

- **WHEN** 把 `relay-user-add.sh` 打印的载荷原样保存为凭据文件并启动宿主
- **THEN** 插件以该 `host`/`topic` 推送与注册，ntfy 写请求带 `Bearer <writeToken>`，
  轮询带 `X-Host-Token: <hostToken>`

#### Scenario: 凭据文件不参与注册令牌

- **WHEN** 凭据文件里没有任何注册令牌字段
- **THEN** 注册令牌仍只来自环境变量（或 profile 配置），文件缺失它不影响其余字段生效

#### Scenario: 缺文件不报错

- **WHEN** 凭据文件不存在（且无对应环境变量/配置）
- **THEN** 宿主正常启动，插件只打印一行 relay 停用日志，零网络请求，提问请求原样交给下游作答器

#### Scenario: 坏文件只告警不致命

- **WHEN** 凭据文件存在但不是合法 JSON（或不是 JSON 对象）
- **THEN** 插件打印一行 `credentials ignored: …`（含路径）后继续挂载，其余功能不受影响

### Requirement: 配对载荷
插件 SHALL 提供一条命令产出单个用户的配对载荷，字段与 `deploy/relay-user-add.sh` **逐字同构**：`{v, relay, host, topic, writeToken, readToken, hostToken}`（`v` SHALL 为 1，字段顺序 SHALL 一致）。载荷字段 SHALL 全部来自凭据文件（`relay` 可取插件实际使用的 relay 基址），命令 SHALL NOT 凭空生成任何令牌；当任一字段缺失时命令 SHALL 以非零退出并列出缺失字段，MUST NOT 输出半份载荷。命令 SHALL 同时提供只读自检 `verify`：逐项打印 PASS/FAIL，任一失败即非零退出，且 SHALL NOT 读取其他 host 的队列、SHALL NOT 修改 relay 状态。

#### Scenario: 自检的五项检查

- **WHEN** 用真令牌执行 `verify`
- **THEN** 逐项检查凭据文件可读、载荷字段齐全、`GET /answer/pending?host=<host>` 带 `X-Host-Token` 返回 200、`GET /<topic>/json?poll=1` 带读令牌返回 200、`POST /` 带写令牌返回 200

#### Scenario: 生成载荷给手机

- **WHEN** 凭据文件完整（relay/host/topic/两个令牌/hostToken 俱全）并执行载荷命令
- **THEN** 输出与 `relay-user-add.sh` 同一 schema 的 JSON，可直接交给手机粘贴/扫描

#### Scenario: 字段不全时拒绝输出

- **WHEN** 凭据文件缺少 `topic` 或任一令牌
- **THEN** 命令以非零退出、在 stderr 列出缺失字段并给出"先在 relay 上开号"的下一步提示，stdout 无载荷

#### Scenario: 自检逐项判定

- **WHEN** 用真令牌执行 `verify`
- **THEN** 五项检查全 PASS 且退出码为 0；任一令牌不对时该项 FAIL（如 host 令牌不匹配为 HTTP 401），
  其余项照常报告，退出码非零

#### Scenario: 自检不越权

- **WHEN** 自检的凭据属于 host A
- **THEN** 自检只访问 A 的队列与 A 的 topic，不读取其他 host 的队列、不写 relay 的注册表
