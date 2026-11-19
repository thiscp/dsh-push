# 跨设备不再重载：每台 DSH 一块 WebView（v1.34.16，已发布）

## Why

用户 m01564（装完 1.34.14 当天追报）：「只在单个设备退出然后进入还算稳定，但如果我切换不同设备，再进入又会重新加载」。
模拟器两台实测坐实：进 A → 切 B（`dshwarm reload`）→ 回 A（又 `reload`）→ 再切 B（又 `reload`）。
**这不是回归**，是「窗口里只有一块 WebView、只有一个页面」的结构性行为：换 host 必须加载那台的新文档，
回来时那台的文档早被顶掉 ⇒ 跨设备每次都要重新加载。1.34.13/173 的 §7.61 明确记了「跨宿主 LRU 池本轮未做」，
当时留的结论是「要治只有一条路：按 host 各留一个 WebView 实例」。用户 m01723：「跨设备切换必重载可以开工了」。

## What Changes

- **`Page` 对象**（`WebActivity.kt`）：一台 host 一个实例，装下 `key / web / loadedUrl / loadedToken / lastUrl /
  restoreTarget / restoreAt / restoreSkip / restoreCanceled / loadErrored / retryAttempt / retryPending / authGuard / title / touchedAt`；
  活动里 `pages = LinkedHashMap<String, Page>` + `activeKey`（当前记账的页）+ `shownKey`（屏幕上的页）。
- **不动老代码的两个手法**：① **facade**——原来 11 个活动级字段全部改成读写 `activePage` 的 accessor，`web` 改成派生只读
  `get() = activePage?.web`，于是 onCreate 里那 1700 行 WebView 构造整块搬进 `buildPage(key)` 而逻辑一字未改；
  ② **`withPage(p) { … }`**（inline）——WebViewClient 每个回调包一层，临时把 `activeKey` 指到回调的 owner 页，finally 还原。
  `onScreen = activeKey == shownKey` 挡住只有可见页才能动的原生 UI（错误层、标题栏显隐、顶栏机器名）。
- **`onNewIntent` 先选页后写账**：`pages[host] ?: 按 lastUrl 匹配 ?: buildPage(host)` → 需要就 `setPage()`（只翻 VISIBLE/GONE
  + onResume/onPause，**不 loadUrl**）+ `evictPages()`（`maxPages = 3`，销毁非屏幕上那页里 `touchedAt` 最旧的）→
  然后才 `applyInstanceLabel(u)` / `lastUrl = u` → 最后 `withPage(page)` 里沿用 §7.61/§7.62 的 `warmTarget` / `warmJump` / 鉴权守卫。
- **网络恢复按页重试**：`watchNetwork.onAvailable` 遍历所有页，`broken = (可见且错误层在) || loadErrored || loadedUrl 为空`，每台各重载。
- **生命周期遍历全部页**：`onPause` 全部 `onPause()`；`onResume` 只唤活动页；`onDestroy` 逐页 removeView + destroy。

## 顺序坑（回归时先看这两处）

1. **先写账再选页 ⇒ 会话串台**：第一版 `lastUrl = u` 写在选页之前，实测 `landed v=session-6a7ef2c8…` 紧跟
   `save host=<tailnet-work>:3080 sess=session-6a7ef2c8…`——笔电的会话被存进工作VM 的 lastSess。现在 prefs 里另一台不再带 `#session-` 片段。
2. **首屏空白**：`shownKey` 原先只有 `setPage` 一处赋值 ⇒ 首屏 `attachPage` 判 `p.key == shownKey` 为假，把第一页挂成 GONE。补 `if (pages.size == 1) shownKey = key`。

## 验收（模拟器 `emulator-5554`，脚本 `C:/Temp/t176c.sh`）

判据一律 `adb logcat -d -s dshpage dshwarm`（**不带 `:W`**，那些是 `Log.d`）：

| 步骤 | 期望 | 实测 |
|---|---|---|
| A 首屏进笔电 | `dshpage new host=<tailnet-laptop>:3080 pages=1`、页面真的加载 | ✅，顶栏 `DSH 网页 · laptop` |
| B 切工作VM | 新建第二页 + 加载 | ✅ `new … pages=2` + `show … (fresh)` + `reload`，顶栏 `DSH 网页 · 工作VM` |
| C 切回笔电 | **只切 visibility，不 loadUrl** | ✅ `show host=<tailnet-laptop>:3080 pages=2 (visibility only)` + `reuse … (skip reload)`，顶栏回 `laptop`，页面仍是原会话原滚动位置（`C:/Temp/s176b-c.png`） |
| D 内存 | 记录增量，不算 FAIL | TOTAL PSS 119404 → 120298 → 122410 KB。**这台的第二页停在 401 鉴权页，比真页面轻得多**，真机两台满页要按每页几十 MB 估 |

## 已知风险（真机回归看这几条）

- 每台一块 WebView，内存按页叠加；超过 3 台时最久没碰的那台会被销毁，下次进它是冷加载（`dshpage evict host=… keep=…` 就是这一刀）。
- 后台那页的 WebSocket 仍可能被 Chromium 冻结后断开，页面显示「重连中」——点顶栏「刷新」即恢复（与 §7.61 同）。
- 后台页的自动重试 / 鉴权守卫都改成钉在自己那页上（`withPage(pg)`），不再会串到前台页；若真机出现「没人点它它自己跳登录页」，先查这条。
- 真机回归判据：① A ⇄ B ⇄ A 三跳，每次切回都是原画面（不闪白、不回顶）；② 三台以上来回几轮后第 4 台进来会把最旧那台变成冷加载，属预期；
  ③ 断网再恢复：两台都该各自重试（日志按 host 各一条）；④ 顶栏机器名跟着屏幕上那台走。
