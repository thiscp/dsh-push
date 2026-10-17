# 自助通行证发号（多人自由使用插件）

## Why

用户 2026-10-17：「我希望能在插件里面有按钮什么的自动生成一个给手机用的通行证，这样的话才能让多人都能自由的使用我们的插件」。

现状（2026-10-17 实测，阿里云 ntfy 2.29.0，容器 `ntfy`，`server.yml`：`auth-file: /var/lib/ntfy/user.db` +
`auth-default-access: deny` + `global-topic-limit: 50`）：

- 通行证 = ntfy 的 access token；App 用 `Authorization: Bearer` 订阅 WebSocket，没填就是「等待通行证」。
- 服务端账号**已经是「一人一 topic 一对凭据」的形状**：`dsh-test1-phone`（只读 `dsh-test1`）/`dsh-test1-pub`（只写）、
  `dsh-vm1-phone`/`dsh-vm1-pub`（`dsh`）、`dshphone`/`dshpub`（`dsh`+`dsh-verify`）；匿名无任何权限。
- **卡点在 App**：`WS_URL = "wss://ntfy.cpyh.xyz/dsh/ws"` 写死，通行证只有一串 token、不带 topic ⇒ 多人必须先让 App 知道 topic。
- **发号不能纯 HTTP**（实测）：二进制里 `/v1/tokens` 出现 **0 次**，`GET/PUT/POST/DELETE /v1/tokens` 都被当作 topic 发布/订阅；
  `POST /v1/users`（admin bearer）能建用户但**静默忽略** `topics`+`permission` 与 `grants` 两种拼法；`DELETE /v1/users/<name>` 404。
  ⇒ 按 topic 授权与发 token **只能在服务器上跑 CLI**（`ntfy access` / `ntfy token add`）。
- 已做的可回滚改动：admin 账号 `dsh-provision` + 一只 token 存 `/root/provision-token.txt`（600）；回滚 `ntfy user del dsh-provision`。

用户已裁决的四个方向：**每人自己跑一台 DSH**、**通行证以文本复制 + 主页粘贴交付**（不做二维码）、**永久有效 + 网页可列可吊销**、
**入口在 DSH 网页里插件注入的面板**；发号通道选**中继上加一个极小的 provisioning 服务**。

## What Changes

- **中继新增 `dsh-provd`**：监听 `127.0.0.1:2587`，经 `edge` nginx 在 `https://ntfy.cpyh.xyz/provision/*` 暴露；
  用 `Authorization: Bearer <provision secret>` 鉴权；内部用 argv 调 `docker exec ntfy ntfy …`（**不做 shell 字符串拼接**）。
  - `POST /provision {name}` ⇒ 建 `<name>-phone`（只读 topic `<name>`）+ `<name>-pub`（只写）+ 各发一只 token，
    返回 `{topic, readToken, writeToken}`；名字已占用 ⇒ 409。
  - `GET /provision` ⇒ 列出已发的名字与授权（吊销面板的数据源）。
  - `POST /provision/revoke {name}` ⇒ `ntfy user del` 两个账号（实测：删用户即连带失效其 token）。
  - `GET /healthz` ⇒ 200。
- **插件 v0.3.0**：新增 `provisionBase`/`provisionToken` 配置与发号/列表/吊销三个服务端能力；网页面板上「发通行证」按钮
  出通行证文本 + 复制，列表带吊销；发号成功后把 `topic`+`writeToken` 写回自己的配置（`ctx.configEditor`），并提示需重启生效。
- **App v1.33.0 / versionCode 103**：通行证输入框接受 `dshpush://v1?base=…&topic=…&token=…`，存 `topic`（+ 可选 `base`），
  订阅地址改为按 topic 派生；**只粘一串 `tk_…` 的老通行证仍照旧可用**（topic 默认 `dsh`）；状态卡片显示当前 topic。

## Impact

- 能力：`push-relay-server` 新增「自助发号服务」；`dsh-host-plugin` 新增「通行证面板」；`companion-app` 修改「通行证」相关需求（携带 topic）。
- 运维：那台是**全 tailnet 的 DERP 中继**且只有 2 GiB ⇒ 只加容器 + `nginx -s reload`，**绝不重启机器**；服务加 `--memory=64m` 与 restart 策略。
- 安全：provision secret 能发 token（等于发通行证的能力），存 `/etc/dsh-provd/secret`（600）与插件 credentials（不进 git）；
  `global-topic-limit: 50` ⇒ 约 25 对人，需要时再抬。
- 已知边界：不做二维码、不做「老手机分享新通行证」、不做按人分流群发（每人一台 DSH）。
