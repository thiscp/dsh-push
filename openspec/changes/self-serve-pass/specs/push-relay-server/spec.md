## ADDED Requirements

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
