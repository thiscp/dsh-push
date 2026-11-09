# 修：窄屏侧栏浮层被祖先链裁剪（v1.32.4）

## Why

**真机回归**：用户在手机上点开 App 内置浏览器的左侧栏后，侧栏只画出约 50 CSS px 宽的一条，里面还能看到被裁的会话标题碎片（wo / Git / Tai / OS / 笔记 / 在 / 你 / 展 / 默 / 未），右侧聊天区正常。

**上一轮（v1.32.3）的验收方法有漏洞**：用 CDP 量 `getComputedStyle` 看到 `position:fixed` + `width:280px` 就判"浮层 OK"，但**"computed style 说 fixed/280px"与"实际画出来是 56px 宽被裁"可以同时成立**。本次已在模拟器上用打包 APK 复现该现象（`adb screencap` 看到的正是被裁的一条）。

根因（已用祖先链取证钉死）：

- 本文件的玻璃化注入给 `BynINW_sidebarCol`（承载侧栏的网格列，宽 56px、`overflow:hidden`）加了 `backdrop-filter: blur(12px)`；
- 而 **`backdrop-filter`（以及 `filter`/`transform`/`perspective`/`contain:paint`）会让该元素成为 fixed 后代的包含块**；
- 于是 v1.32.3 那条 `position:fixed` 的侧栏浮层并不是相对视口定位，而是相对这个 56px 宽的列定位，再被它的 `overflow:hidden` 裁掉 —— `getBoundingClientRect()` 仍然报 280px（几何值），所以只量 computed style 完全看不出来。

## What Changes

- 窄屏补丁新增一条：把侧栏祖先链上的包含块触发属性中和掉，并让承载列不裁剪 ——
  `[class*='BynINW_sidebarCol']{overflow:visible!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;filter:none!important;transform:none!important;contain:none!important;will-change:auto!important}`。
- 玻璃化注入同步调整：**不再给 `BynINW_sidebarCol` / `BynINW_frame` 加 `backdrop-filter`**（它用内联 `!important` 写样式，优先级高于补丁样式表，不跳过就压不住）；这两列的半透明底色保持不变，玻璃观感基本不变。
- 「点击内容区收起」的判定从硬编码 `clientX > 280` 改成**按浮层实际矩形判断**：浮层展开后确实盖住中心列中点时，旧判定会把"点在浮层里"误判成"点在内容上"。
- 全部规则仍限定在 `@media (max-width:1023px)`，桌面宽度零改动；注入仍幂等。
- 版本号三处同步：`versionCode 70 / versionName 1.32.4` 与 `PushService.APP_VER 1.32.4`。

## Impact

- 影响面：WebActivity 内 DSH Web 的样式与一个事件监听；不改 DOM 结构，不改 DSH 自己的 JS。
- 视觉取舍：`BynINW_sidebarCol` / `BynINW_frame` 这两层容器失去毛玻璃模糊（仍保留 45% 半透明玻璃底色），换来浮层在真机上真正可见。
- 不影响：relay 作答页、通知、消息列表、上传下载、主题壁纸；≥1024px 桌面布局。
- 验收方式升级（本变更的教训）：**必须真点击 + `adb screencap` + 肉眼 read_image**，并在截图的同一时刻用 DOM 复核状态；只用 computed style 不算通过。
- 已知同类风险：任何给 fixed 后代祖先链加 `backdrop-filter/filter/transform/contain` 的注入都可能再次触发，玻璃化注入已加注释说明。
