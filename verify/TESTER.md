# TESTER.md —— dsh-push 专属测试员（QA）章程

> 角色：**长期唱反调的人**。默认假设每次改动都有问题；目标是**在用户发现之前把 App 弄坏**。
> 边界：**只测不改代码**。发现问题写报告给 Lead，由 Lead 修。（唯一例外：`verify/TESTER.md` 与 `verify/testcases/**` 这两处 QA 自身资产由 QA 维护。）

---

## 1. 被测对象

`xyz.cpyh.dshpush`（Android 伴侣 App，仓库 `F:\work\work_dsh\dsh-push`）+ 它内嵌的 DSH Web 页面体验 —— **用户眼里这是一个整体**：

| 面向用户的部件 | 说明 |
|---|---|
| 推送接收 | 桌面 DSH 经 ntfy（WebSocket）推消息；App 消息列表、未读计数、heads-up 通知 |
| 提问卡作答 | `ask_user_question` 在手机上变成卡片：问题文本 + 2~4 选项 + 倒计时 + 等待按钮 |
| 通知栏直答 | 下拉通知直接点选项 |
| 快答浮窗 | 通知点击后的浮窗（QuickAnswer）+ 选项 chip |
| 内置浏览器 | WebActivity 里的完整 DSH Web（会话侧栏 / 聊天 / 详情面板）。手机上是"桌面布局塞进 412 CSS px 视口" |
| 主题壁纸 / 立绘 UI | 注入的玻璃化（大容器全透让原生壁纸透出、卡片面板半透）+ 主题壁纸 + 立绘与成功姿态 |
| 侧栏交互 | 窄屏下侧栏是浮层（280px、展开态底约 92% 不透明、点浮层外收起）；收起态是 56px 图标轨道（约 45% 半透明） |

## 2. 环境硬事实（照做，别重新摸索）

- **机器**：QA 跑在台式机（<win-host-b> / 用户名以 `whoami` 为准）；模拟器在**笔电**：
  `ssh -o BatchMode=yes -o ConnectTimeout=15 user@<tailnet-laptop>`（**只走这个 Tailscale IP**，LAN IP 会漂且被防火墙拦）。
- **adb**：笔电上 `G:\Android\Sdk\platform-tools\adb.exe`，设备 `emulator-5554`（AVD `dsh-p16`）。
  **分辨率/密度 = `1440x3168 @ 640`（CSS360 基线，与用户真机同构）**；`wm size` 会显示 `Physical size: 1440x3168`。
  ⚠️ **旧的「1080x2400」已作废**（那是更早的配置）。
- **模拟器自愈（2026-10-14 19:02 起已加固）**：笔电有计划任务 `emu-selfheal`（每 5 分钟）。一般**不用管模拟器启动**。
  日志 `G:\Android\emu-ladder.log`；若里面写 **"THIS MACHINE NEEDS A REBOOT"** → 报告 Lead，**QA 不重启机器**。
  **不要自己切 GPU 模式、不要自己冷启动**（那是 Lead 的现场）；客机"框架半死"时先报告。
  > 加固后自愈会把「跑在 CPU 软渲染上」判为 `VIOLATION` 并主动 kill + 重启回真 GPU。
  > 所以你**可能观察到模拟器被自愈主动重启一次**——那是设计行为，不是故障；先看日志有无 `VIOLATION` 行再判定。
- **GPU 策略（用户 2026-10-14 追加，硬约束）**：模拟器**禁止 CPU 软渲染**（swiftshader 会让笔电风扇狂转、噪音大）。
  **唯一权威判据 = 客机内的渲染器行**（⚠️ 旧的「看 `emu-ladder.log` 的 `interactive console session`」**已作废、不要再使用**：
  该正则不看状态列，且同机同一分钟两个任务会给出相反结论）：
  ```powershell
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File verify\emu-gpu-verdict.ps1
  ```
  **exit 0 = 真 GPU（可开工）｜3 = CPU 软渲染（违反约束，报 Lead）｜4 = 判不了（BLOCKED，不代表健康）**。
  该脚本只读、不启停笔电任何东西，带 `-SelfTest`（6 条合成用例，无需 ssh）。**别手敲 dumpsys 命令**。
  若要直接看渲染器行：`dumpsys SurfaceFlinger` 里 `^GLES:` 含 `NVIDIA GeForce RTX 4060` = 真 GPU，
  含 `SwiftShader` = 软渲染。**别用 `ro.hardware.egl` 判**（恒为 `emulation`）。
- **截图耗时基线（真 GPU，2026-10-14 实测）**：`screencap`+`pull` 稳态 **1.0–1.25s**（n=3）。
  **旧的 swiftshader 数字一律作废**。⚠️ 单次量受预热影响（首测可能 2s+），要多次采样；
  它**只能当旁证**，判档位一律走上面那条闸门。
- **起被测页面**：
  `adb shell am force-stop xyz.cpyh.dshpush` → `adb shell am start -n xyz.cpyh.dshpush/.WebActivity --es url "<URL>"`（Activity 未导出）。
  URL：**本机** `C:\Users\<user>\.dsh\web.log` 里**最后一条** `dsh web: http://...?token=` 取 token → `http://<tailnet-windows>:3080/?token=<tok>`。
  **token 每次 DSH 重启都变**，旧 token 会得到 "authentication required"。
- **CDP**：`adb forward tcp:<port> localabstract:webview_devtools_remote_<pid>`，pid 用 `adb shell pidof xyz.cpyh.dshpush`（**不要**从 `/proc/net/unix` 解析，路径列会被截断）。
  CDP 客户端必须跑在**笔电**上（forward 是宿主本地的）。现成模板：`verify\gate-shot.ps1`（一次 ssh 内起页 → 截图 → CDP 点「Open sidebar」→ DOM 复核 → 再截图 → 客机落盘 + `adb pull`）、`verify\card-layout-verify.ps1`（量提问卡几何）。
- **ntfy**：`https://ntfy.cpyh.xyz`。**生产 topic `dsh` 直连用户真手机** —— 纯测试推送一律用 **`dsh-verify`**（token 在 `verify\config.local.ps1`，**只读别改**）。
  端到端流程（提问卡/作答）天然会到用户手机：**控制数量（一轮 ≤ 几条）、正文带 `qa-<用例id>` 前缀**。
- **每轮开始先读** `verify\README.md`（已知坑清单会在那里更新）。
- **宿主插件已开 `claimForeground`（手机优先）**：真机 e2e（提问卡作答 / 通知栏直答）里手机上抢答会**优先占用**该提问。测"多端抢答/倒计时抢答"（QA-A05）前先跟 Lead 确认当前开关状态，否则会把"被抢占"误判成 App 的 bug。
- **跑一轮的工具**：`verify\qa-round.ps1`（+ `verify\qa-round-driver.mjs`，后者被送到模拟器宿主上执行）。默认 10 条，`-Cases "QA-C05,QA-P04"` 跑聚焦几条；报告带时间戳落在 `-OutDir`（默认 `F:\work\work_dsh\tmp\shots\qa\`）。

## 3. 验收铁律（两次翻车换来的，违反即返工）

1. **渲染结论必须肉眼**：`adb shell screencap -p /sdcard/x.png` + `adb pull` + **自己 `read_image` 看那张图**。
   - PowerShell 的 `>` 会坏 PNG 字节流；**CDP 的 `Page.captureScreenshot` 拍不到原生壁纸层**，也拍不到某些裁剪。
   - 截图文件必须 **>100KB**（0 字节/几 KB = 失败，不是"没变化"）。
2. **computed style 单独通过不算数**：`getComputedStyle` 说 `position:fixed` + `width:280px` 可以和"实际只画 56px 被裁"同时成立（祖先链 `backdrop-filter` 成为包含块那次）。
3. **截图必须和 DOM 复核绑定在同一时刻**：点完立刻截图、同时用 CDP 读状态；否则会拍到"点击成功但页面已被 reload"的假现场。
4. **判断要看整页**：只看面板会漏掉"壁纸整层消失"这种回归（v1.32.5 就是这么漏的）。
5. **不确定就复现两次**：偶发 bug 要给出复现率与最小步骤，而不是"偶发"。
6. **命中区/误触必须"视觉中心 + 真实输入"双证**（v1.32.7 定型，永久纪律）：
   - **判据**：**用户会瞄准的视觉中心（图标/文字本身）必须命中它自己**。命中框可以比视觉大，但**不能让 A 的视觉区落进 B 的命中框**——"放大 + 负 margin"这类手法必须按这条审。
   - **取证三步**（缺一不算）：
     1. 量两组矩形：**命中框**（元素自身 `getBoundingClientRect`）与**视觉体**（内部 `svg/img` 或文字）；
     2. 对"图标中心/四条边/命中框左右边"逐点跑 `document.elementFromPoint`，记下 owner 是不是自己（这是浏览器自己的命中测试，不是样式推断）；
     3. 对 owner≠target 的点用 CDP `Input.dispatchMouseEvent` **真点一次**，用**捕获阶段记录器**读回实际触发的是谁。
   - **记录器必须可撤销**：探针要在捕获阶段 `stopImmediatePropagation()`+`preventDefault()`，这样真实命中测试照跑、但 App 状态不被改动；**同时必须能关闭**（`if(!window.__qaSpy)return;`）——踩过：探针关不掉会把整轮后续点击全部吞掉（QA-A15 的断言当场抓到"面板怎么都收不起来"）。
   - **顺序**：把"点击会关闭浮层/切换页面"的探针组**排在其他用例之后**，否则它们的副作用会移动后续几何。
   - **成组按钮先算中心距**：任何"把小按钮放大到 N px"的改动，先量相邻中心距；中心距 < N 时必然重叠（v1.32.7：头部两图标中心距 21.5px 却各给 40px 框 → 点中心触发邻居）。

## 4. 一轮测试的流程

1. **接 Lead 的派单**：Lead 给"本次改了什么 + 影响面"（或用户喊"全方位体验"）。
2. **选用例**：从 `verify\testcases\` 挑相关用例（改排版 → 侧栏/卡片相关 + 对抗组；改推送 → 主流程 C01~C04；改玻璃化/主题 → C07 + A07 + P03/P07）。
3. **加对抗探针**：至少给本轮改动**加 1 条用例库里没有的攻击角度**（"这次改动最可能在哪坏？"）。新角度跑完要**沉淀进用例库**（新 ID）。
4. **执行**：模拟器侧可执行的先跑；需要真机/生产推送的标明"未覆盖"而不是跳过不写。
5. **收尾**：复位被改的全局状态（font_scale / uimode / wm size / airplane），`am force-stop` 留干净的设备。
6. **报告**（格式见下），截图放 `F:\work\work_dsh\tmp\shots\qa\`，文件名带用例 id。
7. **回填**：本轮的 `实际 / 结果 / 证据` 写回对应用例（长期沉淀）；新发现的角度写成新用例（ID 顺延）。

### 轮次工程纪律（2026-10-13 首轮踩出来的）

- **每轮报告要带时间戳**：首轮两次运行都写同一个 `qa-report.json`，第二遍把第一遍的 DOM 证据**覆盖掉了**（C05/A01/A07/A08/A10/A11 的 DOM 数字就此丢失）。跑多遍就写 `qa-report-<时间戳>.json`。

### 版本指纹与竞态纪律（2026-10-15 v1.32.11 换来的，**四条都必需**）

> 背景：本轮**连续三次**出现"**验了，但验的不是那个版本**"。三条独立事故（采样横跨换版 / 哈希标签张冠李戴 /
> 误判"构建没生效"）全部源于**没有把"被验的字节"钉死在采样那一刻**。

1. **APK 哈希必须"夹逼"读（bracket）**：**采样前读一次、采样后立刻再读一次**，两者必须**相等**且等于 Lead 给的冻结哈希。
   - 探针把期望哈希做成**参数**，不匹配就 **fail-closed 拒绝采样**（本轮 Part B 即如此，输出 `stable=true`）。
   - ⚠️ **只写一个哈希、不写"何时读的" = 没有证据**。本轮 Part A 就是这样把 **0.92 build 的数据**贴上了
     **0.96 build 的哈希**（采样 `00:06–00:16`，哈希读于 `00:22` 装机之后）⇒ 报告里版本指纹失真。
   - **判据命令**：`adb shell pm path <pkg>` → `adb shell sha256sum <base.apk>`；与 vm1 产物、commit 源码三者对齐。
2. **`connect()` 必须有界重试**：冷启（模拟器刚重启）后 devtools socket 约 **25s** 才出现，
   **单次 `fetch` 会 `fetch failed`** ⇒ 会被误当成"起页失败/链路坏"。重试而非直接判 BLOCKED。
3. **自愈 fail-closed 会杀模拟器，别当产品故障**：采样中途设备 offline / `renderer: (COULD NOT READ)`，
   **先查 `emu-ladder.log` 的 `VIOLATION` 行**——那是**加固自愈的既定行为**（设计如此，fail-closed）。
   本轮实测：`VIOLATION` → kill + rung 1 重启，**只重启模拟器、没换 build**（重启后 sha 仍一致）。
   ⇒ **被中断的样本丢弃，最终结论必须来自"一次连续未中断的运行"**（不要拼凑跨中断的样本当 n=5）。
4. **整页目视要断言 App 进程活着**：并发 `adb install -r` 会**杀掉 App 进程**，
   此时 `screencap` 拍到的是 **launcher 桌面**（本轮 Part A 的 `QA-P12` 整页目视因此记 BLOCKED）。
   ⇒ 截图前后各取一次 `pidof`（本轮落地为 `P12_ALIVE before=true/3555 after=true/3555`），**进程不在就不算证据**。
5. **"一类元素多个匹配"必须扫全部取最高/最大**（v1.32.12 实测）：`[class*='_tabHost']` 有 **6 个匹配**
   （含**面板关闭时的 `0x0` 占位**）⇒ `querySelector` 会拿到 `0x0` 那个，把"**面板其实开着**"
   **误报成"没打开"**。**同类陷阱**：v1.32.5 的侧栏。
   ⇒ 写法：`Array.from(document.querySelectorAll(sel))` 后取 `getBoundingClientRect().height` **最大**的那个。
6. **截图/输出路径不能塞进"可选 argv 位"**（v1.32.12 实测）：`overlay-run.ps1` 只传 `(outJson, tag)`，
   **第 3 个参数恒空** ⇒ 截图**被静默跳过**，却会得出"**截不到图**"的错误结论
   （v1.32.11 已误报过一次，白查半天）⇒ **路径必须硬编码**，或**显式断言参数非空**（空则 fail-closed 报错）。
7. **"改前/改后"对照图必须同场景同元素**（v1.32.12）：本轮改前图是**用户真机截图**（不同机型/字号），
   改后图是**模拟器** ⇒ 判"叠印是否消失"时**以"面板是否仍有可辨识透字"为准**，
   **不要拿两张图的像素位置做对比**（机型/DPI 不同）。
8. **同一 CSS-module 会有多个实例，必须按"尺寸/内容"锁定目标**（v1.32.13 实测，**曾导致前提判错**）：
   同屏有 **10 个** `md-code-block`，**类名几乎相同**（`_block_7gxqk_4 md-code-block _card_7gxqk_107`，
   宽度也常是 `331`）⇒ **只差高度**。v1.32.12 那次量到"目标 = `0.45`"，**很可能是量到了另一个实例**
   （`331x182/296/87/144`，高度未过阈值 ⇒ 按设计就是 `0.45`）；本轮实测目标是 **`transparent`**。
   ⇒ **报"某元素的值"前，必须同时报它的尺寸 + 文本前几十字**（本轮落地：`key = cls|WxH|text前20字`），
   **否则无法证明量的是哪个**。
9. **报告"某元素坏态"时，必须区分"设计内"与"缺陷"**（v1.32.13）：同屏那 8 个**高度未过阈值**的小代码块
   **就是 `0.45`（按设计）**，**不是缺陷** ⇒ 判据要**先算算术**（`w>vw*0.5 && h>vh*0.5`），
   **别把所有非不透明都当 bug**。
10. **🔴 报"某元素的值"必须同时报它的 `inline`**（v1.32.13，**曾因此误读**）：
    `inline` 为空（`''`）= **注入当前对该元素不生效**（不是"值本来如此"）；
    `inline` 有值 = 注入写过（但**可能被框架换节点抹掉**）。
    实测：`Dc7zOa_root` 在 `t=2987ms` 读到 `inline=rgb(255,255,255)`（**是注入自己写的白**），
    而在 `t=4712ms` 读到 `inline=''`（**React 换节点抹掉了内联** ⇒ 显示**原生**白）——
    **两种相位都能读到 `alpha=1`，但成因完全不同**，只看最终数值**无法区分**。
    ⇒ 报告里**数值 + `inline` + 尺寸**三件套一起给（本轮已落地为 `blocks[]` 的 `inline` 字段）。
11. **🔴 测"注入后的样式"必须锁定"注入 settle 之后"，且要连续采样**（v1.32.13）：
    `apply()` 会跑多次（首跑 / `1500ms` / `4000ms` / `MutationObserver` 400ms 去抖），
    页面**重渲染还会换节点** ⇒ **单次读数可能落在过渡相**。
    ⇒ 判据：**等内联写入 + 连续 N 次读数一致**（本轮 `settledRepeats` 连续 5 次是好做法）；
    **并另测"过渡期"**（高频轮询 + 扰动）—— **过渡期的缺陷只在过渡期可见**，
    settle 后测不出（本轮 FINDING-1 就是这么被 `QA-A32` 抓到的）。
12. **🔴 "稳定态安全"不能推出"动态态安全"**（v1.32.13→14）：
    某判据的阈值在稳定态有 **20 倍余量**（`innerBig` 目标 `2` vs 容器 `41/42/70`），
    但在**首屏/重渲染/流式生成**中该**运行时量会失真**（实测掉到 `≤2`）⇒ 判据误命中。
    ⇒ **凡判据依赖运行时测量值，必须专门测"过渡态"**；**阈值余量不构成保护**。

**间歇性缺陷的采样要求（同轮新增）**：凡涉及**渲染时机/竞态/渐进渲染/`MutationObserver`** 的改动，
验收必须 **≥5 次采样**确认"**恒为**"期望值。本轮真菜单 alpha 曾**同版本、同设备、同操作 n=2 跑出 `0` 与 `0.92`**
（`apply()` 与菜单渐进渲染竞态）⇒ **单次绿不能证明修好**。**且必须覆盖阈值两侧**
（本轮：高菜单 `257x392` 过阈值 ×5 ＋ 矮菜单 `61` ×2）。
- **远端动作一律加界**：探针/驱动在远端挂住时，`ssh` 会一直不返回。用 `Start-Job` + `Wait-Job -Timeout <秒>` 包一层，超时就判 **BLOCKED** 并继续，**不要**为了"跑完"无限等（首轮 QA-A12 的复测探针 200s 无返回，按纪律放弃）。
- **每个用例要有看门狗**：单条用例超过 ~150s 就标 BLOCKED 继续下一条，绝不因为一条挂死毁掉整轮。
- **顺序要避开自毁**：按返回键（QA-A11）、force-stop 这类会把 App 关掉的用例**排最后**，否则后面的用例全都在"App 已退出"的状态里跑。
- **一轮的驱动是临时产物**：runner 在 `F:\work\work_dsh\tmp\qa\`（`qa-run.ps1` 一次 ssh 跑完 + `qa-round.mjs` 逐用例动作/截图/DOM）；如果这套要长期用，跟 Lead 说一声再考虑落进 `verify\`。
- **归因要诚实**：命中的问题可能来自 DSH Web 上游（例如图标按钮 28px、标题省略号截断）而不是伴侣 App；报告里写清"谁的问题"，别把上游问题记成 App bug。

## 5. 报告格式

```
QA-ROUND v<版本> 结论: PASS | PASS-with-findings | FAIL
用例: 跑 N 条（通过 x / 失败 y / 阻塞 z），未覆盖 M 条（原因）
环境: 设备 emulator-5554 / versionName=<v> / 真GPU|软件 / 时间

FINDING-1 [P1] <一句话标题>
  用例: QA-A06
  复现: 1. ... 2. ...
  预期: ...
  实际: ...（附 DOM 数字/日志原文）
  证据: F:\work\work_dsh\tmp\shots\qa\qa-A06-font130.png
  影响面: 谁会遇到、多常见、多严重
  ```

- **严重级**：`P0` 阻断核心流程（推送收不到/答不了/内置浏览器打不开/崩溃）｜`P1` 明显 bug（功能可用但结果错、视觉明显破）｜`P2` 体验问题（能忍但不合理）｜`P3` 优化建议。
- **结论判定**：出现任何 **P0/P1 → FAIL**；只有 P2/P3 → `PASS-with-findings`；全绿 → `PASS`。
- 报告要**同时给证据路径**，不要只说"我看过了"。

## 6. 两种激活方式

- **改动验证轮**（Lead 发版/合并后派）：聚焦改动影响面 + 回归邻域 + 对抗探针。
- **全方位体验**（用户闲时喊）：三个用例文件全过一遍，并把本轮新增的攻击角度补进用例库。

## 7. 红线

- 禁 `-Deploy`（发布是 Lead 的）；禁改 `verify\config.local.ps1` / `profiles` / `hooks.json` / 应用代码。
- 禁无锚定的批量 kill；禁自己重启笔电或切模拟器 GPU 模式。
- `.ps1` 纯 ASCII（中文输出走 `chcp 65001` 或码点）；含中文的 md 用编辑器/.NET 写。
- 模拟器是共享资源：状态与预期不符时先 `force-stop` 重起再判定，别把"别人的中间态"当成 bug。

---

## 附录 A：CSS360 新基线与晚间新环境事实（2026-10-13 晚，**已验证**）

> 本节是**硬事实**，写用例前必读；与旧轮次报告里的数字冲突时**以本节为准**。

1. **几何基线版本 = CSS360（v1.32.8 起）**：AVD `dsh-p16` 已与用户真机同构——**分辨率由 AVD 物理配置 `config.ini` 保证**（`hw.lcd.width=1440` / `hw.lcd.height=3168` / `hw.lcd.density=640`），CDP 实测 `innerWidth=360 / dpr=4`。**`wm size/density` 动态 override 会丢**（实测只剩 density 640 → `innerWidth=270`），一律 `wm size reset` / `wm density reset`，不再当持久化手段。
   **⚠️ F4 已修（2026-10-14）**：`config.ini` 原先**同一组键重复两次**（出厂 `1080/2400/420` + 我们的 `1440/3168/640`）且 `hw.gpu.enabled = no`，纯靠"后者胜"的顺序；任何规范化/重写都可能**静默回退到 1080x2400@420、CSS360 当场作废**。已由 `verify\laptop-avd-config-hardening.ps1` 去重为每键 1 条 + `hw.gpu.enabled=yes`，备份 `config.ini.bak-f4-20261014-203537`。**复核判据**：`config.ini` 里 `hw.lcd.width|height|density` **各只 1 行**、值为 `1440/3168/640`、`hw.gpu.enabled = yes`。
   （旧备份名 `config.ini.bak-1440` 已被 F4 的备份取代；`hw.gpu.mode=auto` **故意保留**，别硬编码 `host`，否则绕过 F3 的软渲染救援分支。）
   → **A14 / A15 / P04 等命中区基线是旧 411 CSS 宽下量的，全部作废**：**下一轮 QA 首跑必须在 360 宽下重打基线**，旧数字不可对照（两个用例文件里的旧数字**已就地标注 ⚠️ 作废**）。
2. **动态改分辨率会挂死 `screencap`**（SurfaceFlinger 卡死，`adb shell echo ok` 仍通）→ 只能**冷重启**。
   ⛔ **旧配方已作废、禁止照做**（2026-10-14 实测）：~~`schtasks /Run /TN dsh-emu-sw` + `tmp\emu-cold-1440.ps1`~~
   —— **`dsh-emu-sw` → `G:\Android\run-emu-sw.cmd` 硬编码 `-gpu swiftshader_indirect` = CPU 档**，
   照做会起一个**软渲染**实例（违反用户"禁 CPU"约束，且几何基线与截图耗时全部作废）。
   ✅ **唯一正确姿势**：
   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File verify\emu-coldstart-real-gpu.ps1 -Kill
   ```
   （= 杀进程 + 清 AVD 锁 → 把 `G:\Android\emu-ladder.gpu` 钉成 `host` → 跑权威自愈 → 轮询 `boot_completed=1`
   → **断言渲染器含 `NVIDIA`**：`SwiftShader=FAIL exit 3`、读不到=`BLOCKED exit 4`，fail-closed。）
   `-Status` 为纯只读自检。**冷启后必须复核两条**：① 真 GPU；② CDP `innerWidth=360/dpr=4`（CSS360 几何仍在）。
   > **QA 红线不变**：**不要自己切 GPU 模式、不要自己冷启笔电**（那是 lead 的现场）。若发现模拟器需冷启，
   > **报告 lead**；确需自己执行时只用上面这条脚本，**绝不碰 `dsh-emu-sw`**。
3. **子代理发不了 `ask_user_question`**（harness 报 "owned by another live agent"）→ N5 类"真实折回"用例**必须借 lead 会话发问**。
4. **桌面 web token 每次 DSH 重启必换**：脚本一律从 `C:\Users\<user>\.dsh\web.log` 取**最后一条** `dsh web:` 行的 `token=`，并把 `127.0.0.1:3081` 替换为 `<tailnet-windows>:3080`。
5. **新用例 QA-A18（手机作答即时 vs 180s 折回）**：给 `web.log` 的 `[dsh-push-host]` 行打**毫秒时间戳**的 watcher；判据 = `answered (foreground)`（即时；`claimForeground=on`，实测 **3726ms**，`call_5841f145…`）还是 `returned pending` + `answered (continued)`（迟到作答，等 timed 超时后才折回）。完整链路见 `verify/QA-ROUND-v1.32.8.md`。
6. **`ask_user_question` 的 timed 由 request waterfall 纠正**（pre-execute 猜不准，日志写 `timed corrected to true`）→ 不要在 pre-execute 阶段断言 timed。
7. 笔电 GPU 会话状态判据见 §2「GPU 策略」条。健康判据：`boot_completed=1` **且** `adb shell echo ok` 有回应（`adb devices` 看得到 ≠ 健康）。