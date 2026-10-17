# companion-app — 变更规格（app-doc-panel-opacity）

## MODIFIED Requirements

### Requirement: 浏览器网页全界面玻璃化
DSH Web 页面内所有不透明面板（侧栏、输入卡、消息气泡、卡片等）SHALL 统一玻璃化：背景色降为 45% 透明度并保留原色相，中等以上尺寸（宽>8% 视口且高>3% 视口）附加 backdrop-filter 毛玻璃模糊；全屏画布容器 SHALL 完全透明。注入 SHALL 通过 MutationObserver 对新渲染元素（如流式消息气泡）自动补玻璃化且幂等（已半透明元素不重复处理）。纱罩 SHALL 按网页文字亮度自动选深浅（浅色文字配深色纱、深色文字配浅色纱，45% 浓度），保证文字可读。透明与半透明两分支 SHALL **互斥**：宽和高均超过视口 50% 的大容器 SHALL 只被置为完全透明，MUST NOT 再被 45% 半透明底色覆盖（大容器全透是主题壁纸透出的唯一路径；覆盖会使 frame/中心列/包裹层每层各 45% 白、多层叠加成约 91% 白，壁纸整体消失）；45% 底色与 backdrop-filter SHALL 只作用于未命中全透分支的元素。**（v1.32.12）「全屏定位内容面板」SHALL 是该全透规则的例外**：命中 `isPanel` 的大容器 SHALL 用其**原生色相**恢复**完全不透明**（alpha = 1，即还原应用原生的 `rgb(255,255,255)` 纯白阅读页），MUST NOT 被写成 `transparent`，MUST NOT 被降为半透明。`isPanel` 判据 SHALL 是**结构**特征：元素自身 `position ∈ {absolute, fixed}`，或祖先 8 层内存在 `position ∈ {absolute, fixed}` 且覆盖 ≥90%×90% 视口的元素。判据 MUST NOT 以「原生背景是否不透明」为依据——真机实测壁纸通道 `BynINW_frame` 的原生背景**同样是** `rgb(255,255,255)`，用颜色判据会把壁纸通道一并变不透明并复现「壁纸整层消失」。**alpha 取值与安全性正交**：是否命中完全由下述三道护栏决定，故取 1.0 不改变任何安全性质；取 1.0 而非与浮层同档的 0.96，是因为整页长文阅读面板的职责是长时间舒适阅读（0.96 实测在面板空白处仍可辨认底层正文淡影），与「短暂浮在内容上、需要空间线索」的菜单/浮层诉求不同，两者不必同档。此外该例外 SHALL 同时满足三道护栏：① **原生确有不透明底**（`alpha >= 1`，实现上需临时摘除既有内联值以读取原生色相后再还原）——原生无底的元素 MUST NOT 被凭空加底；② 显式排除 App 自身锚点 `BynINW_*` 与侧栏根 `_2H3hWW_root`；③ 按 id 显式排除 `#dsh-theme-veil`（它自身 `fixed` + 100%×100%，会被 `isPanel` 命中；MUST NOT 依赖「另一段注入恰好先写内联」这种隐式顺序）。分支顺序 SHALL 为：浮层判定（v1.32.11）在前 → 「大容器 + `isPanel` + 原生不透明」面板 → 大容器全透 → 45%。

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
- **THEN** 该浮层 SHALL 仍被写入 96% 底色，MUST NOT 被大容器分支写成 `transparent`；浮层判定 SHALL 排在透明分支之前且两者互斥

#### Scenario: 自身背景全透明的浮层也要被补底色
- **WHEN** 浮层表层自身的 calculated background 为 `rgba(0,0,0,0)`（真机实测：`/` 指令菜单的 `role=listbox` 表层与其 `position:absolute;z-index:100` 外框两层都是全透明，底色来自样式表/伪元素）
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
- **WHEN** 一个 >50%×50% 的元素命中 `isPanel` 但其原生背景为完全透明（如 `OUqwTW_panelBody` / `_surface_6nhg2_125`）
- **THEN** 该元素 SHALL 落入原「大容器 → transparent」分支，行为与 v1.32.11 一致；注入 MUST NOT 为其生成任何底色

#### Scenario: veil 不被面板例外误伤
- **WHEN** 复核 `#dsh-theme-veil`（`position:fixed` + `inset:0` + 100%×100%，本身会被 `isPanel` 判为全屏定位面板）
- **THEN** 其不透明度 SHALL 仍为 0.45（按 id 显式排除，MUST NOT 依赖另一段注入的写入顺序）

#### Scenario: 浮层判定不依赖 CSS-module 哈希
- **WHEN** 上游改版更换 CSS-module 类名哈希后浮层重新渲染
- **THEN** 浮层仍按 role / position / z-index / 尺寸 / 子项数被命中并保持 0.96（判定 MUST NOT 依赖某一固定类名哈希）

## ADDED Requirements

### Requirement: 文档预览面板可读性
内置浏览器 SHALL 保证「全屏内容阅读面」（对话生成的文件预览、差异查看等以全屏覆盖层呈现的面板）具备**完全不透明**实底：这类面板的背景 SHALL 保留其原生色相并取 **alpha = 1**（真机实测其原生即为 `rgb(255,255,255)` 不透明纯白阅读页，故这是还原原生设计），MUST NOT 被玻璃化注入降为全透明或半透明。判定 SHALL 基于结构特征（全屏定位覆盖层）而非颜色，且 SHALL NOT 波及 App 自身壁纸通道锚点。此保证 SHALL NOT 以牺牲主题壁纸可见性为代价：壁纸通道（`BynINW_frame`/`centerCol`/`Dc7zOa_root`）的全透行为 SHALL 保持不变。

#### Scenario: 手机窄屏下文档正文清晰可读
- **WHEN** 用户在手机 App 内置浏览器（CSS 宽 360）打开对话生成的 Markdown 文件预览，立绘与聊天正文在其后方
- **THEN** 面板为不透明实底，文档文字清晰；整页设备截图复核**不再出现**底层页签栏/聊天正文/文档文字互相叠印

#### Scenario: 面板档位与侧栏档位互不干扰
- **WHEN** 文档面板例外生效后复核其它不透明档位
- **THEN** 普通卡片与输入卡 `RlGAzG_card` 仍为 0.45；窄屏展开态侧栏仍为 0.92、收起态仍为 0.45；`#dsh-theme-veil` 仍为 0.45

#### Scenario: 大代码块透明为已知遗留（常驻断言）
- **WHEN** 执行本变更的验证探针
- **THEN** 探针 SHALL 常驻打印聊天内大代码块 `_block_7gxqk_4 md-code-block`（真机实测 331x524、原生 `rgb(249,250,251)`、当前内联 `transparent`）的 alpha 与 native 值；该元素本轮**不修**（非全屏定位面板，另立判据风险更高），其透明状态 SHALL 作为已知遗留显式可见
