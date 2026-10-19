# Spec Delta

## MODIFIED Requirements

### Requirement: 写入需鉴权
未携带有效凭据的发布请求 SHALL 被拒绝；凭据 SHALL 按最小权限签发——服务器发布方仅持有 topic `dsh` 的只写凭据，手机订阅方仅持有只读凭据，任一凭据泄露都不足以同时读和写该 topic。

#### Scenario: 匿名写入被拒
- **WHEN** 不带 token 向 topic `dsh` POST
- **THEN** 返回 401/403，消息不入库

#### Scenario: token 写入成功
- **WHEN** 携带有效 write-only access token 向 topic `dsh` POST
- **THEN** 返回 200，订阅者收到消息

#### Scenario: 只写凭据读不了
- **WHEN** 用 write-only token 订阅或轮询 topic `dsh`
- **THEN** 返回 403/404，读不到任何消息内容

#### Scenario: 只读凭据写不进
- **WHEN** 用 read-only token 向 topic `dsh` POST
- **THEN** 返回 403，消息不入库
