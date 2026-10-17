# 中继侧：自助发号服务 `dsh-provd`

在阿里云 `aliyun-relay`（全 tailnet 的 DERP 中继，只有 2 GiB）上，把「只有跑 ntfy CLI 才能做的事」包成一层极小的
HTTP 服务，让任何一台装了插件的 DSH 都能自助签发自己的通行证，不需要在中继上登记 ssh 钥匙。

## 为什么必须有它（2026-10-17 实测，ntfy 2.29.0）

- 二进制里 `/v1/tokens` 字符串出现 **0 次** ⇒ access-token 的 HTTP API 在这个 build 里**根本没编译进去**；
  `GET/PUT/POST/DELETE /v1/tokens` 全落到「往 topic 发布/订阅」的兜底路由（`POST` 报 `topic name is not allowed`）。
- `POST /v1/users`（admin bearer）能建用户（回 `{success: true}`），但**静默忽略** topic 授权：`topics`+`permission`
  与 `grants` 两种拼法都不生效（`ntfy access <user>` 显示 `no topic-specific permissions`）。
- `DELETE /v1/users/<name>` ⇒ 404（无此路由）。
⇒ 按 topic 授权与发 token **只能在服务器上用 CLI**：`ntfy user add` / `ntfy access` / `ntfy token add` / `ntfy user del`。

## 部署形态（已上线）

| 项 | 值 |
|---|---|
| 程序 | `/usr/local/bin/dsh-provd.py`（= 本目录 `dsh-provd.py`，Python 3.6 stdlib，无第三方依赖） |
| 监听 | `127.0.0.1:2588`（**2587 已被我们自己的 `answer-relay.py` 占了 4 天**，别撞） |
| systemd | `/etc/systemd/system/dsh-provd.service`：`Restart=always`、`RestartSec=3`、`MemoryMax=64M`、`NoNewPrivileges`、`PrivateTmp`，已 `enabled` |
| 对外 | `https://ntfy.cpyh.xyz/provision/*`：`edge` nginx（host 网络）在 ntfy 的 server 块里加 `location /provision/ { proxy_pass http://127.0.0.1:2588/; }`，**尾斜杠剥前缀** ⇒ 服务内部路径是 `/issue` `/list` `/revoke` `/healthz` |
| 配置 | `/etc/dsh-provd/secret`（600，插件侧持同一把）；`/etc/dsh-provd/admin-token`（600，来自 `ntfy token add dsh-provision`；文件内容是 `token tk_… created for user …` 一整句，**取第 2 字段**） |
| 接口 | `POST /provision/issue {name=dsh-alice}` → `{topic, phoneUser, pubUser, readToken, writeToken}`；`GET /provision/list`；`POST /provision/revoke {name=…}`；`GET /provision/healthz` |
| 鉴权 | `Authorization: Bearer <secret>`，用 `secrets.compare_digest`；未授权 **401** 且不改变服务器状态 |
| 名字规则 | `^[a-z0-9][a-z0-9-]{1,30}$`；已占用 **409**（不覆盖已有 token）；坏名 **400** |

## 改 nginx 的正确姿势（本目录 `provision-nginx.py`）

- 配置文件 `/root/edge/conf.d/edge-http.conf`：`/root/edge/conf.d → /etc/nginx/conf.d` 是**目录挂载** ⇒ 改文件 + reload 即生效，不必重建容器
- 锚点（`location / {` + `proxy_pass http://127.0.0.1:2586;` 两行）**必须唯一**，脚本数过 =1 才动；动手前先写 `.bak-provision-<ts>`
- `docker exec edge nginx -t` **通过才** `nginx -s reload`（零停机、不碰 DERP）；失败自动回滚备份
- ⚠️ 别在 `edge` 容器里 `tail /var/log/nginx/access.log`（软链到 /dev/stdout，永不 EOF，会挂死）

## 验收（2026-10-17 全绿）

```
healthz(https) => ok:true              未授权 issue => 401
issue qa-provN => topic + 两只 32 字符 token
ntfy access qa-provN-phone => read-only access to topic qa-provN   （pub 同理 write-only）
publish with write token => 200
只读 token 读自己 topic（/json + Poll: 1）=> 拿到消息 JSON
只读 token 读别人 topic（dsh/json）        => 403
匿名 /json => 403 ；只读 token 去发布 => 403
revoke => 两账号删除；旧只读 token 再读 => 401
```

**测授权必须用 `/json` 端点**：`GET /<topic>`（哪怕带 `?poll=true` 或 `Poll: 1`）会先命中 ntfy 的 web 应用分支、
返回 HTML 且**不做 topic 授权判定** ⇒ 拿它判权限会得到假的 200（我前面两轮就被这骗了）。

## 回滚

```bash
systemctl disable --now dsh-provd && rm -f /etc/systemd/system/dsh-provd.service && systemctl daemon-reload
rm -f /usr/local/bin/dsh-provd.py /etc/dsh-provd/secret /etc/dsh-provd/admin-token
cp -a /root/edge/conf.d/edge-http.conf.bak-provision-<ts> /root/edge/conf.d/edge-http.conf
docker exec edge nginx -t && docker exec edge nginx -s reload
docker exec ntfy ntfy user del dsh-provision   # 一次性建的 admin 账号
```
