# VERIFICATION — dsh-app-token-auth（v1.6.0）

验收日期：2026-10-10 · 设备：iQOO 13 / Android 16（OriginOS）· 服务器：aliyun ntfy 2.29（Docker）

## 1. 服务器隔离矩阵（curl 实测）

| 凭据 | 发布 POST /dsh | 订阅/读流 |
|---|---|---|
| `dshpub` write-only token | **200** ✅ | **403** ✅ |
| `dshphone` read-only token | **403** ✅ | **200**（收到消息帧）✅ |
| 匿名 | 403 ✅ | — |
| 旧 `dshbot` Basic（删号后） | — | **401** ✅ |

最终用户表：`dshphone`（read-only dsh）/ `dshpub`（write-only dsh）/ 匿名 deny——**共享密码时代结束**。

## 2. 工作机推送脚本

- `~/.config/dsh-ntfy/token` 追加 `NTFY_TOKEN`（write-only），脚本改 `Bearer`（备份 `.bak-token`，`py_compile` 通过）
- 端到端模拟 Stop 钩子：exit=0，`error.log` 无 `push fail`，手机实际收到 `DSH 任务结束 [ntest0001]`
- 删 `dshbot` 后服务器推送仍 200（token 不依赖账号密码）

## 3. 真机验收（用户逐项确认，4/4 通过）

- [x] 3.1 升级安装后首启出现"通行证"卡片；粘贴 `tk_` 令牌 → 状态"已连接"，服务通知恢复"监听中…"
- [x] 3.2 推送到达正常：两类通知 + 两种提示音不回归；肥鱼快答提交成功
- [x] 3.3 长按头像清空 → 状态"等待通行证"（服务不崩、不刷重连）；贴回恢复
- [x] 3.4 贴错令牌 → 状态"通行证被拒(403)"，指数退避重连

## 4. 构建与分发

- vm1 `gradle assembleDebug` BUILD SUCCESSFUL（4s，无新依赖）；`openspec validate --strict` 通过
- APK 2,117,698 字节 → `https://ntfy.cpyh.xyz/dl/dsh-push.apk?v=20`（HTTPS 200 校验一致）

## 5. 运维备忘

- **轮换令牌**：`docker exec ntfy ntfy token add -l phone dshphone` 发新 → `ntfy token del <id>` 吊销旧的 → 手机长按头像贴新的。**不用重新出 APK**
- ntfy 2.29 的 `token add` 无 per-topic 旗标（token 继承用户权限），隔离靠双用户实现；`user remove`（不是 `delete`）删号
- poll 端点是 `GET /{topic}?poll=1&since=…`；`/{topic}/json` 是流式长连接，curl 测读权限加 `-m` 即可
- 升级 vivo 老规矩：装完若状态不刷新，设置→应用→强行停止→重新打开
