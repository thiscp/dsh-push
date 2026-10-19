# 直达来源会话改用客户端服务（侧栏不打扰）

## Why

用户 2026-10-17 两轮反馈：

1. 「我刚刚同时开两个对话……我去APP对应标签进入dsh网页，结果进入的是我之前在的那个长任务的对话呢」——
   网页**已经开着**时点另一条推送：App 的 `WebActivity` 是 `launchMode="singleTask"`，`onNewIntent` 虽会
   `loadUrl(新链接)`，但新链接与当前页**只差片段** ⇒ WebView 做的是同文档跳转、**不重载页面** ⇒ 只在模块
   加载那一刻跑一次的切换逻辑根本不再执行。
2. 「验证通过，但是我不希望侧边栏也自动弹出来」，随后明确纠正：「**我的要求是不弹侧边栏直接切换，
   而不是弹开后自动关闭侧边栏**」。

bundle 级实测（非推测）：

- DSH 网页端文案**本地化**，只有 zh、en 两套字典；侧栏开关的 `aria-label` 取自 `t("toggle.open")` ⇒ 中文
  系统上是「打开侧边栏」，按英文标签找必然为空（模拟器 WebView 是 en-US，所以一路掩盖着这个缺陷）。
- 切主视图有**客户端服务**：`ctx.inject(["uiWorkspace"], scope => scope.uiWorkspace.openSession(id))`，
  DSH 自家插件就在用它。直接读 `ctx.uiWorkspace` 是 undefined；且 **inject 回调不保证同步**。
- 侧栏根里「第一个按钮」两态语义不同：收起态是开关（`sameElement:true`），展开态第一个是 `New session`。

## What Changes

- 浏览器半切主视图 SHALL **优先用 `uiWorkspace.openSession`**；服务取不到或未生效才降级到语义锚点点击。
- 直达过程 MUST NOT 为了定位而展开侧栏抽屉（窄屏下侧栏是抽屉，会盖住对话）；仅降级时允许展开，且到位后
  SHALL 收回**由本能力自己展开的**侧栏（用户原本展开的不动）。
- 片段变化在页面已加载的情况下 SHALL 同样触发切换（监听 `hashchange`），且每次 SHALL 现读片段。
- 降级路径按标签匹配时 SHALL 同时覆盖中英两套文案，并优先使用与语言无关的锚点。

## Impact

- 能力 `dsh-host-plugin`：修改 1 条需求（推送网页直达来源会话），场景 2 → 4。
- 代码：`host-plugin/lib/client.js`（v0.2.2 → v0.2.5）；服务端半与伴侣 App 均未改动，无需发版。
- 无破坏性变更：服务与锚点都不可用时仍静默放弃（≤20s），行为等同本能力之前。
