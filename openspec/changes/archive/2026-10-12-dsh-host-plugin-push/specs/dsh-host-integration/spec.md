# dsh-host-integration 变更

## ADDED Requirements

### Requirement: 宿主插件链路生效条件

一台 DSH 主机接入推送时，宿主插件链路 SHALL 可独立成立（不依赖 `hooks.json`、外部推送脚本或常驻
answer bridge），且生效条件 SHALL 全部可验证：插件经 `dsh plugin --profile <profile> add <本地包路径>`
安装并以 bundle patch 的 insert 语义挂载为 `push-host`；token 经环境变量提供；提问推送与作答回灌 SHALL
不依赖 DSH Web 的 `/api/remote.mux` 与本机 cookie。

#### Scenario: 只装插件即可推送

- **WHEN** profile 仅安装本插件并配置 host/token，未挂载任何 hook 桥插件
- **THEN** 提问与轮次结束均产生 ntfy 推送

#### Scenario: dump-config 行内容核对

- **WHEN** 验证宿主插件是否进入运行配置
- **THEN** `--dump-config` 输出含 `- id: push-host` 且 `name` 为本插件包名

#### Scenario: 缺少令牌时宿主不受影响

- **WHEN** 插件已挂载但未提供任何令牌
- **THEN** 宿主正常启动，插件不发起网络请求，会话与工具行为不变

#### Scenario: 作答不依赖 Web 会话凭据

- **WHEN** 手机提交答案且 DSH Web 未运行（或 token 已轮换）
- **THEN** 主机经 relay 队列取到答案并灌回 agent，无需读取 Web 日志或建立 WebSocket
