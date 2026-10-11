# deploy/ — 运行时部署文件快照

这些文件**运行时不在本仓库**，此目录是权威源码副本（改动先改这里、入库，再 scp 下去）。

## 工作机（跑 DSH 的 Linux 机器，`work/`）

| 文件 | 部署位置 | 说明 |
|---|---|---|
| `dsh-ntfy-push` | `/usr/local/bin/`（root） | DSH hook → ntfy 推送。由 net.patch.yml 里 `hooks-claude-code` 插件的 hooks.json 调起（Stop + PreToolUse）。去重：Stop 3s（按 session）、提问 15s（按 tool_use_id）。调试日志 `~/.cache/dsh-ntfy-push/{invoke,stdin,error}.log` |
| `dsh-answer-bridge.mjs` | `/home/work/bin/` | 手机作答桥接：WS 订阅 DSH `$events`，暴露 `0.0.0.0:2588/answer`（X-Bridge-Token）给阿里云 relay |
| `dsh-answer-bridge.service` | `/etc/systemd/system/` | `systemctl enable --now dsh-answer-bridge` |

凭据文件（不入库）：`~/.config/dsh-ntfy/token`（NTFY_URL/USER/PASS/RELAY_URL/RELAY_TOKEN）、`~/.config/dsh-ntfy/bridgetoken`。

## 阿里云 aliyun（`aliyun/`）

| 文件 | 部署位置 | 说明 |
|---|---|---|
| `answer-relay.py` | `/usr/local/bin/` | 公网作答页 :2587：`/answer/register`（hook 注册）、`/answer/<callId>`（H5）、`/answer/<callId>/json`（App 快答）、`/answer/submit` → 经 Tailscale 转发工作机桥接 |
| `answer-relay.service` | `/etc/systemd/system/` | `systemctl enable --now answer-relay` |
| `edge-http.conf` | `/root/edge/conf.d/` | 边缘 nginx（Docker `edge` 容器，host 网络）：ntfy.cpyh.xyz 反代 + `/answer` → 2587 + `/dl/` → `/var/www/certbot/dl/`（APK 发布）。**conf.d 是目录挂载：改完 `docker exec edge nginx -t && docker exec edge nginx -s reload`，不要 recreate** |

凭据文件（不入库）：`/etc/answer-relay/regtoken`、`/etc/answer-relay/bridgetoken`（600）、`/root/ntfy/dshbot.password`。

## 下发方式

```
scp <file> <host>:<path> && ssh <host> systemctl restart <svc>   # relay
scp edge-http.conf aliyun:/root/edge/conf.d/ && ssh aliyun "docker exec edge nginx -t && docker exec edge nginx -s reload"
```
