# Proposal

## Why

v1.5.4 的 APK 把 ntfy 账号密码（`dshbot:chCnqojC…`，topic `dsh` 读写）硬编码在 dex 里，而 topic 名 `dsh` 可猜——**密码是这个 topic 的唯一守门人**。任何人拿到 APK 装上即可：

1. **偷看**：实时订阅 topic `dsh`，任务标题、问题内容一览无余；
2. **抢答**：问题推送里带一次性 nonce，旁听者能看到 nonce，抢在用户点按钮前 POST `/answer`，把 DSH 引向别的答案；
3. **捣乱**：向 topic 发布假通知轰炸手机。

ntfy 服务器本身已开鉴权（`auth-default-access: deny`），但凭据分发模型是"一个共享密码全权限"，与"APK 人手可得"的分发方式天然冲突。

## What Changes

- **服务器（aliyun ntfy）**：新建两个最小权限用户——`dshpub`（仅 topic `dsh` **write-only**）与 `dshphone`（仅 **read-only**），各发一个 access token（`tk_` 前缀，继承用户权限）。ntfy 2.29 的 token 无 per-topic 粒度，权限隔离靠**用户**实现
- **工作机推送脚本**：`dsh-ntfy-push` 改发 `Authorization: Bearer <write-only token>`（配置新增 `NTFY_TOKEN`，缺省回退旧 Basic，向后兼容）
- **App（v1.6.0）**：**删除内置账号密码**；首次启动显示"通行证"输入卡片，用户粘贴服务器签发的只读 token 存应用私有偏好；订阅与作答一律 `Bearer` 鉴权；长按头像可清空令牌换新的；令牌为空时服务保持前台运行显示"等待通行证"，不做无脑重连
- **验收后**：删除（或轮换）`dshbot` 账号，作废旧 APK 内置凭据

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `companion-app`: 新增"访问令牌鉴权"需求（APK 不含凭据、首启输入、Bearer、可更换）
- `push-relay-server`: "写入需鉴权"扩展为最小权限模型（写户读不了、读户写不了）

## Impact

- **android-app/**：PushService（去 USER/PASS、token 读取、reload action、代际计数器防双连）、MainActivity（通行证卡片、长按换令牌、状态行）、QuickAnswerActivity（Bearer）、strings、版本 1.6.0/versionCode 11
- **工作机**：`/usr/local/bin/dsh-ntfy-push` 两处（已改，备份 `.bak-token`）；`~/.config/dsh-ntfy/token` 追加 `NTFY_TOKEN`
- **服务器**：仅 ntfy 用户表（`user add`/`access`/`token add`），零配置改动、零重启
- **作答链路**：answer-relay 本就不校验 ntfy 凭据（callId 不可猜 + 服务端 bridge token），不受影响
