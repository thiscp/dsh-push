# companion-app — 变更规格（webview-dsh-022-adapt）

## ADDED Requirements

### Requirement: 内置浏览器窄屏侧栏跟随宿主改版

App 注入的窄屏修正样式 SHALL NOT 覆盖宿主 DSH 用来收起侧边栏的位移：宿主把侧栏列移到屏幕外时，
App 内 SHALL 同样看不到该列的任何内容（含「工作区」标题与其图标按钮），且 SHALL NOT 依赖宿主的
CSS-module 类名哈希来判定展开/收起，判定 SHALL 用几何量（盒宽与是否在屏幕内）。

#### Scenario: 收起侧边栏后正文上没有浮空的工作区行

- **WHEN** 在手机宽度（360 CSS px）打开 DSH 0.2.2 并收起侧边栏
- **THEN** 侧栏列 translateX 到屏幕外、屏内可见的侧栏子元素数为 0，正文不被「工作区」标题与图标遮挡

#### Scenario: 展开侧边栏行为不变

- **WHEN** 点汉堡钮或鲸鱼浮钮展开侧边栏
- **THEN** 列回到 x=0、遮罩 opacity=1、面板 fixed 宽 280，导航行与收起前一致

#### Scenario: 收起态鲸鱼浮钮半隐

- **WHEN** 侧边栏处于收起态
- **THEN** 鲸鱼浮钮按几何判定为「未展开」并吸附在屏幕边缘（实测 left=-22px），不再恒显

### Requirement: 宿主改版导致的重复导航图标去重

当宿主把导航行的 svg 移出按钮直接子层级、导致宿主或插件的「> svg」隐藏规则失配时，
App SHALL 用后代选择器隐藏被自绘图标（::before）替代的原生 svg，使每个导航行只显示一个图标。

#### Scenario: 抽屉里插件市场与专家各只有一个图标

- **WHEN** 在手机宽度打开装了 agency-agents 插件的 DSH 0.2.2 并展开侧边栏
- **THEN** 「插件市场」「专家」两行的原生 svg 被隐藏，各自只剩一个自绘图标；插件、自动化任务等行不受影响

#### Scenario: 桌面宽度不受影响

- **WHEN** 同一页面在 1280 宽桌面布局下渲染
- **THEN** 无自绘图标打标元素，各导航行仍是一个原生 svg，注入规则不改变外观
