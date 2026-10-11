# dsh-turn-notify Specification

## Purpose
定义 DSH Web 侧"轮次结束触发推送"的行为契约：触发时机、载荷、失败隔离、去重。

## Requirements

### Requirement: 轮次结束触发推送
DSH Web 会话的一轮 agent 停止时，Stop 钩子 SHALL 向 ntfy topic `dsh` 发布一条通知。

#### Scenario: 正常完成
- **WHEN** 一个 DSH Web 任务的轮次正常结束（Stop 事件）
- **THEN** 推送到达，标题含会话标识，正文含工作目录与结束状态

### Requirement: 推送失败不阻塞任务
推送链路的任何失败 SHALL NOT 影响 DSH 轮次的正常结束。

#### Scenario: ntfy 不可达
- **WHEN** Stop 钩子执行时 ntfy 服务不可达或超时
- **THEN** 推送脚本以 exit 0 结束，DSH 轮次正常停止，无 "blocked by Stop hook" 注入

### Requirement: 同轮去重
同一轮次 SHALL 至多产生一条推送。

#### Scenario: 钩子重复触发
- **WHEN** 同一 turn id 的 Stop 钩子被执行多次
- **THEN** 仅第一次发布消息，后续静默跳过

### Requirement: 轮次推送携带网页直达链接
Stop 推送 SHALL 同样携带 `\n#web <url>` 机器行（现取 token + 配置基址），使任务结束通知也能直达 DSH Web；取不到时省略该行不影响推送。

#### Scenario: 任务结束直达
- **WHEN** 一轮任务结束发出 Stop 推送
- **THEN** 正文含 `#web` 行，手机通知上的网页按钮可打开本轮所在 DSH Web 会话页面
