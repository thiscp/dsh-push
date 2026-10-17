## ADDED Requirements

### Requirement: 手机作答模式开关
插件 SHALL 在设置页 General 槽注册「手机作答模式」行，仅在插件已装载时出现。Config SHALL 新增
volatile 字段 `askUserMode`（期望态，无默认=未表态）、`askUserStatus`、`askUserActual`；设置行
展示 SHALL 读实际态（判据：工具定义是否声明 `timeout`），MUST NOT 拿期望态当展示值；状态与
镜像 SHALL 只写内存、MUST NOT 经 configEditor 落盘。宿主 SHALL 仅在期望显式 `timed` 且实际非
timed 时切换：先备份 patch、再经 `configEditor.edit` 热改 `tool-ask-user`，edit 前 SHALL 断言
期望为 `timed`（永不降级）；未表态或 `legacy` SHALL 零写入；同进程 SHALL 至多成功写一次；
触发 SHALL 延后到 HMR 事务外。缺 `configEditor`/`tools` 的宿主 SHALL 惰性。文案 SHALL 声明
新会话立即生效、已开老会话保持旧行为。

#### Scenario: 设置行随插件装载出现

- **WHEN** 插件装入 profile 且用户在 DSH Web 打开设置页 General 区
- **THEN** 出现「手机作答模式」行，显示实际态（已开启/未开启）与启用按钮；已是 timed 时按钮
  禁用（本开关不降级）；插件未装载时该行不出现

#### Scenario: 一键启用热生效

- **WHEN** 用户点「启用」且 `tool-ask-user` 当前为 legacy
- **THEN** patch 文件先被备份为 `<patchPath>.bak-<毫秒时间戳>`（撞名追加序号），`tool-ask-user` 的
  config 被改写为 `mode: timed, timeout: 120`，timed 工具当场重注册（仅该插件 fiber 热重启，宿主
  不重启），新会话的提问即走 timed 推送手机

#### Scenario: 未表态与 legacy 期望永不降级

- **WHEN** 期望态未表态（字段缺失）或显式为 `legacy`，而实际为 timed（生产 P0 场景）
- **THEN** 不备份、不写 patch 文件、不产生任何 config 编辑；`configEditor.edit` 前的断言
  保证任何路径都写不出 `mode: legacy`

#### Scenario: 每进程最多一次成功写

- **WHEN** 切换成功后外部把 patch 文件还原（reconcile / tools/change 再次触发 sync）
- **THEN** 活进程不再执行第二次 edit（`done` 守卫），不把用户的修复当成待纠正状态反复覆盖

#### Scenario: 触发延后到 HMR 事务外

- **WHEN** volatile-update 在 settings RPC 的 HMR 事务内到达
- **THEN** sync 经宏任务排队到事务边界外合并执行，不抛 `HMR transactions cannot be nested`，
  且最终只写一次

#### Scenario: 状态回写不落盘

- **WHEN** 切换失败（如 home 层覆盖抛 "overridden by a home patch"）或宿主回写实际态镜像
- **THEN** 原因/镜像只写内存 volatile ref（settings describe 读 live ref 供设置行显示），
  用户 `cordis.patch.yml` 的哈希不变、不新增 `- id: push-host` 条目

#### Scenario: 触发覆盖三条路径

- **WHEN** 期望态经 settings RPC 变化（`loader/volatile-update`，仅 owning fiber 收到）、
  `ask_user_question` 晚于插件注册（`tools/change`）、或插件装载时首次判定
- **THEN** 三条路径都会触发一次判定；工具尚未注册时切换推迟，注册后照常完成

#### Scenario: 无 configEditor 的宿主惰性退化

- **WHEN** 宿主不提供 `configEditor` 或 `tools` 服务
- **THEN** 开关不挂载不报错，推送/回灌等其余功能照常，宿主启动不受影响
