# Design

## 1. 权限模型（ntfy 2.29 实测）

`ntfy token add` 在本版本**没有** per-topic 权限 flag（token 继承用户全部权限），因此隔离落在**用户**上：

| 用户 | topic `dsh` 权限 | 凭据形态 | 持有者 |
|---|---|---|---|
| `dshpub` | write-only | `tk_…`（label server-push） | 工作机推送脚本 |
| `dshphone` | read-only | `tk_…`（label phone） | 手机 App（用户粘贴） |
| `dshbot` | read-write（旧） | Basic 密码（APK 内置） | 验收后删除 |
| `*` 匿名 | deny（server.yml） | — | 全部拒绝 |

实测矩阵：写 token 发布 200 / 读流 403；读 token 发布 403 / 读流 200；匿名发布 403。
（poll 端点是 `GET /{topic}?poll=1&since=…`，`/{topic}/poll` 是 404。）

## 2. 工作机脚本

`~/.config/dsh-ntfy/token` 追加 `NTFY_TOKEN=tk_…`；脚本第 56 行起：

```python
tk = c.get("NTFY_TOKEN")
auth = ("Bearer " + tk) if tk else ("Basic " + base64…)
```

发布头从 `"Basic " + auth` 改为直接用 `auth`。无 `NTFY_TOKEN` 时回退旧行为（可回滚）。

## 3. App 流程（v1.6.0）

- 凭据存储：`SharedPreferences("dshpush")` 键 `token`（升级安装保留，`lastTs`/`msgs` 不丢，无补推风暴）
- 首启/令牌为空：MainActivity 显示"通行证"卡片（EditText + 保存胶囊）；PushService 保持前台通知（文案"等待通行证…"），**不连接、不重连**
- 保存：校验 `tk_` 前缀 → 存 prefs → `startForegroundService(action="reload")` → 服务掐旧连接带新 token 重连
- 更换：长按顶栏头像 → 清空 token → 卡片重现 → 服务回等待态
- 被拒：WS 握手 401/403 → 状态行"通行证被拒(40x)"，指数退避重连（上限 60s）
- **代际计数器 `gen`**：reload 时 `gen++` 再 cancel 旧 socket，旧 socket 的 onClosed/onFailure 因 `myGen != gen` 不再触发重连，杜绝双连接

## 4. 作答链路不动的理由

answer-relay 的 `/answer/{callId}/json` 与 `/answer/submit` 从不校验 ntfy 凭据——门禁是**不可猜的 callId**（服务端注册、随推送下发）+ 服务器侧 `X-Reg-Token`/`X-Bridge-Token`。App 在 GET 上带 Bearer 仅为一致性，relay 忽略之。

## 5. 轮换与吊销

以后怀疑泄露：`docker exec ntfy ntfy token add -l phone dshphone` 发新 token、`ntfy token delete` 吊销旧的、手机长按头像贴新的——**不动账号、不重新出 APK**。
