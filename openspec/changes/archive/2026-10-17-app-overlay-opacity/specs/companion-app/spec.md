# companion-app — 变更规格（app-overlay-opacity）

## MODIFIED Requirements

### Requirement: 浏览器网页全界面玻璃化
DSH Web 页面内所有不透明面板（侧栏、输入卡、消息气泡、卡片等）SHALL 统一玻璃化：背景色降为 45% 透明度并保留原色相，中等以上尺寸（宽>8% 视口且高>3% 视口）附加 backdrop-filter 毛玻璃模糊；全屏画布容器 SHALL 完全透明。注入 SHALL 通过 MutationObserver 对新渲染元素（如流式消息气泡）自动补玻璃化且幂等（已半透明元素不重复处理）。纱罩 SHALL 按网页文字亮度自动选深浅（浅色文字配深色纱、深色文字配浅色纱，45% 浓度），保证文字可读。透明与半透明两分支 SHALL **互斥**：宽和高均超过视口 50% 的大容器 SHALL 只被置为完全透明，MUST NOT 再被 45% 半透明底色覆盖（大容器全透是主题壁纸透出的唯一路径；覆盖会使 frame/中心列/包裹层每层各 45% 白、多层叠加成约 91% 白，壁纸整体消失）；45% 底色与 backdrop-filter SHALL 只作用于未命中全透分支的元素。**（v1.32.11）浮层类元素 SHALL 是 45% 规则的例外**：命中"浮层判定"的元素 SHALL 用 **96%** 不透明度（高于侧栏面板档 92%：0.92 下实测仍可辨出底层正文叠印，而用户投诉即"太透"；0.96 只留 4% 透光并保留玻璃感），且 MUST NOT 附加 backdrop-filter（而 backdrop-filter 会让元素成为 fixed 后代的包含块——v1.32.4 曾因此把窄屏侧栏浮层锚死在被裁剪的网格列里）。浮层若自身已有不透明色相 SHALL 保留原色相只改 alpha；浮层若自身背景为全透明或已半透明（真机实测：`/` 指令菜单表层 `role=listbox` 与外框 `position:absolute;z-index:100` 两层的 calculated background 均为 `rgba(0,0,0,0)`）SHALL 改用一个与该页面文字亮度同判据的回退纱色（浅色页白纱 96%、深色页深纱 96%），且**幂等闸门（已半透明则跳过）SHALL NOT 作用于浮层**——该闸门只约束非浮层元素。**浮层分支 SHALL 位于大容器全透分支之前且两者互斥**（v1.32.11 首版顺序反了：高过 50% 视口的菜单实测 257x392 被大容器分支抢走并写成 `transparent`，浮层分支永远轮不到，实测 `alpha=0`，QA 判 P1 FAIL）；**由 `role` 命中的浮层 SHALL 豁免全部几何判定（含大容器阈值）**，因为真实菜单正是 `role=listbox` 命中，而面积阈值反会把它误判成"大容器"。浮层判定 SHALL 依据**结构/角色**特征而非硬编码 CSS-module 哈希：`role` ∈ {`menu`,`listbox`,`dialog`,`alertdialog`,`tooltip`} 直接命中；否则 SHALL 同时满足 position 为 `fixed|absolute`、`z-index` 非 auto 且 ≥10、宽 ≤90% 视口且高 ≤90% 视口、至少 3 个可交互子项。判定 SHALL NOT 作用于 App 自身锚点（`BynINW_*`）与侧栏根（`_2H3hWW_root`，其不透明度由 `bwPanelBg()` 决定：窄屏展开态 92%、收起态与桌面宽度 45%）。

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
- **WHEN** 用户在输入框键入 `/` 唤起 slash 指令菜单浮层（添加文件 / 目标 / 计划 / 反馈 / 指令 / 写入 / 压缩 / 权限 / 模型 / 下载日志），或打开任意菜单/popover/对话框浮层
- **THEN** 该浮层的计算背景 SHALL 为 alpha 0.96 的 rgba（MUST NOT 是 0.45、MUST NOT 是 transparent），立绘与底层聊天文字 SHALL NOT 透上来干扰菜单项文字；且该浮层 MUST NOT 被附加 backdrop-filter

#### Scenario: 高过半个视口的浮层不被大容器分支抢走
- **WHEN** 浮层高度超过视口的 50%（真机实测 slash 菜单为 257x392，而视口 360x671 ⇒ 阈值 180x335.5，两侧均超出）
- **THEN** 该浮层 SHALL 仍被写入 96% 底色，MUST NOT 被大容器分支写成 `transparent`；浮层判定 SHALL 排在透明分支之前且两者互斥（v1.32.11 首版顺序反了导致 `alpha=0`，此场景即该回归）

#### Scenario: 浮层判定不依赖 CSS-module 哈希
- **WHEN** 上游改版更换 CSS-module 类名哈希后浮层重新渲染
- **THEN** 浮层仍按 role / position / z-index / 尺寸 / 子项数被命中并保持 0.96（判定 MUST NOT 依赖某一固定类名哈希）

#### Scenario: 自身背景全透明的浮层也要被补底色
- **WHEN** 浮层表层自身的 calculated background 为 `rgba(0,0,0,0)`（真机实测：`/` 指令菜单的 `role=listbox` 表层与其 `position:absolute;z-index:100` 外框两层都是全透明，底色来自样式表/伪元素）
- **THEN** 该浮层 SHALL 被补上不透明度 0.96 的底色（按页面文字亮度选深/浅纱），MUST NOT 因"无背景色"或"已半透明"而被注入逻辑跳过
- **AND** 该回退 SHALL NOT 影响非浮层元素原有的幂等语义（非浮层已半透明者仍不重复处理）

#### Scenario: 浮层例外不破坏大容器全透与侧栏两档
- **WHEN** 浮层例外生效后检查页面其余区域
- **THEN** >50% 视口的大容器（frame/中心列）背景仍为 transparent（壁纸仍全程可见）；窄屏展开态侧栏仍为 0.92；窄屏收起态侧栏与桌面宽度侧栏仍为 0.45

## ADDED Requirements

### Requirement: 网页浮层可读性
内置浏览器 SHALL 保证浮层类元素（菜单、popover、对话框、下拉列表）在其上方渲染时不因底层内容透出而损害可读性：这类元素的背景不透明度 SHALL 为 **0.96**（高于"窄屏展开态侧栏"的 0.92 档，且 MUST NOT 降到 0.45；0.92 下实测仍可辨出底层正文叠印，而用户投诉即"太透"），并 SHALL 保留元素原有色相（只改 alpha，不改 r/g/b）。该保证 SHALL 覆盖两类触发方式：由 `role` 属性声明的语义浮层，以及未声明 role 但具备浮层几何特征（absolute/fixed 定位、高层叠、面积不超 90% 视口、含多个可交互子项）的容器。此保证 MUST NOT 以牺牲主题壁纸可见性为代价：大容器全透分支与侧栏两档行为 SHALL 保持不变。

#### Scenario: 手机窄屏下 slash 指令菜单文字清晰
- **WHEN** 用户在手机 App 内置浏览器（CSS 宽 360）输入框中键入 `/` 调出指令菜单，立绘与聊天正文在其后方
- **THEN** 菜单项文字清晰可读，背后立绘与聊天文字 SHALL NOT 干扰辨认；整页设备截图复核无可见叠印；DOM 复核该浮层背景 alpha 为 0.96

#### Scenario: 对话框类浮层同样受保护
- **WHEN** 页面弹出 `role=dialog` / `role=alertdialog` 的确认框或设置浮层
- **THEN** 其背景 SHALL 为 0.96 档，不再与普通卡片共用 0.45

#### Scenario: 壁纸与侧栏档位回归检查
- **WHEN** 浮层可读性修复上线后复核主题壁纸与侧栏
- **THEN** 主题壁纸与立绘 SHALL 仍从页面空隙全程可见；窄屏展开态侧栏 SHALL 仍为 0.92；收起态 SHALL 仍为 0.45；`#dsh-theme-veil` SHALL 仍为 0.45
