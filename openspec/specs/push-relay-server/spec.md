# push-relay-server Specification

## Purpose
定义阿里云上自建 ntfy 推送服务（`https://ntfy.cpyh.xyz`）的外部可观察行为：HTTPS 与 WebSocket 可达性、写入鉴权、边缘 nginx SNI 分流、证书自动续期，以及重启后的自愈。

## Requirements

### Requirement: HTTPS 可达
ntfy 服务 SHALL 通过 `https://ntfy.cpyh.xyz` 提供 API 与 WebSocket，证书由 certbot 自动续期。

#### Scenario: 健康检查
- **WHEN** 执行 `curl https://ntfy.cpyh.xyz/healthserver`
- **THEN** 返回 200，且响应经边缘 nginx SNI 分流到达 ntfy

#### Scenario: 证书续期
- **WHEN** certbot 续期周期到达
- **THEN** `ntfy.cpyh.xyz` 证书被自动续期，无需人工干预

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

### Requirement: 重启自愈
aliyun-relay 重启后推送服务 SHALL 自动恢复。

#### Scenario: 机器重启
- **WHEN** aliyun-relay 重启完成
- **THEN** ntfy 容器自动运行（restart 策略），HTTPS 推送在无人工操作下恢复

#### Scenario: 内存受约束
- **WHEN** 容器内存使用达到 limit
- **THEN** 仅 ntfy 容器受限，不影响同机 DERP/nginx 等其他服务

### Requirement: 自助发号服务

中继 SHALL 提供 `https://ntfy.cpyh.xyz/provision/*` 自助发号服务：请求 MUST 携带 `Authorization: Bearer <provision
secret>`，未授权 SHALL 被拒且 MUST NOT 改变服务器状态。它 SHALL 以**参数数组**调用 `docker exec ntfy ntfy …`
（MUST NOT 拼接 shell 字符串）创建 `<name>-phone`（对 topic `<name>` 只读）与 `<name>-pub`（只写）并各发一只
token，返回 `{topic, readToken, writeToken}`；`GET` SHALL 列出已发名字与授权；`POST /provision/revoke` SHALL 删除
这两个账号（token 随用户失效）。名字 SHALL 限定 `^[a-z0-9][a-z0-9-]{1,30}$`，已占用 SHALL 返回 409。该服务
MUST NOT 要求重启中继机器（那台是全 tailnet 的 DERP 中继）。

#### Scenario: 发一对凭据

- **WHEN** 带合法 secret `POST /provision {"name":"dsh-alice"}`
- **THEN** 返回 `topic=dsh-alice` 与只读/只写两只 token，且 `ntfy access` 显示两个账号各自仅限该 topic

#### Scenario: 只读 token 读不到别人的 topic

- **WHEN** 用返回的只读 token 订阅 `dsh-alice`，再订阅别人的 topic
- **THEN** 前者用 `/json` 端点轮询拿到消息，后者返回 403（`GET /<topic>` 会先命中 web 应用分支、不做授权判定，不能用来测权限）

#### Scenario: 未授权被拒

- **WHEN** 不带 secret 或 secret 错时发号
- **THEN** 返回 401/403，服务器账号列表不变

#### Scenario: 吊销后旧通行证立刻失效

- **WHEN** `POST /provision/revoke {"name":"dsh-alice"}` 后用旧只读 token 再订阅（订阅判定用 `/json` 端点）
- **THEN** 返回 401（token 随用户一起失效），列表里该项消失

#### Scenario: 名字冲突不覆盖

- **WHEN** 用一个已存在的名字再次发号
- **THEN** 返回 409，已有 token 不被覆盖
