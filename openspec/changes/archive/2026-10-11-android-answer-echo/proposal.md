# Proposal: android-answer-echo

## Why

在 **DSH Web 网页上作答**（或浏览器兜底页作答）时，手机上的提问通知不会消失、卡片也不入已答态——只有从手机自己的入口作答才回销。answer-relay 是所有作答路径的必经点，让它作答成功后向 ntfy 发一条静默回声，App 收到即撤通知 + 入已答态，全路径统一。

## What Changes

- **relay（aliyun）**：`/answer/submit` 转发成功后向 ntfy `dsh` 发布 priority=1 静默消息，正文 `#ans <callId> <答案摘要>`（selected[0] 或 custom，多答案 " / " 连接）；凭据读 `/etc/answer-relay/ntfytok`（写 token，新文件）；发布失败静默忽略，绝不影响提交响应。
- **App**：`handleMessage` 早分支——正文以 `#ans ` 开头：解析 callId+摘要 → 从 msgs 找该 callId 的 nid → `nm.cancel(nid)` + `markAnswered` → **不渲染卡片、不弹通知**直接 return；本手机自己答过的重复回声幂等无害。
- 版本 1.13.0 / versionCode 37。

## 补丁（2026-10-11 上午，用户实测后）

用户发现：在 **DSH Web 聊天界面里直接作答**时通知不消失、卡片不变——聊天作答不经 relay，relay 回声覆盖不到（ntfy 历史证实：经 relay 的答案全有 #ans，唯独聊天作答没有）。
修法：**两端 hook 注册 PostToolUse（matcher 同 PreToolUse）**，工具结束即发 `#ans <tool_use_id> <答案摘要>`（priority=1）——任意端作答（聊天界面/ntfy 页/手机）都被工具结束这一条路兜住；与 relay 回声叠加幂等无害。App 零改动。已部署两端并模拟验证（`call_posttest|win`、`call_posttest|work` 均落 ntfy）。注意：hooks.json 改动需 DSH 重载（新会话必生效；当前长会话是否热加载待下一次真实提问验证）。

## Impact

- aliyun `/usr/local/bin/answer-relay.py`（备份后改 + 重启服务）、`/etc/answer-relay/ntfytok`（新）
- `PushService.kt`（#ans 早分支 + APP_VER）
- 能力：answer-relay（ADDED 作答回声）、companion-app（MODIFIED 一键作答：任意端作答全端回销）
