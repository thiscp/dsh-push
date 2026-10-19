# Tasks: android-web-direct-link

- [ ] 1. 钩子（Windows `dsh-ntfy-push.py` + 工作机 `/usr/local/bin/dsh-ntfy-push`）：`web_url()` 现取 token + `WEB_BASE` 拼链接，Stop 与提问推送均追加 `#web` trailer；两端配置加 `WEB_BASE`；语法校验 + 模拟事件验证 trailer 落进 ntfy
- [x] 2. App `PushService.kt`：MULTILINE 解析/剥离 `#web`，prefs 存 `webUrl`（变化即重发常驻通知）；`webAction()` 浏览器直达；常驻通知加"打开 DSH"；事件通知按名额账补位；版本 1.9.2 / versionCode 26
- [x] 2b. 主界面状态卡片加"打开 DSH 网页"胶囊（有 URL 才显示）；版本 1.9.3 / versionCode 27（实测追加）
- [x] 2c. 消息卡片按条存 `web` 链接并加"DSH 网页"胶囊（各条指向自己机器）；版本 1.9.4 / versionCode 28（实测追加）
- [x] 2d. 状态卡片全局大胶囊按用户要求退役（入口=常驻通知+卡片按钮）；版本 1.9.5 / versionCode 29（实测追加）
- [x] 3. vm1 构建 → 部署 aliyun `?v=35`（v1.9.2）→ `?v=36`（v1.9.3）→ 手机升级
- [x] 4. 真机验收：常驻通知按钮开网页（已验）；主界面"打开 DSH 网页"胶囊开网页；任务结束通知带按钮；DSH 重启后新推送链接仍有效
  - 实测注：2026-10-11 用户真机验收通过——常驻下拉按钮直达浏览器进 DSH；卡片自带"DSH 网页"各条直达自己机器（截图验收 v1.9.4）；全局大胶囊按用户要求于 v1.9.5 退役。线上 v1.9.5 / ?v=38。
- [x] 5. 验收后归档 change、同步 Gitee/vm1、更新主 specs
