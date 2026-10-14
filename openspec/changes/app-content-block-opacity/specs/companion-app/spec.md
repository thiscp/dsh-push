# companion-app — 变更规格（app-content-block-opacity）

## MODIFIED Requirements

### Requirement: 浏览器网页全界面玻璃化
DSH Web 页面内所有不透明面板（侧栏、输入卡、消息气泡、卡片等）SHALL 统一玻璃化：背景色降为 45% 透明度并保留原色相，中等以上尺寸（宽>8% 视口且高>3% 视口）附加 backdrop-filter 毛玻璃模糊；全屏画布容器 SHALL 完全透明。注入 SHALL 通过 MutationObserver 对新渲染元素（如流式消息气泡）自动补玻璃化且幂等（已半透明元素不重复处理）。纱罩 SHALL 按网页文字亮度自动选深浅（浅色文字配深色纱、深色文字配浅色纱，45% 浓度），保证文字可读。透明与半透明两分支 SHALL **互斥**：宽和高均超过视口 50% 的大容器 SHALL 只被置为完全透明，MUST NOT 再被 45% 半透明底色覆盖（大容器全透是主题壁纸透出的唯一路径；覆盖会使 frame/中心列/包裹层每层各 45% 白、多层叠加成约 91% 白，壁纸整体消失）；45% 底色与 backdrop-filter SHALL 只作用于未命中全透分支的元素。**（v1.32.11）浮层类元素 SHALL 是 45% 规则的例外**：命中"浮层判定"的元素 SHALL 用 **96%** 不透明度（高于侧栏面板档 92%：0.92 下实测仍可辨出底层正文叠印，而用户投诉即"太透"；0.96 只留 4% 透光并保留玻璃感），且 MUST NOT 附加 backdrop-filter（而 backdrop-filter 会让元素成为 fixed 后代的包含块——v1.32.4 曾因此把窄屏侧栏浮层锚死在被裁剪的网格列里）。浮层若自身已有不透明色相 SHALL 保留原色相只改 alpha；浮层若自身背景为全透明或已半透明（真机实测：`/` 指令菜单表层 `role=listbox` 与外框 `position:absolute;z-index:100` 两层的 calculated background 均为 `rgba(0,0,0,0)`）SHALL 改用一个与该页面文字亮度同判据的回退纱色（浅色页白纱 96%、深色页深纱 96%），且**幂等闸门（已半透明则跳过）SHALL NOT 作用于浮层**——该闸门只约束非浮层元素。**浮层分支 SHALL 位于大容器全透分支之前且两者互斥**（v1.32.11 首版顺序反了：高过 50% 视口的菜单实测 257x392 被大容器分支抢走并写成 `transparent`，浮层分支永远轮不到，实测 `alpha=0`，QA 判 P1 FAIL）；**由 `role` 命中的浮层 SHALL 豁免全部几何判定（含大容器阈值）**，因为真实菜单正是 `role=listbox` 命中，而面积阈值反会把它误判成"大容器"。**（v1.32.12）「全屏定位内容面板」SHALL 是该全透规则的例外**：命中 `isPanel` 的大容器 SHALL 用其**原生色相**恢复**完全不透明**（alpha = 1，即还原应用原生的 `rgb(255,255,255)` 纯白阅读页），MUST NOT 被写成 `transparent`，MUST NOT 被降为半透明。`isPanel` 判据 SHALL 是**结构**特征：元素自身 `position ∈ {absolute, fixed}`，或祖先 8 层内存在 `position ∈ {absolute, fixed}` 且覆盖 ≥90%×90% 视口的元素。**（v1.32.13）「话题内容块」SHALL 同样是该全透规则的例外**：形如聊天正文里的大代码块等内容元素（真机实测 `_block_7gxqk_4 md-code-block` 为 `331x524`、占视口 91.8%×78.1%、**原生 `rgb(249,250,251)` 不透明浅灰**，却落进大容器分支被写成 `transparent` ⇒ 代码文字透出底层聊天正文）SHALL 用其**原生色相**恢复**完全不透明**（alpha = 1）。内容块判据 SHALL 为结构特征 `innerBig <= 2`，其中 `innerBig` = **该元素后代中「自身也超过 50%×50% 视口」的元素个数**（即"里面还套着几层大容器"）；真机实测布局容器 `BynINW_frame`/`BynINW_centerCol`/`Dc7zOa_root` 的 `innerBig` 分别为 **70/42/41**，而目标内容块为 **2**（20 倍余量）。该判据 MUST NOT 依赖 CSS-module 类名，且 MUST NOT 以「后代含 `pre`/`code`」为依据——实测 `Dc7zOa_root`（布局容器）后代同样含 `pre`/`code`，该依据会命中布局容器并复现「壁纸整层消失」。内容块判定 SHALL 同时满足 `big && !isAnchor && 原生不透明`；**幂等闸门（已半透明则跳过）SHALL NOT 作用于命中内容块判据的元素**（否则"还矮时被写为 0.45、之后长高"的实例会被永久定格而无法纠正）。内容块与浮层、阅读面板、大容器全透三条分支 SHALL **互斥**，且 `innerBig` 计算与原生色相读取 SHALL 仅在 `big && !isAnchor` 成立时执行（先廉价后昂贵）。浮层判定 SHALL 依据**结构/角色**特征而非硬编码 CSS-module 哈希：`role` ∈ {`menu`,`listbox`,`dialog`,`alertdialog`,`tooltip`} 直接命中；否则 SHALL 同时满足 position 为 `fixed|absolute`、`z-index` 非 auto 且 ≥10、宽 ≤90% 视口且高 ≤90% 视口、至少 3 个可交互子项。判定 SHALL NOT 作用于 App 自身锚点（`BynINW_*`）与侧栏根（`_2H3hWW_root`，其不透明度由 `bwPanelBg()` 决定：窄屏展开态 92%、收起态与桌面宽度 45%）。此外 SHALL 按 id 显式排除 `#dsh-theme-veil`（它自身 `fixed` + 100%×100%，会被 `isPanel` 与内容块判据命中；MUST NOT 依赖「另一段注入恰好先写内联」这种隐式顺序）。分支顺序 SHALL 为：浮层判定 → 全屏定位内容面板 → 内容块 → 大容器全透 → 45%。

#### Scenario: 全界面玻璃化背景全程可见
- **WHEN** 用户在浏览器窗口内查看会话（侧栏、消息气泡、输入卡）
- **THEN** 各面板均为半透明玻璃质感，壁纸与立绘透过面板可见，文字经毛玻璃模糊后仍清晰

#### Scenario: 流式新气泡自动玻璃化
- **WHEN** 对话流式渲染出新的消息气泡
- **THEN** 新气泡在渲染后自动变为同款玻璃质感，与既有面板风格一致

#### Scenario: 大容器不被 45% 底色覆盖以致壁纸消失
- **WHEN** 手机 App 内置浏览器打开 DSH Web，页面含多层嵌套的 >50% 视口容器（frame/中心列/聊天包裹层），用设备截图查看
- **THEN** 壁纸与立绘从页面空隙全程可见；DOM 复核这些大容器的背景为 transparent（MUST NOT 是 alpha 0.45 的 rgba）；45% 半透明只出现在卡片、气泡等中小元素上

#### Scenario: 浮层不被压到 45% 以致菜单文字发花
- **WHEN** 用户在输入框键入 `/` 唤起 slash 指令菜单浮层，或打开任意菜单/popover/对话框浮层
- **THEN** 该浮层的计算背景 SHALL 为 alpha 0.96 的 rgba（MUST NOT 是 0.45、MUST NOT 是 transparent），立绘与底层聊天文字 SHALL NOT 透上来干扰菜单项文字；且该浮层 MUST NOT 被附加 backdrop-filter

#### Scenario: 高过半个视口的浮层不被大容器分支抢走
- **WHEN** 浮层高度超过视口的 50%（真机实测 slash 菜单为 257x392，而视口 360x671 ⇒ 阈值 180x335.5，两侧均超出）
- **THEN** 该浮层 SHALL 仍被写入 96% 底色，MUST NOT 被大容器分支写成 `transparent`；浮层判定 SHALL 排在透明分支之前且两者互斥

#### Scenario: 自身背景全透明的浮层也要被补底色
- **WHEN** 浮层表层自身的 calculated background 为 `rgba(0,0,0,0)`
- **THEN** 该浮层 SHALL 被补上不透明度 0.96 的底色（按页面文字亮度选深/浅纱），MUST NOT 因"无背景色"或"已半透明"而被注入逻辑跳过

#### Scenario: 浮层例外不破坏大容器全透与侧栏两档
- **WHEN** 浮层例外生效后检查页面其余区域
- **THEN** >50% 视口的大容器（frame/中心列）背景仍为 transparent（壁纸仍全程可见）；窄屏展开态侧栏仍为 0.92；窄屏收起态侧栏与桌面宽度侧栏仍为 0.45

#### Scenario: 文档预览面板不被大容器分支抹成全透明
- **WHEN** 用户在内置浏览器中打开对话生成的文件预览/差异面板（真机实测：面板所在 `SECTION._tabHost_6nhg2_162` 为 360x671 = 100%×100%，其**原生**背景为 `rgb(255,255,255)`，而视口 360x671 ⇒ 大容器阈值 180/335.5 两侧均超出）
- **THEN** 该面板 SHALL 保持**完全不透明**（alpha = 1，保留原白色相）的实底，MUST NOT 被写成 `transparent`、MUST NOT 被降为半透明；
- **AND** 面板内的文档正文、底层页签栏与聊天正文 MUST NOT 互相叠印，长文可读；整页设备截图复核 MUST NOT 存在可辨识的底层透字

#### Scenario: 壁纸通道不被面板例外误伤
- **WHEN** 面板例外生效后复核 App 自身锚点
- **THEN** `BynINW_frame` / `BynINW_centerCol` / `Dc7zOa_root` SHALL 仍为 `rgba(0,0,0,0)`（其原生背景同为 `rgb(255,255,255)`，MUST NOT 因颜色相同而被一并变成不透明），整页壁纸与立绘仍从空隙全程可见

#### Scenario: 原生无底的大容器不凭空加底
- **WHEN** 一个 >50%×50% 的元素命中 `isPanel` 但其原生背景为完全透明
- **THEN** 该元素 SHALL 落入原「大容器 → transparent」分支，行为与 v1.32.11 一致；注入 MUST NOT 为其生成任何底色

#### Scenario: veil 不被面板例外误伤
- **WHEN** 复核 `#dsh-theme-veil`（`position:fixed` + `inset:0` + 100%×100%，本身会被 `isPanel` 与内容块判据命中）
- **THEN** 其不透明度 SHALL 仍为 0.45（按 id 显式排除，MUST NOT 依赖另一段注入的写入顺序）

#### Scenario: 聊天里的大代码块不被大容器分支抹成全透明
- **WHEN** 用户在内置浏览器中查看聊天正文里的大代码块（真机实测 `_block_7gxqk_4 md-code-block _card_7gxqk_107` 为 331x524、占视口 91.8%×78.1%，**原生** `rgb(249,250,251)`，视口 360x671 ⇒ 大容器阈值 180/335.5 两侧均超出）
- **THEN** 该内容块的背景 SHALL 保留其原生色相并取 alpha = 1（MUST NOT 是 `transparent`、MUST NOT 是 0.45），代码文字 SHALL 不再透出底层聊天正文；整页设备截图复核 MUST NOT 存在可辨识的叠印

#### Scenario: 内容块判据不误伤布局容器
- **WHEN** 内容块判据生效后复核壁纸通道（`BynINW_frame` / `BynINW_centerCol` / `Dc7zOa_root`）
- **THEN** 三者 SHALL 仍为 `rgba(0,0,0,0)`、整页壁纸仍透出；判据 MUST NOT 以「后代含 `pre`/`code`」为依据（实测该依据会命中 `Dc7zOa_root` 这类布局容器）

#### Scenario: 定格在 0.45 的内容块也能被纠正
- **WHEN** 一个内容块曾在"高度未过阈值"时被写入 0.45、之后长高并被判据命中
- **THEN** 幂等闸门 SHALL NOT 阻止其被纠正为 alpha = 1（否则该实例会被永久定格在 0.45）

#### Scenario: 未过阈值的小代码块保持既定 0.45
- **WHEN** 复核高度未超过视口 50% 的小代码块（真机实测同屏 8 个，如 `233x182`/`331x182`）
- **THEN** 其 SHALL 仍为 0.45（按设计走普通分支），本轮 MUST NOT 改变其行为

## ADDED Requirements

### Requirement: 聊天内容块可读性
内置浏览器 SHALL 保证聊天正文里的**内容块**（大代码块等以自身底色承载阅读内容的大尺寸元素）具备不透明实底：这类元素的背景 SHALL 保留其原生色相并取 alpha = 1（真机实测其原生即为 `rgb(249,250,251)` 不透明浅灰，故这是还原原生设计），MUST NOT 被玻璃化注入降为全透明或半透明。判定 SHALL 基于**结构**特征（`innerBig <= 2`，即其后代中超过 50%×50% 视口的元素不多于 2 个）而非颜色或类名，且 SHALL NOT 波及 App 自身壁纸通道锚点与布局容器。此保证 SHALL NOT 以牺牲主题壁纸可见性为代价：壁纸通道（`BynINW_frame`/`centerCol`/`Dc7zOa_root`）的全透行为 SHALL 保持不变。未超过大容器阈值的小代码块 SHALL 维持既有 0.45 行为（属既定设计，非缺陷）。

#### Scenario: 手机窄屏下代码块文字清晰可读
- **WHEN** 用户在手机 App 内置浏览器（CSS 宽 360）查看聊天正文里的大代码块，底层聊天正文在其后方
- **THEN** 该内容块为不透明实底、保留原生浅灰色相，代码文字清晰；整页设备截图复核**不再出现**代码文字与底层正文互相叠印

#### Scenario: 内容块档位与其它档位互不干扰
- **WHEN** 内容块例外生效后复核其它不透明档位
- **THEN** 文档阅读面板 `_tabHost` 仍为 1.0；真菜单浮层仍为 0.96；`#dsh-theme-veil` 仍为 0.45；输入卡 `RlGAzG_card` 仍为 0.45；窄屏展开态侧栏仍为 0.92、收起态仍为 0.45

#### Scenario: 布局容器 MUST NOT 被写入不透明底（v1.32.14 追补）
- **WHEN** 内容块判据在**动态态**下求值（首屏渲染中、局部重渲染中、流式生成中，后代元素尚未撑开，`innerBig` 可能临时小于稳定态）
- **THEN** 布局/滚动容器（`BynINW_*`、`_2H3hWW_root`、`Dc7zOa_root`）SHALL 被**显式排除**在内容块判据与"取原生色相回写"路径之外，MUST NOT 因 `innerBig` 这一运行时测量的临时失真而被写入 `rgb(255,255,255)` 之类的不透明底（真机实测：聊天根 `Dc7zOa_root` 原生即 `rgb(255,255,255)` 兜底白，一旦被写成不透明，其在 84%×100% 面积上等同于瞬时关闭壁纸通道，表现与 v1.32.6 的瞬时版一致）
- **AND** 该排除 MUST NOT 削弱本轮修复效果（内容块不可能是聊天根，改动集仍应恰好为那一个大代码块）
