# dsh-turn-notify delta

## ADDED Requirements

### Requirement: 轮次推送携带网页直达链接
Stop 推送 SHALL 同样携带 `\n#web <url>` 机器行（现取 token + 配置基址），使任务结束通知也能直达 DSH Web；取不到时省略该行不影响推送。

#### Scenario: 任务结束直达
- **WHEN** 一轮任务结束发出 Stop 推送
- **THEN** 正文含 `#web` 行，手机通知上的网页按钮可打开本轮所在 DSH Web 会话页面
