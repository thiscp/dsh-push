# RUNBOOK：让 vm1 的 DSH 推送能到手机（2026-10-14）

> **状态：已完成并 PASS（2026-10-14 18:2x）** —— relay 侧已开 host `vm1`（topic 复用 `dsh`），
> vm1 凭据已写（`mode 600`），日志出现 `relay ready host=vm1 topic=dsh poll=3000ms`，
> 实推 `POST https://ntfy.cpyh.xyz/dsh → HTTP 200`。本文保留为**诊断与复现手册**（换机器/换 topic 时照做）。

> 症状：插件在 vm1 上装了、任务也跑完了，**手机收不到 vm1 的任何推送**。
> 结论：**不是安装问题，是凭据缺失导致推送/作答子系统整体关闭**（插件的设计是 fail-safe：没凭据就静默关掉推送，
> 只在日志里留一句 `relay disabled`）。本文是诊断证据 + 开通步骤 + 验收判据。

---

## 1. 诊断证据（在 vm1 实测，2026-10-14）

| 检查 | 结果 | 含义 |
|---|---|---|
| 插件版本 | `0.2.1`，`client.js` 在位 | 装是装上了 |
| profile 接线 | `package.json` 里 2 处 `dsh-push-host` | 依赖 + bundle 都在 |
| dump-config | `# == dsh-push-host` / `- id: push-host` 命中 1 | 挂载成功 |
| 客户端 UI | combo 包里含 `dsh-push-host/client.js`、`load({id:"dsh-push-host"})`、`手机作答模式` ×3、`settings.general.item` | 设置页那行会被服务出去 |
| **relay 状态** | 日志里 **`relay disabled` 11 次 / `relay ready` 0 次** | **推送被关**（决定性证据） |
| 凭据文件 | `/home/user/.config/dsh-push/credentials.json` **不存在** | 就是它 |
| 环境变量 | `DSH_PUSH_HOST` / `DSH_PUSH_HOST_TOKEN` / `DSH_PUSH_NTFY_TOKEN` / `DSH_PUSH_REG_TOKEN` / `DSH_PUSH_CREDENTIALS` **全部未设置** | 也没有旁路 |

日志原文：

```
[dsh-push-host] relay disabled (set host + hostToken, or DSH_PUSH_HOST_TOKEN): push/answer off
```

**机制**：插件的 `apply()` 会照常注册钩子、设置页照常出现，但 `host.start()` 在解析不到凭据时**提前返回** ——
于是「提问推送 / 作答轮询 / 回合结束通知」三条链路全都不存在。所以「装了但没推送」是**预期行为**，不是 bug。

## 2. 为什么必须给 vm1 一个**独立的 host id**（不能直接抄台式机的凭据）

relay 的模型是**按 host 隔离的队列**（`deploy/answer-relay.py`）：

```
HOSTS  = /var/lib/answer-relay/hosts.json   # {hostId: {token: hk_..., topic: ...}}
QUEUE  = /var/lib/answer-relay/queue.json   # {hostId: [{callId, agentId, qids, answers, ts}]}
```

- 作答提交（`/answer/submit`）靠 **callId → host** 的登记关系投递到**对应 host 的队列**；
- 插件只轮询**自己 host 的队列**。

⇒ 若 vm1 直接抄台式机的凭据（`host: desktop`），两台插件会**轮询同一个队列**：台式机（每 3s 轮询）可能
**抢走 vm1 的作答项**，然后因为不认识那个 callId 把它丢掉 —— 手机上看着「已答」，vm1 那边永远等不到答案。
**必须用不同的 host id。**

**topic 可以共用**（推荐共用 `dsh`）：手机 App 的 readToken 是按 topic 授权的（`dsh-desktop-phone` 有 `dsh` 的只读权），
vm1 只要**写**同一个 topic，手机就能看见，**无需重新配对**。此前工作 VM 就是这么接的（`relay ready host=work topic=dsh`）。

## 3. 开通步骤（relay 侧那一步需要用户批准 —— 红线：不擅自改 relay/aliyun 配置）

### 3.1 relay 侧：开一个 vm1 的 host 条目（一条命令，打印配对载荷）

```bash
# 在 aliyun-relay 上执行；<user> 取个唯一名字，例如 vm1
bash deploy/relay-user-add.sh vm1 dsh      # 第二个参数=显式复用 topic dsh（手机免重新配对）
```

它会：建 ntfy 两个用户（`dsh-vm1-pub` 只写 / `dsh-vm1-phone` 只读）、授权 topic、签令牌、
在 relay 开 host 条目（返回 `hk_` hostToken），最后**打印配对载荷 JSON**。

> 若不传第二个参数，topic 会是 `dsh-vm1` —— 那手机就必须重新配对一次才能看到。

### 3.2 vm1 侧：写凭据 + 校正 webBase/webName

把 3.1 打印的载荷保存为 `~/.config/dsh-push/credentials.json`（**原始 JSON 直接存**），并确认两个「给人看」的字段：

| 字段 | 应设为 | 为什么 |
|---|---|---|
| `webBase` | `http://<tailnet-vm1>:3080` | 手机点通知里的 `#web` 要能打开 **vm1 的** DSH 网页（不是台式机的） |
| `webName` | `测试VM1` | 手机卡片上的 `#name`，用来区分是哪个 DSH 发的 |

字段全集（与 `relay-user-add.sh` 输出一一对应）：
`v / relay / host / topic / writeToken / readToken / hostToken / regToken / webBase / webName`

### 3.3 重启 vm1 的 DSH 服务

```bash
export PATH=$HOME/.local/bin:$PATH     # 必带：否则 /usr/bin/node 缺 stripTypeScriptTypes，服务起不来
cd ~/work/cp_learn_vmware/deepseek-harness && ./dsh-net.sh restart
```

### 3.4 验收

```bash
grep -E 'credentials file|relay ready|relay disabled' ~/.dsh/web.log | tail -3
# 期望看到：
#   [dsh-push-host] credentials file: /home/user/.config/dsh-push/credentials.json
#   [dsh-push-host] relay ready host=vm1 topic=dsh poll=3000ms claimForeground=on
```

还要**真推一条**验证端到端（会到用户真机 → 用 `qa-` 前缀、只发最少条数）：

```bash
# 触发一次提问或回合结束最省事；也可按 host-plugin README 的 relay 冒烟（读/写/ack）
```

## 4. 端到端判据（缺一不算通）

| # | 判据 | 怎么看 |
|---|---|---|
| 1 | 凭据被读到 | 日志 `credentials file: …`（**这行只有文件存在且解析成功才打**） |
| 2 | relay 起来了 | 日志 `relay ready host=<id> topic=dsh poll=3000ms` |
| 3 | 没有静默关闭 | 日志里**不再出现** `relay disabled` |
| 4 | 问题有 register | 提一个真问题 → 日志 `question <callId> …` + `register <callId> -> HTTP 200` |
| 5 | 手机收到卡片 | 手机上出现带 `#name 测试VM1` 的卡片 |
| 6 | 作答能回来 | 手机点选 → 日志 `answered (foreground)` + agent 收到答案 |

## 5. 附带要清的两样（我自己留在 vm1 上的验证痕迹）

1. **`.baseline-check` 文件**：`vm1-dshnet-check.sh` 的快照（`cordis.patch.yml.baseline-check`、
   `package.json.baseline-check`）。现在既然要让 vm1 **长期**带插件跑，这两个快照已无意义 → 删掉。
2. **seed 注释行**：`# seeded by vm1-dshnet-check.sh: …` —— 配置本身（`tool-ask-user: timed`）**要保留**
   （手机作答依赖 timed），只是那行注释可以去掉。

> 注意：vm1 的 profile 现在**故意处于「已装插件 + tool-ask-user timed + 未还原」**状态 ——
> 这是为了让用户在网页上能看到设置页那一行；以前每次 `check` 之后的 `cleanup` 会把它逐字节还原，
> 那正是「vm1 上没看见插件」的原因（**是设计，不是失败**）。

## 6. 产物与命令索引

| 产物 | 用途 |
|---|---|
| `verify/vm1-host-onboard.sh` | vm1 侧一站式：查/写凭据 → 校正 webBase/webName → 重启 → 验收（打印判据 1-3） |
| `deploy/relay-user-add.sh`（已存在） | relay 侧开号 + 打印配对载荷（**需用户批准**） |
| `verify/vm1-dshnet-check.sh` | 插件改动的零写入回归（`check`/`cleanup`，带锁） |
