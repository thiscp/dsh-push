# 点推送直达来源会话

## Why

用户 2026-10-17 反馈：「我目前通过消息通知上的卡片的dsh网页按钮进入网页后，似乎是之前默认的对话，
能进入后直接进入推送通知的那个对话吗」。

实测定位（全部有证据，非推测）：

- `#web` 链接只是 web.log 里最后一条 `?token=` URL（可换基址），**不带任何对话身份**；
- 网页客户端**没有路由**（bundle 里 `createRouter` 0 命中，`pushState`/`popstate` 命中都在 lodash 注释里），
  也没有任何按 URL 选会话的入口（`session=` 0 命中；`location.search` 的 3 处命中都在 JSON-schema 库里）；
- `?token=` 入口回的是 **`303 See Other → Location: ./`**，查询串在这一步被丢弃，而 fragment 跨跳转保留；
- `/session/<id>`、`/s/<id>` 都是 **404**；页面暴露的全局只有 `__DSH_BOOT__`（模块清单）等，没有可调的
  「打开会话」API；插件 client 可注入的服务里 `sessions.enter()` 是存储作用域操作，不是导航。

所以「按 URL 直达会话」在 DSH 本体里不存在，但**不必等本体改**：链接侧与浏览器侧都在本插件手里，
而 DOM 提供的是语义化锚点（`data-conversation-session`、`data-row-key="session:<id>"`、
`aria-label="Open sidebar"`），不是哈希类名。

## What Changes

- **服务端半**：`webUrl(sessionId)` 把来源会话 id 作为 **URL 片段**拼到 `#web` 链接尾
  （`…#session-<uuid>`）；提问推送与轮次结束推送两条路径都带。id 缺失或形态不对就不拼，
  绝不产出以裸 `#` 结尾的链接。
- **浏览器半**：`lib/client.js` 新增 `revealFromHash(ctx)`，读片段把主视图切到该会话，到位后
  `history.replaceState` 抹掉片段；找不到目标在 ≤20s 内静默放弃。
- App 侧**零改动**：v1.9.4 起每条消息已各自存 `#web` 链接，卡片按钮原样 `loadUrl`。
- 插件版本 **0.2.1 → 0.2.2**；selftest **101 → 104**（3 条片段断言）。

## Impact

- 受影响的规格：`dsh-host-plugin`（MODIFIED「提问推送（宿主插件路径）」「轮次结束推送（宿主插件路径）」，
  ADDED「推送网页直达来源会话」）。
- 受影响的代码：`host-plugin/lib/index.js`、`host-plugin/lib/client.js`、`host-plugin/package.json`、
  `host-plugin/plugin-selftest.mjs`、`host-plugin/README.md`。
- 兼容性：不认识片段的旧网页端与旧 App 行为完全不变；部署只需覆盖插件文件并重启 DSH（token 会变）。
- 已实测：VM1（真点卡片按钮 → 落地标题即推送所属会话）与笔电生产（用户验收通过；App 存的 `web`
  字段带 `#session-…`）两侧均通过。
