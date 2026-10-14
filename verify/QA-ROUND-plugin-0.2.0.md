# QA-ROUND plugin-0.2.0 设计（host-plugin v0.2.0 设置页「手机作答模式」开关）

```
状态: 设计完成 + 断言已按 task-9 成品回填；**0.2.0 已因 P0 生产事故作废（见「P0 事故记录」节），
      生产已回滚 0.1.1+timed；P02/P03 只在 0.2.1 装好后跑**。
      新增 P07（开机零写入回归，最高优先）= 0.2.1 进生产前的 QA 闸。
被测: dsh-push-host 0.1.1 → 0.2.0(作废) → 0.2.1（设置页「手机作答模式」开关 + 宿主侧写入）
范围: 插件侧 + 宿主配置写入；不涉 android-app 回归
判定: P0/P1=FAIL 打回；"跑了但没量到"=BLOCKED
```

## 0. 环境硬事实（设计期实测钉死，执行期直接用）

| 事实 | 值 | 来源 |
|---|---|---|
| DSH CLI | `D:\programs\dsh\resources\runtime\cli\bin\dsh.cmd`（PATH 无 `dsh`，必须全路径） | dsh-net.ps1 `$DshCli` + Test-Path |
| 生产 web 实例 | dsh-net.ps1 托管：公网 3080（node 代理）→ 内层 `--profile web --no-open --host 127.0.0.1 --port 3081`；日志 `~\.dsh\web.log` | dsh-net.ps1 |
| token 取法 | 实例**自己的**日志里 `dsh web: http://[0-9.]+:[0-9]+/\?token=(\S+)` 的**最后一次**匹配（日志 append-only，首个是旧 token） | dsh-net.ps1 Get-Token |
| **selftest 用哪个 node（P01 命门）** | 只用 ①DSH 自带 runtime node `D:\programs\dsh\resources\runtime\primary-runtime\dependencies\node\bin\node.exe`（v24.21.0，实测 82/82 exit 0）或 ②electron-as-node。**绝不用** harness 的 `C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`——`copyFileSync` 被拒 EPERM；0.2.0+ 已加 preflight 守卫：误用 = `BLOCKED … copyFileSync failed: EPERM` + **exit 2**（预期行为，引用它当「守卫有效」证据，不是 FAIL）。两 runner 证据均已落盘：`tmp\shots\p0x\p01-selftest.txt` / `p01-selftest-harnessnode-guard.txt` | Lead 手递 + 实测（5576bfe 提取树） |
| selftest 基线 | **82/82 checks passed**（5576bfe=0.2.0+preflight，提取干净树实测；旧记 53→81→82 演进=原 53+28 开关用例+1 守卫）。**P01 终版必须对 developer 已提交的 0.2.1 commit 跑**——worktree 在途改动不算数（实测：developer 半路 worktree 曾 `z.union(...).optional is not a function` 崩 import）。跑不了 worktree 时的干净跑法：`git show <sha>:host-plugin/<f>` 提取到 tmp + `New-Item -ItemType Junction` 挂 repo 的 `host-plugin\node_modules`（已验证） | 实跑 |
| Edge | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`，`--headless=new --remote-debugging-port=<9224/9225> --user-data-dir=F:\work\work_dsh\tmp\p0x\edge-profile[-p03] --window-size=1440,900 --no-first-run --no-default-browser-check <URL>` | 设计期实测跑通 |
| CDP 姿势 | `GET http://127.0.0.1:<port>/json/list` → page target `webSocketDebuggerUrl` → 全局 WebSocket → `Runtime.evaluate`/`Input.dispatchMouseEvent`/`Page.captureScreenshot`；收尾 `taskkill /T /F /PID`；Edge spawn 必须 `stdio:'ignore'`（管道 stdio 撞沙箱 EPERM） | `tmp\p0x\probe-settings.mjs` 已验证 |
| 设置页入口 | 点侧栏底部 `BUTTON.wCInkW_trigger`（文本「设置」）→ **URL 不变**弹「设置」模态；关闭=模态右上 × | probe-settings.png 肉眼判 |
| **dsh-push 设置行（f8326ce 读死）** | 槽=`settings.general.item`（在「设置→通用」区），id=`push-host-ask-user-mode`，label=**「手机作答模式」**；仅 push-host 命名空间被 serve（插件装载）时出现。定位=设置模态内找文本「手机作答模式」的行 | lib/client.js:40-45,86 |
| **状态文案（读死）** | timed=「已开启：ask_user_question 走 timed——提问会推送到手机，超时后手机答案仍可续答。」；legacy=「未开启：ask_user_question 走 legacy——只有 DSH 网页能作答。」 | lib/client.js:87-89 |
| **按钮文案（读死）** | legacy 态=「启用（切到 timed）」；timed 态=「停用（回到 legacy）」；写入中=「切换中…」且 disabled | lib/client.js:96-101 |
| **代际文案（读死，P04 判据）** | 「切换即时热生效、无需重启宿主；新会话立即生效，已开老会话保持旧行为（工具变体钉在会话创建时）。切换前自动备份 cordis.patch.yml。」 | lib/client.js:90-91 |
| **报错文案（读死，P05 判据）** | 「上次切换失败：<status>（若提示 overridden by a home patch，请先移除 home 层或命令行对 tool-ask-user 的同 id 覆盖）」——status=宿主回写的 askUserStatus（含 configEditor 抛的 `overridden by a home patch`） | lib/client.js:92-95 |
| profile 目录 | `~\.dsh\profiles\<p>\cordis.patch.yml`；现有：desktop/headless/pushdist/pushdist2/pushtest/qsprobe/web | 实测 |
| home 层 | `~\.dsh\cordis.patch.yml` **当前不存在**（P05"备份"=记录不存在，测后删回不存在） | 实测 Test-Path False |
| **scratch 必须 web-app bundle（developer 手递）** | headless bundle 起实例撞 **MISSING_CREDENTIAL**（本机 .credentials.yaml 已无 DEEPSEEK_API_KEY，账号平台 grant 只在 web-app bundle 可用）→ qa-p03 从 **web profile 复制**建（base+web-app bundle） | developer f8326ce 手递 |
| **plugin add 子命令姿势（developer 手递）** | `dsh plugin --profile <p> add link:F:\work\work_dsh\dsh-push\host-plugin`（`plugin` 在 `--profile` **前**；web-app bundle 下 `dsh --profile <p> plugin add` 不认 plugin 子命令） | developer 手递 |
| **scratch 会上手机（设计期推翻 developer 假设）** | `~\.config\dsh-push\credentials.json` **存在**（实测 True）且 dsh-net 不设 DSH_PUSH_* env → 插件凭据文件层生效 → scratch 实例 relay **激活**，P03 提问**会推 1 条真通知到用户真机**（+1 条静默 #ans 回声）。对策=scratch 新会话命名 **qa-p03**（推送标题「DSH 等你选择 [qa-p03]」满足 qa- 前缀红线；总条数 2 已是最少） | lib/index.js:30-39 凭据分层 + 实测凭据文件存在 |
| 证据目录 | `F:\work\work_dsh\tmp\shots\p0x\`（截图 >100KB 逐张 read_image 判；哈希/日志/dump 文本同目录） | 惯例 |

**执行顺序**：**P07（0.2.1 放行闸，vm1 环境，最先跑）** → P01 → P02（生产）→ 建 scratch → **P05（scratch 翻转前跑失败路径）→ P03 → P04** → P06。P05 先于 P03：home 覆盖要在 legacy 态点按钮验报错，撤掉覆盖后才轮到 P03 成功翻转。P07 不过（WRITE DETECTED）则 P02/P03 不跑、0.2.1 不进生产。

**红线**：不重启生产 web（P02 前置重启是 Lead 的活）；不写 web profile 的 cordis.patch.yml（P02 只读，见 P02 语义修正）；home 层改前必备份必撤；scratch profile 名 `qa-p03`；P03 推送 1+1 条（标题带 qa-p03）；P06 复查生产 patch 哈希；**vm1 用户服务上 check 完必须 cleanup**（动的是用户 profile）；**vm1 任何 dsh 命令前 `export PATH=$HOME/.local/bin:$PATH`**（/usr/bin/node 缺 stripTypeScriptTypes 会搞挂服务）。

---

## P01 selftest 全绿（P0）

- **对象**：developer **已提交**的 0.2.1 commit（worktree 在途改动不算数——实测半路 worktree 曾 zod 崩 import）。跑法：repo 目录直跑，或 `git show <sha>:host-plugin/<f>` 提取到 `tmp\p0x\hp-<sha>\` + Junction 挂 `host-plugin\node_modules`（已验证可行）
- **工具链**：`& "D:\programs\dsh\resources\runtime\primary-runtime\dependencies\node\bin\node.exe" plugin-selftest.mjs`（**禁** harness node）。全输出存 `p01-selftest.txt`
- **断言**：
  1. 末行匹配 `^(\d+)/\1 checks passed$`（零失败）
  2. N ≥ **82**（既有 82 项不许退化；0.2.1 三守卫新增项计入 N）
  3. 输出无 `failed:` 行；exit 0
  4. **守卫证据**（已落盘，0.2.0/5576bfe 上验证）：harness node 跑 → `BLOCKED … copyFileSync failed: EPERM` + **exit 2**（预期，非 FAIL）→ `p01-selftest-harnessnode-guard.txt`
- **证据**：`p01-selftest.txt` 全文 + `p01-selftest-harnessnode-guard.txt`
- **失败语义**：任一不满足 = FAIL(P0) 打回

### P01 实际（2026-10-14 17:5x，host-plugin@2c971ec 提取树）

- 提取 2c971ec 全部 host-plugin 文件（`git ls-tree` 驱动，13 个文件）+ Junction node_modules → `tmp\p0x\hp-2c971ec\`
- DSH runtime node（v24.21.0）跑 `plugin-selftest.mjs` → **exit 0，`101/101 checks passed`**（≥82 ✓，无 `failed:` 行）
- harness node 跑 → **exit 2**，`BLOCKED section 14 needs a working fs copy … copyFileSync failed: EPERM`（守卫有效 ✓）
- 附加：`plugin-selftest-credentials.mjs` → **54/54 exit 0** ✓；`relay-selftest.mjs` 需 `<hostToken>` 实参（活体探针，跑它会往队列写→可能推手机）→ **不在 P01 范围，登记为未覆盖项**（判据=单元测试，活体链路已被 P03 提问覆盖）
- **结果：PASS**
- **证据文件**：`tmp\shots\p0x\p01-selftest.txt`（含附加 selftest）、`tmp\shots\p0x\p01-selftest-harnessnode-guard.txt`


## P02 状态显示（生产 web profile，P0）——语义修正：只读不点

- **前置**（缺任一 = BLOCKED 上报）：**0.2.1 已装进 web profile**（`& <DshCli> --profile web --dump-config` 含 `id: push-host` 且 node_modules 里 version=0.2.1）+ 生产 web 已带插件重启（Lead 的活）+ Lead 已发「开跑」并给新 token 已入 web.log。**前提：P07 必须先 PASS**（0.2.1 未过开机零写入闸前，P02/P03 不跑）
- **语义修正（登记报告）**：任务描述写「重复点击=幂等 no-op」，但 f8326ce 实现是**双向 toggle**——timed 态按钮是「停用（回到 legacy）」，再点就是真写入（会改生产 patch）。「重复点击 no-op」在此 UI 下**结构性成立**（timed 态不存在第二个「启用」钮）；QA 在生产**一次都不点**，busy-disabled 断言挪到 P03（切换中…连点被忽略）
- **步骤与断言**：
  1. `Get-FileHash ~\.dsh\profiles\web\cordis.patch.yml -Algorithm SHA256` → **H0**；`Get-ChildItem …cordis.patch.yml.bak-*` → **B0**
  2. 从 `~\.dsh\web.log` 现取 token（最后一条），Edge headless **9224** 开 `http://127.0.0.1:3080/?token=<tok>`
  3. CDP 点 `BUTTON.wCInkW_trigger` → 设置模态出现 → 进「通用设置」区
  4. 断言：文本「手机作答模式」行存在 + 状态文案=timed 原文（见 §0 读死文案）+ 按钮文案=「停用（回到 legacy）」（=timed 态结构证据）→ 截图 `p02-settings.png`
  5. **不点按钮**；关模态
  6. 断言：**H1==H0** 且 **B1==B0**（QA 全程没写生产）
- **证据**：`p02-settings.png` + `p02-hash.txt`（H0/H1/B0/B1 原文）
- **失败语义**：行不出现/状态文案错/按钮文案错=FAIL(P0)；哈希或备份清单变了=FAIL(P0)（QA 侧越界）

## P05 失败路径：home 层覆盖（scratch，翻转前跑；P1）

- **前置**：scratch 已建已装已起（见 P03 前置，P05 在 P03 翻转动作**之前**执行）；home 层不存在已确认
- **步骤与断言**：
  1. 备份动作：记录 `~\.dsh\cordis.patch.yml` **不存在**（Test-Path False 原文存证）
  2. 写 home 层（.NET UTF-8 无 BOM）：
     ```yaml
     # qa-p05 temp home-layer override (QA, delete after test)
     - id: tool-ask-user
       name: '@deepseek-ai/dsh-tool-ask-user'
       config:
         mode: legacy
     ```
  3. 记 qa-p03 patch 哈希 **H2** + 备份清单 **B2**
  4. Edge headless **9225** 开 scratch 实例设置页 → 「手机作答模式」行显示 legacy 文案 → 点「启用（切到 timed）」→ 等 UI 反馈（宿主 edit 抛 overridden → volatile askUserStatus 回写 → 行内红字）→ 断言：
     - 报错行含 **`overridden by a home patch`** 且含「请先移除 home 层」提示（完整文案见 §0 读死）→ 截图 `p05-error.png`
     - qa-p03 patch **H3==H2**、**B3==B2**（没写坏没半途备份）
     - 实例进程存活（launcher pid 还在）
  5. **撤覆盖（红线）**：`Remove-Item ~\.dsh\cordis.patch.yml` → Test-Path False 存证
- **证据**：`p05-error.png`、`p05-hash.txt`、home 层前后 Test-Path 原文
- **失败语义**：无报错文案=FAIL(P1)；patch 被写坏=FAIL(P0)；测完 home 层还在=红线违规（P06 复查）

## P03 legacy→timed 一键翻转（scratch 第二实例，热生效；P0）

- **前置/建 scratch**：
  1. 建 profile（web-app bundle，developer 手递）：`Copy-Item ~\.dsh\profiles\web ~\.dsh\profiles\qa-p03 -Recurse`（先断言目标不存在）；然后从 qa-p03\cordis.patch.yml **删掉 install-user 的 timed 块**（marker 行 `# dsh-push-host install: timed mode` 起 7 行，.NET IO）→ 制造 legacy 基线
  2. 基线：`& <DshCli> --profile qa-p03 --dump-config` **无** `mode: timed` → 存 `p03-dump-before.txt`；记 patch 哈希 **H4**
  3. 装插件（姿势钉死）：`& <DshCli> plugin --profile qa-p03 add link:F:\work\work_dsh\dsh-push\host-plugin`（`plugin` 在 `--profile` 前；link:=**0.2.1** 现码，装完断言 `qa-p03\node_modules\dsh-push-host\package.json` version=0.2.1）
  4. 起第二实例：端口 3099 先查空闲（`Get-NetTCPConnection -LocalPort 3099` 无监听）；launcher cmd 内容 `"D:\programs\dsh\resources\runtime\cli\bin\dsh.cmd" --profile qa-p03 --no-open --host 127.0.0.1 --port 3099`，`Start-Process cmd.exe -ArgumentList '/c','<launcher>.cmd' -WindowStyle Hidden`，stdout/err 重定向 `F:\work\work_dsh\tmp\p0x\scratch-web.log`
  5. 就绪：轮询 scratch-web.log 出 token 行（最后一条）+ `Invoke-WebRequest http://127.0.0.1:3099/` 非 5xx；记实例 pid（`Get-CimInstance Win32_Process` CommandLine like `%qa-p03%`）
- **步骤与断言**（全程**不重启该实例**，pid 前后一致）：
  1. Edge headless **9225** 开 `http://127.0.0.1:3099/?token=<scratch tok>` → 设置→通用 → 「手机作答模式」行显示 **legacy 文案** + 按钮「启用（切到 timed）」→ 截图 `p03-legacy.png`
  2. 点「启用（切到 timed）」→ **立刻连点第二下**（断言 busy 态按钮 disabled/「切换中…」，双写不发生）→ 等成功反馈 → 截图 `p03-after.png`
  3. 断言四件套：
     - `~\.dsh\profiles\qa-p03\cordis.patch.yml` 出现 `mode: timed`（tool-ask-user 块）
     - `cordis.patch.yml.bak-<ts>` 新增（比 B3 多且命名带时间戳）
     - `& <DshCli> --profile qa-p03 --dump-config` 出现 `mode: timed` → 存 `p03-dump-after.txt`
     - **热生效**：该实例网页点「新会话」→ **会话命名 qa-p03** → 发 prompt「请用 ask_user_question 工具问我一个二选一问题（不要自己回答）」→ 轮询 scratch-web.log 正则 `question call_\S+ .* timed=true`（≤120s）→ 截图提问卡 `p03-question.png`；**预期手机收到 1 条「DSH 等你选择 [qa-p03]」推送 + 1 条静默回声**（凭据文件层生效，见 §0）；收尾=网页上点一个选项作答（会话继续 + 手机通知被回声/作答撤掉）
  4. 实例 pid 不变（无需重启宿主的直接证据）
- **证据**：3 张截图 + dump 前后 + 备份清单 + scratch-web.log 摘录（token 行/timed=true 行）+ pid 前后
- **失败语义**：patch 没写/无备份/dump 无 timed=FAIL(P0)；timed=true 行等不到=FAIL(P0)；提问卡出不来但前三条全过=FAIL(P1)；busy 连点产生 2 个备份=FAIL(P1)

## P04 老会话代际文案（P2）

- **步骤**：P03 之后设置页「手机作答模式」行仍在 → CDP 取该行全文 → 断言含 §0 读死的代际文案原文（「切换即时热生效、无需重启宿主；新会话立即生效，已开老会话保持旧行为（工具变体钉在会话创建时）。切换前自动备份 cordis.patch.yml。」）→ 截图 `p04-copy.png`
- **只验文案存在，不验老会话行为**（平台事实，Lead 已拍板）
- **失败语义**：文案缺失=FAIL(P2)（不挡发布，登记）

## P06 复位与清理（红线项）

- **步骤与断言**：
  1. 停第二实例：`taskkill /T /F /PID <launcher pid>` → 断言 3099 无监听 + `Win32_Process` 无 `%qa-p03%` 进程
  2. 删 scratch profile：断言路径就是 `~\.dsh\profiles\qa-p03`（拼错路径不删）→ `Remove-Item -Recurse` → Test-Path False
  3. **生产 web profile patch 哈希 == H0**（P02 只读语义 + 全程没误写生产）
  4. home 层 `~\.dsh\cordis.patch.yml` 不存在（P05 撤销复查）
  5. Edge headless 进程清零（`Get-Process msedge` 无带 `--remote-debugging-port=922` 的）；`tmp\p0x\edge-profile*` 删除
  6. 提取树清理注意：`tmp\p0x\hp-*\node_modules` 是 **Junction**——先 `cmd /c rmdir <junction路径>`（只删链接不删目标），再删 hp-* 目录；直接 `Remove-Item -Recurse` 会掏空 repo 的 host-plugin\node_modules
- **证据**：`p06-final.txt`（哈希对照 + 进程清单 + 目录清单原文）
- **失败语义**：生产哈希变了=FAIL(P0)（QA 写坏生产）；其余残留=收尾不合格，补撤后复跑本项

## P07 开机零写入回归（最高优先，P0；0.2.1 进生产前的 QA 闸）

> 0.2.0 事故根因=期望态默认 legacy + 开机即 sync + 缺「永不降级」闸：宿主以「期望未设置」启动、
> 实际为 timed 时，开机把生产从 timed 反向降级成 legacy 并真写盘。82 条 selftest 全绿没拦住这条。

- **主环境=vm1 用户服务（用户 2026-10-14 拍板的标准验证环境，`verify/vm1-dshnet-check.sh`，d3e9543）**——跑在用户自己的 dsh-net.sh 实例上（DSH_HOME=`~/.dsh`、profile=web、代理 3080→3081 自带，设置页可用 isLoopback 改写直接验 UI；与生产同版 0.2.0-rc.2）：
  1. 打包 0.2.1：等 developer 提交后 `npm pack`（或 Lead 给 tgz）→ `scp` 到 `user@<tailnet-vm1>:/tmp/`
  2. 跑：`ssh user@<tailnet-vm1> 'export PATH=$HOME/.local/bin:$PATH; bash /tmp/vm1-dshnet-check.sh check /tmp/<tarball>'`
     （脚本自带：存 `<patch>.baseline-check` → 种 timed 的 tool-ask-user 块（=P07 场景「期望未设置+实际 timed」）→ 装被测 tgz → 记 H1/BAK1 → `dsh-net.sh restart` → 等 `dsh-push-host` 行 + 6s 沉降 → 复查）
  3. **四态判定（脚本 exit code 为准）**：`0=PASS`＝**四条同时满足**：patch 哈希不变 + 备份数不变 + web.log 无「手机作答模式」行 + patch 无 `- id: push-host` 条目（第 3 缺陷 askUserStatus 落盘被这条一并堵死）；`3=WRITE DETECTED`（P0 级，0.2.1 不放行）；`4=BLOCKED`（web.log 无 `dsh-push-host`=插件根本没加载，**不算 PASS**——假 PASS 教训已制度化进脚本）；`2=环境错误`
  4. **boot 有效性闸复核**：PASS 时 ssh 拉 web.log 摘录（含 `dsh-push-host` 装载行 + 无切换行）存证，防脚本改坏
  5. **cleanup 红线（动的是用户的 profile，跑完必须做）**：`ssh user@<tailnet-vm1> 'export PATH=$HOME/.local/bin:$PATH; bash /tmp/vm1-dshnet-check.sh cleanup'` → 断言输出四行：`hash stable after 20s = yes`、`plugin installed = no`、`push-host entries = 0`、patch sha256 记录存证（baseline-check 逐字节还原+种子块移除+check 窗口 .bak 清理）
  6. **PATH 前置（vm1 通用红线）**：vm1 上任何 dsh 相关命令前先 `export PATH=$HOME/.local/bin:$PATH`——`/usr/bin/node` 缺 `stripTypeScriptTypes` 会 `ERR_NO_TYPESCRIPT` 把服务搞挂（Lead 实际踩过；脚本已内置守卫，手工步骤也要带）
  7. **顺带红利**：check 输出带 `web UI http://<tailnet-vm1>:3080/?token=…`——设置页 UI 断言（P02/P04 同款文案）可先在 vm1 验一遍再等生产，生产 P02 仍按原定义跑
- **备用环境=`verify/vm1-qa-env.sh`（完全隔离 DSH_HOME=~/dsh-qa，不碰用户 `~/.dsh` 时才用）**：三态 PASS(0)/WRITE DETECTED(3)/BLOCKED(4) 描述保留；用法 `ssh user@<tailnet-vm1> 'export PATH=$HOME/.local/bin:$PATH; bash /tmp/vm1-qa-env.sh /tmp/<tarball> qa020 timed'`；boot 有效性闸在脚本 5b
- **附加断言（第 3 个缺陷）**：主环境已由脚本 `push_host_entries==0` 覆盖（比 grep askUserStatus 更强：整个 push-host 条目都不许出现）；备用环境补 `grep -c 'askUserStatus' …/cordis.patch.yml == 0`
- **辅环境=scratch 真实例（vm1 整体不可用时兜底）**：qa-p03 配成 timed 态（P03 翻转后原样）→ 杀实例 → 以「期望未设置」重启（重启前删 patch 里 push-host 条目的 `askUserMode` 键，模拟未表态）→ 起实例 → 断言 patch 哈希不变、无新 .bak、日志无「手机作答模式：」切换行
- **证据**：check 输出全文（含 VERDICT 块 + RESULT 表）存 `p07-vm1.txt` + web.log 装载行摘录 + cleanup 输出存 `p07-cleanup.txt`
- **失败语义**：WRITE DETECTED=FAIL(P0)（0.2.1 不得进生产）；BLOCKED=修环境重跑（不许拿"没写入"当 PASS）；**check 后没跑 cleanup=红线违规**（用户 profile 带种子块过夜）

### P07 实际（2026-10-14 17:4x，vm1 用户服务，脚本 6b40ae9 版）

- 前置 status：服务 0.2.0-rc.2 运行中、patch=基线 `4a449604…`（138 行）、plugin not installed、无锁、无 baseline——干净起跑
- `check /tmp/dsh-push-host-0.2.1.tgz`（45964B，与 2c971ec 逐字节一致，Lead 手递）→ **exit 0 = PASS**：
  - 装包 `version=0.2.1 client.js=yes`；种 timed 块后 H1=`45717dc5…`
  - 重启后 **H2==H1**（逐字节不变）、备份 **0/0**、切换行 **0**（只判本次重启窗口）、push-host 条目 **0**、`mode: timed`=1 / `mode: legacy`=0（**没降级**）
  - **正向加载标记=2 行**（boot 有效性闸过；包名出现不算加载——6b40ae9 修复）；dangling bundle errors=0
- **cleanup 立即执行** → exit 0：`hash stable after 20s = yes`、patch 还原=**`4a449604…`==基线** ✓、`plugin installed = no`、`push-host entries = 0`、package.json 同步还原（依赖+bundle 条目都清，6b40ae9 修复生效）
- **结果：PASS**（放行闸过，0.2.1 可以进生产）
- **证据文件**：`tmp\shots\p0x\p07-vm1.txt`、`tmp\shots\p0x\p07-cleanup.txt`


## P0 事故记录（0.2.0，2026-10-14）

- **时间线**：16:11 备份+换装 0.2.0（patch 哈希 `D8F12BC0…`）→ 16:12 重启（端口持有者 5452→28772）→ 启动日志 `[dsh-push-host] 手机作答模式：timed → legacy，已备份 …bak-1791965527486` → 哈希变 `12A0B552…`、文件尾多出 `- id: tool-ask-user / mode: legacy` → 16:13–16:14 **二次降级**：只回滚磁盘不够，仍在跑的 0.2.0 进程把外部还原当"待纠正状态"又写两遍（.bak 三连：16:12:07/16:13:22/16:14:37）→ 止损四步：证据留档（插件自己的 .bak）、patch 还原 `D8F12BC0…`、插件回滚 0.2.0→0.1.1、再重启清进程内 legacy 态。详见 HANDOVER.md 3.6 节（Lead 维护）
- **影响面**：生产问答被降级成 legacy（手机收不到提问推送）；客户端 UI 当时已挂上（设置行可见）；生产 patch 被写入两次降级
- **为什么 82/81/53 都没拦住（用例盲区）**：selftest 全部覆盖的是「编辑路径」（点按钮→写盘→备份→回滚）与纯函数逻辑；**没有任何一条模拟"开机冷启动且期望态未设置"**——期望态默认值 legacy 在 boot 即 sync 的路径上直接等于「把实际 timed 纠正成 legacy」，缺「永不降级」闸时这条路径 100% 触发、0 条用例覆盖
- **P07 如何补上**：真实例（vm1 隔离环境）以「期望未设置 + 实际 timed」启动，断言=**逐字节哈希不变 + 无新备份 + 无切换日志行**（写路径整条不许动），外加 boot 有效性闸防假 PASS、askUserStatus 不落盘断言堵第 3 缺陷。P07 不过，P02/P03 不跑、0.2.1 不进生产
- **教训登记**：活体自愈写会把外部修复当待纠正状态反复覆盖（同进程同一目标最多成功写一次）；「跑了没量到」的假 PASS 必须有 boot 有效性闸兜底

---

## 执行段待办（Lead「开跑」后）

1. ~~从 client.js 读死 id/文案~~ ✅ 已回填（f8326ce，本文档 §0 五行读死文案）
2. 按 **P07**→P01→P02→(建 scratch)→P05→P03→P04→P06 顺序跑，每项当场落证据；P07=WRITE DETECTED 时停在 P01 之后上报，P02/P03 不跑
3. 终版报告=本文件补「实际/结果/证据」三行制 + 结论块 + **BLOCKED/未覆盖项显式列出 + 设备复位声明**（TEAM-START §5 交接纪律；HANDOVER.md 索引由 Lead 维护，QA 不改）
