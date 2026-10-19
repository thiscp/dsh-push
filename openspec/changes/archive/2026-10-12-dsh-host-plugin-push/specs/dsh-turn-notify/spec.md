# dsh-turn-notify 变更

## MODIFIED Requirements

### Requirement: 轮次结束触发推送

DSH Web 会话的一轮 agent 停止时，主机侧实现（`Stop` 钩子或宿主插件的 `agent/turn-stopping` 监听）
SHALL 向该主机配置的 ntfy topic 发布一条通知。

#### Scenario: 正常完成

- **WHEN** 一个 DSH Web 任务的轮次正常结束（Stop 事件）
- **THEN** 推送到达，标题含会话标识，正文含工作目录与结束状态

#### Scenario: 宿主插件路径

- **WHEN** 轮次停止由宿主插件的 `agent/turn-stopping` 监听器接管
- **THEN** 推送标题为 `DSH 任务结束 [<会话标识尾部>]`、正文首行 `目录: <cwd>`、priority 为 3，且同一 `session:turn` 至多一条

### Requirement: 轮次推送携带网页直达链接

轮次结束推送 SHALL 同样携带 `\n#web <url>` 机器行（现取 token + 配置基址），使任务结束通知也能直达
DSH Web；取不到时省略该行不影响推送。

#### Scenario: 任务结束直达

- **WHEN** 一轮任务结束发出 Stop 推送
- **THEN** 正文含 `#web` 行，手机通知上的网页按钮可打开本轮所在 DSH Web 会话页面

#### Scenario: 宿主插件路径

- **WHEN** 轮次结束推送由宿主插件发出且配置了 `webBase`
- **THEN** 插件从本机 DSH Web 日志现取最新 token 拼出 `#web` 行；未配置基址或取不到 token 时省略该行，推送照常发出
