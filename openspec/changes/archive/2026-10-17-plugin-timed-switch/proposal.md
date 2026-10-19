# Proposal: plugin-timed-switch

## Why
把 `tool-ask-user` 配成 `mode: timed` 目前只能靠手改 YAML（install-user.ps1 / 手写 patch），普通用户不知道也改不动；而 timed 是手机作答（late-answer 回灌）的唯一生效路径。产品需要一个"手机作答模式"开关：在 DSH Web 设置页一键切换，热生效、无需重启宿主，且改前自动备份。

## What Changes
- `dsh-push-host` 新增浏览器半（`lib/client.js`，`window.__ModuleLoader__.load` 手写模块 + `package.json` 声明 `dsh.client{platform:"web"}` 与 `exports "./client"`）：在设置页 General 槽（`settings.general.item`）注册「手机作答模式」设置行——显示**实际**状态、一键启用、显示上次切换失败原因（含 home-override 报错文案）。
- 写入通道：settings RPC 只能写 volatile 字段，而 `tool-ask-user` 的 `mode/timeout` 不是 volatile。故 push-host 自己的 Config 新增 volatile 字段：`askUserMode`（期望态 `legacy|timed`，**无默认值**，客户端写它）与 `askUserStatus`/`askUserActual`（宿主回写的失败原因/实际态镜像，**纯内存不落盘**）。
- 宿主侧（`lib/index.js`）新增 `AskUserModeSwitch`：订阅 `loader/volatile-update`（仅 owning fiber 收到）比对期望态与真实态（判据 = `ctx.tools.get("ask_user_question")` 的 parameters 是否含 `timeout`，同 dsh-user-questions 的 `isTimedAskUserQuestionSchema`）；不一致才动手——先按 dsh-app-boot 惯例备份 patch 文件（`<patchPath>.bak-<ms>`，撞名加序号），再 `ctx.configEditor.edit(tool-ask-user entry, …)` 热改（非 volatile 写只热重启该插件 fiber，timed 工具当场重注册，无需重启宿主）；`tools/change` 监听补激活顺序坑；幂等（一致时零写入）。
- **0.2.1 P0 热修**（生产事故：0.2.0 开机把生产 timed 反向降级成 legacy 并落盘，回滚后活进程又降级两次）：
  1. **永不降级**——只有显式 `timed` 会写；未表态（字段缺失=schemastery optional，无 `.optional()` 方法可加）或 `legacy` 完全惰性；`configEditor.edit` 前最后一道闸断言 `desired === 'timed'`。
  2. **每进程最多一次成功写**（`done` 标志）——外部修复（还原文件→reconcile）不被活进程当成漂移反复覆盖。
  3. **HMR 事务外排队**——volatile-update 在 settings RPC 的 HMR 事务内触发，事务内嵌套 `configEditor.edit` 抛 `HMR transactions cannot be nested`；所有 sync 经 `setTimeout(0)` 延后合并。
  4. **状态回写不落盘**——`askUserStatus`/`askUserActual` 经 `Symbol.for('cosmokit.volatile.write')` 写内存 ref（settings describe 读 live ref，Web 行可见），禁止 configEditor 落盘状态字符串。
  5. **展示读实际态**——设置行显示 `askUserActual` 镜像（宿主用 tools.get 判定），不拿期望态当展示值。
- 生效范围是平台事实，文案照抄：新会话立即生效，已开老会话保持旧行为（工具变体钉在会话创建时）。开关只升不降，回 legacy 手动改 patch。
- 版本：`host-plugin/package.json` 0.1.1 → 0.2.0 → **0.2.1**（0.2.0 为坏版本勿用；android-app 版本三处同步本轮不适用）。

## Impact
- Affected specs: `dsh-host-plugin`（ADDED：手机作答模式开关）
- Affected code: `host-plugin/lib/index.js`（Config 三个 volatile 字段 + AskUserModeSwitch + inject 追加）、`host-plugin/lib/client.js`（新增）、`host-plugin/package.json`（dsh.client + exports ./client + 版本）
- 不影响：伴生 App（companion-app 既有需求不动）、relay 协议、凭据文件、既有推送/回灌路径；宿主缺 `configEditor`/`tools` 服务时开关整体惰性（apply 不报错）。
