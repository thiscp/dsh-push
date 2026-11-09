# Proposal: multi-dsh-entry

## Why
用户同时跑两台 DSH（台式机 + 工作 VM），两台都装了推送插件。卡片与常驻通知上的「打开 DSH」永远用**这条推送自带**的 `#web` 链接，于是长期用一台时，入口全被那一台占住，另一台没有稳定入口——想进另一台只能翻旧卡片碰运气。

## What Changes
- **实例自动登记**：任何带 `#web` 的推送到达时，把 `host:port` 记成本地实例条目（名称、完整链接含 token、最近出现时间），按最近出现排序、上限 10 条。链接随每次推送刷新（token 每次重启变，登记自愈）。
- **友好名字**：推送钩子新增 `#name <标签>` 尾巴（由每台的 `WEB_NAME` 配置决定，如"台式机"/"工作VM"）；缺省回退 `host:port`。
- **两处常驻入口**：
  - 主页头部新增「DSH 入口」按钮（挨着「换主题」）→ 弹出实例选择器。
  - 常驻服务通知新增「DSH 入口」动作（与「打开 DSH」并存）→ 同一选择器，不打开 App 也能选。
- **选择器交互**：列出「名字 · host · 最近出现」；点击即用该实例链接进内置网页窗口；长按进入单条管理（重命名 / 更新链接 / 删除）；底部「手动添加或更新链接」用于从没推送过、或 token 已过期的实例（粘贴完整带 token 链接即可）。
- 单实例时同样可用（选择器里只有一条），不影响既有卡片按钮语义。

## Impact
- Affected specs: `companion-app`（ADDED：多 DSH 实例清单与常驻入口）
- Affected code: 新增 `DshHosts.kt`（清单读写）；`PushService.kt`（`#name` 解析 + 登记 + 常驻通知动作）；`MainActivity.kt`（头部按钮 + 选择器 UI + `showHosts` extra）；`deploy/windows/dsh-ntfy-push.py`（`#name` 尾巴）
