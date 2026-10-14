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

## Windows 用户机（`windows/`）

| 文件 | 说明 |
|---|---|
| `install-user.ps1` | **一键安装脚本**（给用户用）：备份 patch 文件 → `dsh plugin add` → 写 `tool-ask-user mode: timed`（新建 profile 的 `[]` 模板整体替换，老文件追加，marker 幂等）→ `--dump-config` 验挂载行与 timed 行。跑法：`powershell -NoProfile -ExecutionPolicy Bypass -File install-user.ps1 -Profile <p> -DshCli <dsh.cmd> [-Source <tarball>]`；成功后需重启 DSH 并用新会话 |
| `cutover-finish.ps1` / `rollback-plugin.ps1` / `hooks.json` / `dsh-ntfy-push.py` | 旧 hook 桥时代的生产切换/回滚件（插件上线后 hooks.json 的提问推送组应停用，见 host-plugin README） |

## 凭据丢了怎么找回（无孤本原则）

- **DSH Web token**：不用记，每次 DSH 重启必换；永远取 `web.log` 最后一行 `dsh web: http://...?token=...`
- **ntfy 读令牌**：手机 APP 设置页可见；私有仓 `verify/config.local.ps1` 有副本；都没有就重签发（见下）后改 APP 设置
- **ntfy 写令牌**：仅 verify 脚本用（hook 推送走 dshbot user/pass 基础认证），丢了重签发即可
- **根凭据 dshbot user/pass**：工作机/Windows `~/.config/dsh-ntfy/token` + 阿里云 `/root/ntfy/dshbot.password` 双备份
- **bridgetoken/regtoken**：服务器文件即权威副本，可随意换新值并同步两侧后重启服务

重签发 ntfy 令牌（user/pass 换 session 再签 token）：

```bash
curl -s -c /tmp/c.txt -d "auth=$NTFY_USER:$NTFY_PASS" https://<ntfy>/v2/account/session >/dev/null
curl -s -b /tmp/c.txt -d '{"label":"dshapp","perms":["read:dsh"]}' https://<ntfy>/v2/account/token
```

## 下发方式

```
scp <file> <host>:<path> && ssh <host> systemctl restart <svc>   # relay
scp edge-http.conf aliyun:/root/edge/conf.d/ && ssh aliyun "docker exec edge nginx -t && docker exec edge nginx -s reload"
```
