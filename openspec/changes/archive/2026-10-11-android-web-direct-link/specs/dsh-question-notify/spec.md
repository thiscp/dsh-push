# dsh-question-notify delta

## ADDED Requirements

### Requirement: 提问推送携带网页直达链接
提问推送发布时，钩子 SHALL 从本机 DSH Web 日志现取最新 token、以配置的 tailnet 基址拼出 DSH Web 链接，并在正文追加 `\n#web <url>` 机器行；取不到 token 或未配置基址时 SHALL 省略该行且不影响推送。

#### Scenario: 链接新鲜
- **WHEN** DSH Web 刚重启（token 已变）后发出提问推送
- **THEN** `#web` 行携带重启后的新 token，手机点开即达

#### Scenario: 取不到 token
- **WHEN** DSH Web 日志缺失或无 token 行
- **THEN** 推送正常发布且不含 `#web` 行，脚本 exit 0
