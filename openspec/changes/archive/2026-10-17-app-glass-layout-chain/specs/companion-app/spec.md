# companion-app — 变更规格（app-glass-layout-chain）

## MODIFIED Requirements

### Requirement: 浏览器网页全界面玻璃化
DSH Web 页面内所有不透明面板（侧栏、输入卡、消息气泡、卡片等）SHALL 统一玻璃化：背景色降为 45% 透明度并保留原色相，中等以上尺寸附加 backdrop-filter 毛玻璃模糊；全屏画布容器 SHALL 完全透明。注入 SHALL 通过 MutationObserver 对新渲染元素（如流式消息气泡）自动补玻璃化且幂等（已半透明元素不重复处理）。纱罩 SHALL 按网页文字亮度自动选深浅（45% 浓度）。宽和高均超过视口 50% 的大容器 SHALL 只被置为完全透明，MUST NOT 再被 45% 底色覆盖。分支顺序 SHALL 为：浮层 96% → **布局链全透 `isLayout`** → 全屏定位内容面板 alpha = 1 → 内容块 alpha = 1 → 大容器全透 → 45%，六条互斥；判定 SHALL 只用结构/角色特征，MUST NOT 依赖 CSS-module 类名哈希。

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
- **THEN** 该浮层的计算背景 SHALL 为 alpha 0.96 的 rgba（MUST NOT 是 0.45、MUST NOT 是 transparent），立绘与底层聊天文字 SHALL NOT 透上来干扰菜单项文字；且该浮层 MUST NOT 被附加 backdrop-filter（backdrop-filter 会让元素成为 fixed 后代的包含块，v1.32.4 曾因此把窄屏侧栏浮层锚死在被裁剪的网格列里）
- **AND** 浮层若自身已有不透明色相 SHALL 保留原色相、只改 alpha

#### Scenario: 高过半个视口的浮层不被大容器分支抢走
- **WHEN** 浮层高度超过视口的 50%（真机实测 slash 菜单为 257x392，而视口 360x671 ⇒ 阈值 180x335.5，两侧均超出）
- **THEN** 该浮层 SHALL 仍被写入 96% 底色，MUST NOT 被大容器分支写成 `transparent`；浮层判定 SHALL 排在透明分支之前且两者互斥
- **AND** 由 `role` 命中的浮层 SHALL 豁免全部几何判定（含大容器阈值）——真实菜单正是 `role=listbox` 命中，面积阈值反会把它误判成"大容器"

#### Scenario: 自身背景全透明的浮层也要被补底色
- **WHEN** 浮层表层自身的 calculated background 为 `rgba(0,0,0,0)`（真机实测：`/` 指令菜单表层 `role=listbox` 与外框 `position:absolute;z-index:100` 两层的 calculated background 均为 `rgba(0,0,0,0)`）
- **THEN** 该浮层 SHALL 被补上与页面文字亮度同判据的回退纱色（浅色页白纱 96%、深色页深纱 96%），MUST NOT 因"无背景色"或"已半透明"而被注入逻辑跳过——幂等闸门 SHALL NOT 作用于浮层

#### Scenario: 浮层例外不破坏大容器全透与侧栏两档
- **WHEN** 浮层例外生效后检查页面其余区域
- **THEN** >50% 视口的大容器（frame/中心列）背景仍为 transparent（壁纸仍全程可见）；窄屏展开态侧栏仍为 0.92；窄屏收起态侧栏与桌面宽度侧栏仍为 0.45（侧栏根的不透明度由 `bwPanelBg()` 决定，注入 MUST NOT 改写）

#### Scenario: 文档预览面板不被大容器分支抹成全透明
- **WHEN** 用户在内置浏览器中打开对话生成的文件预览/差异面板（真机实测：面板所在 `SECTION._tabHost_6nhg2_162` 为 360x671 = 100%×100%，其**原生**背景为 `rgb(255,255,255)`，而视口 360x671 ⇒ 大容器阈值 180/335.5 两侧均超出）
- **THEN** 该面板 SHALL 保持**完全不透明**（alpha = 1，保留原白色相）的实底，MUST NOT 被写成 `transparent`、MUST NOT 被降为半透明；
- **AND** 面板内的文档正文、底层页签栏与聊天正文 MUST NOT 互相叠印，长文可读；整页设备截图复核 MUST NOT 存在可辨识的底层透字

#### Scenario: 祖先链上的全屏定位覆盖层也算阅读面板
- **WHEN** 一个 `position:static` 的大容器，其祖先链上存在 `position ∈ {absolute, fixed}` 且覆盖 ≥90%×90% 视口的元素（现行 dockkit 套层实测比旧命名宿主更深）
- **THEN** 该容器 SHALL 命中 `isPanel` 并取其原生色相 alpha = 1；祖先遍历 SHALL 以 `document.body` 为上界、层数上限 24（html/body 由本注入无条件写 transparent，body 之上的 fixed 不属于页面布局）

#### Scenario: 壁纸通道不被面板例外误伤
- **WHEN** 面板例外生效后复核壁纸通道（旧命名 `BynINW_frame` / `BynINW_centerCol` / `Dc7zOa_root`，现行 `_frame_6nhg2_1` / `_centerCol_6nhg2_9` / `_root_5aaaa_1`）
- **THEN** 它们 SHALL 仍为 `rgba(0,0,0,0)`（其原生背景同为 `rgb(255,255,255)`，MUST NOT 因颜色相同而被一并变成不透明），整页壁纸与立绘仍从空隙全程可见

#### Scenario: 原生无底的大容器不凭空加底
- **WHEN** 一个 >50%×50% 的元素命中 `isPanel` 但其原生背景为完全透明（真机实测 `OUqwTW_panelBody` / `_surface_6nhg2_125`）
- **THEN** 该元素 SHALL 落入原「大容器 → transparent」分支，行为与 v1.32.11 一致；注入 MUST NOT 为其生成任何底色，也 MUST NOT 为读原生色而瞬时摘除它的内联底色之外的任何属性

#### Scenario: veil 不被面板例外误伤
- **WHEN** 复核 `#dsh-theme-veil`（`position:fixed` + `inset:0` + 100%×100%，本身会被 `isPanel` 与内容块判据命中）
- **THEN** 其不透明度 SHALL 仍为 0.45（按 id 显式排除，MUST NOT 依赖另一段注入的写入顺序，也 MUST NOT 为它执行「剥掉内联读原生色」的瞬时摘除）

#### Scenario: 定位面板内的内容块不被大容器分支抹成全透明
- **WHEN** 用户在内置浏览器中查看聊天正文里的大代码块（真机实测 `_block_7gxqk_4 md-code-block _card_7gxqk_107` 为 331x524、占视口 91.8%×78.1%，**原生** `rgb(249,250,251)`，视口 360x671 ⇒ 大容器阈值 180/335.5 两侧均超出）
- **THEN** 该内容块的背景 SHALL 保留其原生色相并取 alpha = 1（MUST NOT 是 `transparent`、MUST NOT 是 0.45），代码文字 SHALL 不再透出底层正文；整页设备截图复核 MUST NOT 存在可辨识的叠印
- **AND** 无论它位于全屏定位面板内、还是位于布局/滚动链上（自身 static/relative 且祖先无定位大覆盖层），只要它命中**内容叶子结构判据**（见「布局/滚动链单向写与内容叶子结构判据」）SHALL 一律取 alpha = 1；MUST NOT 反过来把整条布局链写成不透明

#### Scenario: 内容块判据不误伤布局容器
- **WHEN** 内容块判据（`innerBig <= 2`，`innerBig` = 该元素后代中「自身也超过 50%×50% 视口」的元素个数）生效后复核壁纸通道
- **THEN** 布局容器 SHALL 仍为 `rgba(0,0,0,0)`、整页壁纸仍透出（真机实测 `BynINW_frame`/`BynINW_centerCol`/`Dc7zOa_root` 的 `innerBig` 分别为 **70/42/41**，目标内容块为 **2**，20 倍余量）；判据 MUST NOT 以「后代含 `pre`/`code`」为依据（实测该依据会命中 `Dc7zOa_root` 这类布局容器并复现「壁纸整层消失」）

#### Scenario: 定格在 0.45 的内容块也能被纠正
- **WHEN** 一个内容块曾在"高度未过阈值"时被写入 0.45、之后长高并被判据命中
- **THEN** 幂等闸门 SHALL NOT 阻止其被纠正为 alpha = 1（否则该实例会被永久定格在 0.45）

#### Scenario: 未过阈值的小代码块保持既定 0.45
- **WHEN** 复核高度未超过视口 50% 的小代码块（真机实测同屏 8 个，如 `233x182`/`331x182`）
- **THEN** 其 SHALL 仍为 0.45（按设计走普通分支），本轮 MUST NOT 改变其行为

#### Scenario: 浮层与内容块判据只读结构不读类名
- **WHEN** 复核浮层与内容块两条判据的实现
- **THEN** 浮层判定 SHALL 依据 `role` ∈ {`menu`,`listbox`,`dialog`,`alertdialog`,`tooltip`} 直接命中，或同时满足 position 为 `fixed|absolute`、`z-index` 非 auto 且 ≥10、宽高均 ≤90% 视口、至少 3 个可交互子项；内容块判定 SHALL 只要求 `big` 且不在布局链 / 定位面板 / 侧栏根 / `#dsh-theme-veil`；两者 MUST NOT 以 CSS-module 类名哈希作为命中条件

#### Scenario: 浮层判定不依赖 CSS-module 哈希
- **WHEN** 上游改版更换 CSS-module 类名哈希后浮层重新渲染
- **THEN** 浮层仍按 role / position / z-index / 尺寸 / 子项数被命中并保持 0.96（判定 MUST NOT 依赖某一固定类名哈希）

#### Scenario: 聊天里的大代码块不被大容器分支抹成全透明
- **WHEN** 用户在内置浏览器中查看聊天正文里的大代码块（真机实测 `_block_7gxqk_4 md-code-block _card_7gxqk_107` 为 331x524、占视口 91.8%×78.1%，**原生** `rgb(249,250,251)`，视口 360x671 ⇒ 大容器阈值 180/335.5 两侧均超出）
- **THEN** 该内容块的背景 SHALL 保留其原生色相并取 alpha = 1（MUST NOT 是 `transparent`、MUST NOT 是 0.45），代码文字 SHALL 不再透出底层聊天正文；整页设备截图复核 MUST NOT 存在可辨识的叠印

## ADDED Requirements

### Requirement: 玻璃化判据 MUST NOT 以类名哈希为决定性闸门
内置浏览器玻璃化注入 SHALL 使「壁纸通道（布局/滚动容器）保持透明」这一保证**独立于上游前端构建产物**：判定 SHALL 只用可跨版本稳定的**结构/角色**特征（几何尺寸、`position`、祖先链、`role`、`z-index`、后代大容器计数、标签父子结构），MUST NOT 把 CSS-module 类名哈希当作透明与不透明之间的**决定性**闸门。类名只可用于**安全侧的显式排除**（其失效方向必须是"漏修"而非"误写"）。

#### Scenario: 上游更换 CSS-module 命名方案后玻璃化行为不变
- **WHEN** 宿主 DSH 升级换了 CSS-module 命名方案（旧 `哈希5_局部名` → 现行 `_<局部名>_<哈希5>_<行号>`），App 侧未改动
- **THEN** 布局/滚动容器 SHALL 仍为 `transparent`、壁纸与立绘仍全程可见（MUST NOT 因类名锚点失配而被写成不透明）；中小元素仍为 0.45、浮层仍为 0.96、阅读面板仍为 1.0
- **AND** 真机取证：v1.32.14 用来挡住布局容器的 `BynINW_` / `_2H3hWW_root` / `Dc7zOa_root` 在现行 bundle 全部 4 个 asset 共 1.47 MB 里 **0 命中**，那道类名闸门对任何元素恒为 false、等于不存在，故它已**静默失效**

#### Scenario: 类名锚点只可用于安全侧的显式排除
- **WHEN** 实现里保留一处类名判定（如窄屏侧栏根 `_2H3hWW_root` 的 `skipBg`/`bwPanelBg` 豁免）
- **THEN** 该类名失配时后果 SHALL 仅是"该豁免不再生效"（漏修），MUST NOT 使任何元素从透明被改写成不透明；且该豁免 SHALL 有结构判据兜底，MUST NOT 是唯一的透明保证

### Requirement: 布局/滚动链单向写与内容叶子结构判据
「布局/滚动链」（`isLayout`：`big` 且自身 `position ∈ {static, relative}` 且祖先链上不存在「定位且 ≥90%×90% 视口」的覆盖层）SHALL 是**单向写**的：一旦被本注入写成 `transparent`，后续任何轮次 MUST NOT 向其写入不透明底色，也 MUST NOT 为其执行「剥掉内联读原生色」的瞬时摘除。命中**内容叶子结构判据** `isCode` 的元素 SHALL NOT 计入布局链，SHALL 取回原生 alpha = 1 且 SHALL **当轮**落地（不受两轮迟滞约束）；`isCode` MUST 按**渲染盒树**判定（见「display:contents 包裹层」场景）。运行时测量在过渡态的失真 MUST NOT 造成可见的透明↔不透明翻转。`isLayout` 分支 SHALL 排在阅读面板与内容块分支**之前**。

#### Scenario: 连慢宿主时背景不再反复翻面
- **WHEN** App 连接渲染节奏较慢的宿主（真机为用户的「工作 VM / vm1 DSH Web」，走 tailscale；笔电 loopback 几乎不撞该窗口），在首屏与流式渲染期间对同一布局容器连续采样背景色
- **THEN** 采样期间该容器的背景 SHALL 恒为 `transparent`，**翻转次数为 0**（v1.32.14 实测会先 `rgb(255,255,255)` 后 `transparent`，用户所见即「一会儿透明一会儿不透明」）；整页截图复核壁纸与立绘持续可见

#### Scenario: 布局链单向写不被后续轮次反转
- **WHEN** 布局/滚动容器已被写成 `transparent !important`，随后发生 DOM 变更触发 MutationObserver 重跑注入（含 `innerBig` 临时 ≤2 的过渡态轮次）
- **THEN** 该容器 SHALL 仍为 `transparent`（MUST NOT 被写入原生不透明色，也 MUST NOT 被瞬时摘除内联底色——既有语义「原生不透明就不还原」会把它自己的档位底色抹掉，实测窄屏展开态侧栏的 0.92 即被此路径抹没）
- **AND** 节点被 React 替换导致内联为空时 SHALL 走保守路径：为消灭过渡态翻转，`isLayout` SHALL 带**稳定态闸门**（读注入自有标记，见下一条 requirement）；闸门关闭的轮次原生底可瞬时露出，但下一轮 SHALL 回到 transparent，MUST NOT 因此写入不透明

#### Scenario: 聊天正文大代码块不被单向写吃掉
- **WHEN** 聊天正文里承载代码块底与头部条的容器（真机实测 233x410、原生 `rgb(249,250,251)`、`innerBig=1`）位于布局/滚动链上，其 `pre`（真机 233x368）经一层 `display:contents` 包裹层挂在它下面
- **THEN** 它 SHALL 命中 `isCode` 而**不算**布局链元素，走内容块路径并取回原生 alpha = 1（MUST NOT 停在 `transparent`）；其祖先聊天根 SHALL NOT 命中 `isCode`（真机聊天根里的 `pre` 在 ≥3 层深）并 SHALL 仍为 `transparent`
- **AND** 原生背景为完全透明的 `pre` 自身 MUST NOT 被凭空加底

#### Scenario: 内容叶子判据只看盒树直接子节点，MUST NOT 放宽到整棵子树
- **WHEN** 有人把 `isCode` 从「盒树直接子节点含 `PRE`」顺手改成 `querySelector('pre')`（后代级）
- **THEN** 布局容器 SHALL 被判成内容叶子（真机聊天根的**深层**后代里也有 `pre`/`code`，整棵聊天树含代码块）⇒ 被写入不透明 ⇒ 多层白叠 ⇒ **复现 v1.32.6「壁纸整层消失」**（实测该依据下 `wouldChange` 从 1 变 2 且含布局容器）；故该判据 SHALL 只允许「自身是 `PRE`」或「盒树直接可见子节点有 `PRE`」这一深度
- **AND** 实现 SHALL 用子元素枚举而非 `querySelector(':scope > pre')`：语义等价，但不依赖选择器引擎（老 WebView 遇 `:scope` 抛 SyntaxError，而这段注入没有 try/catch，一处抛异常整段注入全废）

#### Scenario: display:contents 包裹层下的 PRE 仍算内容叶子
- **WHEN** 代码块卡片的 DOM 直接子节点是头部条与一个 `display:contents` 包裹层（真机实测 `_bannerWrap_7gxqk_` 233x42 + `_content_7gxqk_74` 返回 **0x0** 矩形），`PRE` 在该包裹层里 = DOM 孙节点、盒树直接子节点
- **THEN** 该卡片 SHALL 命中 `isCode`（判据 SHALL 关于**渲染盒树**而非 DOM 树）：扫描 SHALL 从直接子节点开始，遇 `getComputedStyle(child).display === 'contents'` 的包裹层**下钻**，深度上限 **2 层**
- **AND** 实现 MUST NOT 用「矩形为 0x0」反推「这是 contents 包裹层」（0x0 也可能是折叠容器）；扫描 SHALL 只在 `big` 元素上执行（两个消费者都要求 `big`）

#### Scenario: 结构判据当轮落地且可被 QA 观测
- **WHEN** QA 对承载代码块的容器连续采样 8 次（真机实测两侧 `nodeSeq` 在稳定态**恒定**：笔电 20、vm1 23 ⇒ 稳定态并无换节点，「虚拟化丢标记」假设已被否证）
- **THEN** 该容器 SHALL 在被访问的那一轮即取原生 alpha = 1，连续采样 SHALL 恒为 `rgb(249,250,251)`、**翻转 0**（结构判据 MUST NOT 被两轮迟滞卡住）
- **AND** 注入 SHALL 导出只读诊断数组 `window.__qaCb = [{cls, innerBig, cbOk, nodeSeq, isCode, isCB}]`，其中 `nodeSeq` 为注入侧自增的**节点身份号**（换节点即换号）；该数组 MUST NOT 参与任何判定

#### Scenario: 页面自写 inline transparent 不再构成永久锁
- **WHEN** 页面自己（非本注入）把某个布局容器内联写成 `background-color:transparent`
- **THEN** 因注入从未拥有过该元素的底，稳定态闸门 SHALL 关闭 ⇒ 该元素 MUST NOT 被永久锁在 `transparent`；它仍会因大容器兜底分支被写 `transparent`（可见结果不变，壁纸通道优先），但之后命中 `isCode` 或内容块判据时 SHALL 能拿到原生底

### Requirement: isLayout 进入条件 MUST 读注入自有标记，MUST NOT 读自己写的 inline
`isLayout` 的稳定态进入条件 SHALL 读注入自己打的**所有权标记**（写 `transparent` 时置位、写不透明 / 浮层 / 0.45 时清零），MUST NOT 读「内联背景 === `transparent`」这个由注入自身写入产生的值（判据之间 MUST NOT 互相以对方的输出为前提）。标记与内联同样随节点替换而丢失，因此本改动 MUST NOT 比既有语义更激进：**大容器兜底分支写 `transparent` 时同样 SHALL 置位标记**。瞬态几何（例如首帧高度是否过阈值）MUST NOT 决定元素的永久档位。

#### Scenario: 自锁被拆掉后同一张卡片不再看首帧命运
- **WHEN** 同一个代码块卡片分别在两种首帧下被注入访问：(a) 首帧已过 `big` 阈值（真机笔电形态 233x410）、(b) 首帧未过阈值（真机 vm1 形态 ~220px，先落 0.45）之后才长高
- **THEN** 两种首帧下该卡片最终 SHALL 都是原生 alpha = 1（`rgb(249,250,251)`）；MUST NOT 出现「首帧 big 就永久 `transparent`、首帧矮才拿到不透明」这种**首帧高度决定命运**的分歧（v1.32.15 修前实测：(a) `transparent`、(b) `rgb(249,250,251)`，与 FINDING-1 同属「瞬态几何决定永久状态」）
- **AND** 合成 DOM 对照（9 轮，**非真机**）：修前 (a) `transparent` / (b) `rgb(249,250,251)`；修后 (a)(b) 均 `rgb(249,250,251)`，且 (b) 仅 1 次收敛（0.45 → 原生）

#### Scenario: 去掉兜底分支的所有权标记会放回 v1.32.6 红线
- **WHEN** 把「大容器兜底分支写 `transparent` 时置位标记」一并去掉（即彻底拆掉锁）
- **THEN** 只有一个大后代行的布局容器（`innerBig ≤ 2`）SHALL 被内容块判据抢走、被写成 `rgb(255,255,255)` ⇒ **壁纸整层消失**（v1.32.6 红线）；合成 DOM 实测该变体在 4 个场景把布局容器写成不透明白，并在过渡态场景放回 1 次翻面 ⇒ 故兜底分支 SHALL 置位标记，锁的语义（防过渡态被抢先写白）SHALL 保留


### Requirement: 运行时测量判据的迟滞与批处理
运行时**测量**命中（`innerBig ≤ 2` 且非结构豁免）SHALL 带**迟滞**：单轮命中 MUST NOT 落地，仅当连续两轮成立才写不透明；命中结构判据 `isCode` 的元素 SHALL 豁免迟滞、当轮即允许回写（迟滞只防测量失真，MUST NOT 用来卡结构事实）；测量值回到安全侧或元素退出候选集时 MUST 清除复核标记、下次重新连续两轮。同一轮内收集到的候选 SHALL **批处理**：只排一对 `requestAnimationFrame` 复核、复核通过后只重跑一次注入，MUST NOT 因每个候选各自重跑而变成平方级开销。这些约束 MUST NOT 削弱既有档位：文档阅读面板 1.0、真菜单浮层 0.96、`#dsh-theme-veil` 0.45、中小元素 0.45、窄屏展开态侧栏 0.92、收起态 0.45、壁纸通道 transparent。

#### Scenario: 内容块不透明底须连续两轮复核后落地
- **WHEN** 一个非布局链、非定位面板的元素在某一轮被内容块判据（`innerBig ≤ 2`）单轮命中
- **THEN** 该轮 MUST NOT 写入不透明底；仅当 2x `requestAnimationFrame`（≈两帧）后复核同一判据仍成立时 SHALL 写入原生 alpha = 1（该复核 MUST NOT 在同一帧内完成——两帧之间节点可能已被换掉）；命中 `isCode` 的元素 SHALL 跳过本复核、当轮落地（见「虚拟化列表换节点」场景）；期间任一轮 `innerBig` 回到 >2 SHALL 清除复核标记并重新计时，MUST NOT 留下半程状态；已确认过的元素 MUST NOT 再排复核

#### Scenario: 复核批处理不得让注入自激成平方级
- **WHEN** 一轮注入里有数十个大元素同时成为候选（首屏时稳定态闸门对所有大元素都是关的）
- **THEN** 该轮 SHALL 只排**一对** rAF 复核、复核通过后 SHALL 只重跑**一次**注入；MUST NOT 出现「每个候选各自重跑注入」的 O(N²) 形态（实测 41 个候选即 heap OOM，真机等于 ANR）；重跑那一轮候选已确认 ⇒ MUST NOT 再次进入候选集（注入 MUST NOT 自激）

#### Scenario: 迟滞与批处理不削弱既有档位
- **WHEN** 迟滞与批处理生效后逐项复核各档位
- **THEN** 文档阅读面板 SHALL 为 alpha = 1、真菜单浮层 SHALL 为 0.96、`#dsh-theme-veil` SHALL 为 0.45、中小元素与小代码块 SHALL 为 0.45、窄屏展开态侧栏 SHALL 为 0.92、收起态 SHALL 为 0.45、壁纸通道 SHALL 为 transparent；且 `innerBig` 计算与原生色相读取 SHALL 仅在 `big && !isLayout && !isPanel` 成立时执行（先廉价后昂贵）
