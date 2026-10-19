# dsh-host-plugin 变更（dsh-push-distribution）

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: 包分发

`dsh-push-host` SHALL 是一个可直接发布的 npm 包：`package.json` SHALL 含 `repository`、`homepage`、
`bugs`、`author`、`engines`、`publishConfig.access = public` 与 `files` 白名单（`lib`、
`cordis.patch.yml`、`README.md`、`LICENSE`），包内 SHALL 带 MIT `LICENSE`；`main` SHALL 指向
`lib/index.js`，`dsh.bundle.patch` SHALL 指向随包的 `cordis.patch.yml`。安装 SHALL 支持三种等价方式：
从 npm 名（`dsh plugin --profile <profile> add dsh-push-host`）、从 tarball
（`… add ./dsh-push-host-<version>.tgz`）、从本地目录（`… add link:<dir>`），三者 SHALL 都把包写入
profile 的 `dependencies` 并在 `dsh.profile.bundles` 登记同名 bundle 层。

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

插件 SHALL 支持从凭据文件读取通道凭据，默认位置 SHALL 为 `~/.config/dsh-push/credentials.json`，
并 SHALL 可被配置项 `credentialsFile` 或环境变量 `DSH_PUSH_CREDENTIALS` 覆盖。凭据文件 SHALL 直接接受
`deploy/relay-user-add.sh` 输出的配对载荷字段名：`relay`→relay 基址、`host`→hostId、
`topic`→ntfy topic、`writeToken`→本机 ntfy 写令牌、`readToken`→手机 ntfy 读令牌、
`hostToken`→relay 队列令牌；SHALL 接受键名大小写/连字符差异与常见别名
（`ntfyToken`/`pushToken`/`tkPub`、`phoneToken`/`tkRead`、`relayBase`/`base`、`hostId`），
并 SHALL 支持多 host 形式（根字段为默认值，`hosts[host]` 覆盖）。取值优先级 SHALL 为
**内置默认 < 凭据文件 < profile/overlay 配置 < 环境变量**。凭据文件不存在 SHALL 为干净 no-op
（不报错、不打印抱怨、不发起网络请求，插件退化为透明监听器）；文件存在但不可读或 JSON 非法时
SHALL 记录一行含路径的日志并继续挂载。

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

插件 SHALL 提供一条命令产出单个用户的配对载荷，字段与 `deploy/relay-user-add.sh` **逐字同构**：
`{v, relay, host, topic, writeToken, readToken, hostToken}`（`v` SHALL 为 1，字段顺序 SHALL 一致）。
载荷字段 SHALL 全部来自凭据文件（`relay` 可取插件实际使用的 relay 基址），命令 SHALL NOT 凭空生成
任何令牌；当任一字段缺失时命令 SHALL 以非零退出并列出缺失字段，MUST NOT 输出半份载荷。
命令 SHALL 同时提供只读自检能力：`verify` SHALL 逐项检查凭据文件可读、载荷字段齐全、
`GET /answer/pending?host=<host>` + `X-Host-Token` 返回 200、`GET /<topic>/json?poll=1` + 读令牌
返回 200、`POST /` + 写令牌返回 200，并 SHALL 逐项打印 PASS/FAIL 与非零退出（任一失败）；
自检 SHALL NOT 读取其他 host 的队列、SHALL NOT 修改 relay 状态。

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

