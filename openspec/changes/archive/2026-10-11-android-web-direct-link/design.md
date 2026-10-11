# Design: android-web-direct-link

## 硬事实

- 两端 DSH Web 拓扑一致：`0.0.0.0:3080` 代理 → `127.0.0.1:3081` 本体；`~/.dsh/web.log` 只记 `http://127.0.0.1:3081/?token=…`，token 跨地址同值、**每次重启必变**，日志跨重启追加必须取最后一条。
- 手机已在 tailnet（作答回桥就走 <tailnet-windows>:2588），`http://<tailnet-ip>:3080/?token=` 手机浏览器可达。
- 通知正文文字不可点击（contentIntent 优先），所以直达只能做成 action 按钮。
- AOSP 通知 action 上限 3，已被选项直答与"肥鱼快答"占用。

## #web trailer

- 格式：`\n#web <完整URL>`，钩子在**每条**推送追加（Stop 与提问都加）；位于 `#opts` 之前。App 端两个 trailer 正则均用 MULTILINE，行序不敏感。
- token 现取：钩子逐行扫 `~/.dsh/web.log` 匹配 `dsh web: http://\S+[?&]token=(\S+)` 取最后一次命中；取不到（日志缺失/服务没起）则整条 trailer 省略，推送照常。
- `WEB_BASE` 来自 `~/.config/dsh-ntfy/token`：Windows `http://<tailnet-windows>:3080`，工作机 `http://<tailnet-work>:3080`。缺配置则不加 trailer。

## 按钮编排（名额账）

| 场景 | 已占 | 网页按钮 |
|---|---|---|
| 任务结束（无 callId） | 0 | ✅ |
| 提问，无直答载荷（>3 选项/多问题） | 快答 1 | ✅ |
| 提问，直答选项 ≤1（实际不会出现 1） | 快答 1 | ✅ |
| 提问，直答选项 2 | 选项×2+快答 | ❌ |
| 提问，直答选项 3 | 选项×3 | ❌ |
| 常驻服务通知 | 0 | ✅ 永远 |

判定式：`web.isNotEmpty() && (callId == null || directLabels.size < 2)`。

## 新鲜度语义

prefs `webUrl` 存最近一次收到的 URL；DSH Web 重启后旧链接 401，属预期——下一条推送自动带新 token 并重发常驻通知。常驻通知在 webUrl 变化时 `notify` 刷新。

## 浏览器直达

`Intent.ACTION_VIEW + FLAG_ACTIVITY_NEW_TASK`，PendingIntent.getActivity（FLAG_IMMUTABLE）。不做 resolveActivity，无需 QUERY_ALL_PACKAGES；token 落浏览器后 DSH Web 自签 cookie。
