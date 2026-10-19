# Proposal: android-web-direct-link

## Why

通知正文里的链接文字在 Android 通知上不可点击（点通知本体触发的是 contentIntent），用户"通知弹出后一键进入 DSH 网页（Tailscale 带 token）"目前无入口。且正文现有 📱 链接只是 relay 作答页，不是 DSH Web 本体；DSH Web 的 token 每次重启必变，任何写死的链接都会过期。

## What Changes

- 推送钩子（Windows 版与工作机版）在**每条**推送（Stop 与提问）末尾追加机器行 `\n#web <url>`：发布时从 `~/.dsh/web.log` 现取**最后一条** token，主机重写为配置项 `WEB_BASE`（本机 tailnet 地址 :3080 代理），保证链接新鲜。
- App 解析并剥离 `#web` 行，把最近一次 URL 持久化；**常驻服务通知**新增"打开 DSH"按钮（ACTION_VIEW 浏览器直达）；**事件通知**在按钮名额有空位时（任务结束、无直答选项、单直答选项）补同一按钮；2-3 选项直答通知不强塞。
- ~~**主界面状态卡片**内加全宽"打开 DSH 网页"胶囊按钮~~（v1.9.3 加、v1.9.5 按用户要求退役——入口收敛为常驻通知按钮 + 卡片自带按钮）。
- **每条消息卡片**自带"DSH 网页"胶囊——链接按条存储，各条指向自己那台机器的 DSH Web（Windows 推送链 Windows，工作机推送链工作机）（v1.9.4 追加）。
- 常驻通知按钮随新消息中的新 token 自动更新（webUrl 变化即重发常驻通知）。

## Impact

- `deploy/work/dsh-ntfy-push`、`C:\Users\<user>\bin\dsh-ntfy-push.py`、两端 `~/.config/dsh-ntfy/token`（新增 `WEB_BASE`）
- `PushService.kt`（trailer 解析、prefs `webUrl`、msgs 按条存 `web`、webAction、常驻与事件按钮编排）、`MainActivity.kt`（状态卡片网页直达胶囊 + 卡片自带"DSH 网页"胶囊）、版本号 1.9.4 / versionCode 28
- 能力：companion-app（新增按钮行为）、dsh-question-notify / dsh-turn-notify（新增 #web 载荷契约）
