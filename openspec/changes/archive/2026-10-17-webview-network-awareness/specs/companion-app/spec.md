# companion-app — 变更规格（webview-network-awareness）

## ADDED Requirements

### Requirement: 内置浏览器断网感知与自动恢复

App 内置浏览器 SHALL 感知设备网络状态：断网时 SHALL 在 ≤2 秒内向页面顶部注入固定横幅
「网络已断开，正在等待恢复…」，横幅 SHALL NOT 拦截任何页面点击（`pointer-events:none`）；
网络恢复时 SHALL 移除横幅，且若页面处于断开态 SHALL 自动重载当前地址（URL 与 token 不变），
全程无需用户手点。主文档加载失败 SHALL 按 1s/2s/4s…封顶 30s 的退避自动重试，成功后清零；
用户手点重试 SHALL 取消自动排期（降级为兜底，不与自动重试双重加载）。

#### Scenario: 断网两秒内出横幅

- **WHEN** 页面正常渲染时设备断网（飞行模式开）
- **THEN** ≤2s 页面顶部出现文案精确的横幅，fixed 顶部、`pointer-events:none`，页面其余部分照常可交互

#### Scenario: 恢复网络页面自动回来且零手点

- **WHEN** 断网后页面处于断开态，随后网络恢复（飞行模式关）
- **THEN** 横幅自动移除，App 自动重载当前 URL+token，页面恢复可用；整个过程不需要任何用户点击

#### Scenario: 冷启动即离线走退避重试

- **WHEN** 断网状态下启动 App 打开 DSH 地址（落在 chrome-error 页）
- **THEN** App 按 1s/2s/4s…封顶 30s 退避自动重试；网络恢复后页面在退避窗口内自动回来，错误页不被误判为"加载成功"

#### Scenario: 横幅在场不抢命中区

- **WHEN** 横幅在场时用户点击其覆盖区域内的任意按钮（含头部按钮行）
- **THEN** 点击命中按钮本身而非横幅（视觉中心 elementFromPoint 与真实输入双证）

#### Scenario: 手点重试与自动重试不叠加

- **WHEN** 自动退避排期在飞时用户手点了页面的重试入口
- **THEN** App 取消自动排期并清零计数，只发生一次加载
