# dsh-host-integration 变更

## ADDED Requirements

### Requirement: 主机钩子链路生效条件
一台 DSH Web 主机接入推送时，钩子 SHALL 实际触发推送脚本，且生效条件 SHALL 全部可验证：桥插件经 profile patch 以 insert 语义挂载（configPath 指向 hooks.json）；无会话上下文的钩子命令按部署默认沙箱执行，Windows 服务实例 SHALL 将部署默认置为 danger-full-access（受限令牌子进程在 session 0 必死）；以 workspace-write 兜底时 temp 根 SHALL 位于 workspace 之外。

#### Scenario: 未挂载即静默
- **WHEN** hooks.json 存在但 profile patch 未以 insert 挂载桥插件
- **THEN** 会话事件流无任何 hook/invoked 事件，推送不发生

#### Scenario: Windows 服务下命令被执行
- **WHEN** Windows 服务实例的钩子触发
- **THEN** 推送脚本以非受限方式实际运行（无 0xC0000142），ntfy 收到消息

#### Scenario: 沙箱兜底可用
- **WHEN** 部署默认回退为 workspace-write 且会话 cwd 缺失
- **THEN** 服务进程 temp 已固定于家目录之外，ACL runner 不因 temp-in-workspace 拒跑

### Requirement: 配置生效验证
主机接入的每次配置变更 SHALL 以运行实例为准验证：重启 SHALL 以端口持有权 PID 变更为完成判据（status 探针 RUNNING 单独不作为判据）；配置内容 SHALL 以 dump-config 输出中目标条目的行内容为准核对，退出码不作为挂载成功判据。

#### Scenario: 假重启被识别
- **WHEN** stop 阶段杀不掉持端口进程导致进程未更换
- **THEN** 重启流程识别端口持有者未变，强制终止真凶并重新拉起

#### Scenario: 挂载行内容核对
- **WHEN** 验证钩子插件与沙箱策略是否进入运行配置
- **THEN** dump-config 输出含对应 id 条目且字段值与 patch 一致
