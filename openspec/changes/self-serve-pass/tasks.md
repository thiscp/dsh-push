# 任务（未开工）

- [ ] 1. 中继：确认 `dsh-provd` 的实现语言（先探测机器上有什么运行时：python3 / go / 现有 backend 容器），选最省内存的
- [ ] 2. 中继：写 `dsh-provd`（argv 调 `docker exec ntfy ntfy …`；secret 鉴权；body 上限；`--memory=64m`；restart 策略）
- [ ] 3. 中继：`edge` nginx 加 `location /provision/` 反代到 127.0.0.1:2587，`nginx -t` 后 reload（不重启机器）
- [ ] 4. 中继冒烟：用 `qa-prov-*` 名字跑 发号 → 列表 → 用返回的只读 token 订阅 topic 成功 → 吊销 → 再订阅应 403
- [ ] 5. 插件 v0.3.0：配置项 + 三个服务端能力 + 网页面板（发号 / 复制通行证 / 列表 / 吊销）+ 写回自身配置
- [ ] 6. 插件 selftest 扩到覆盖发号 URL 构造、通行证文本拼装、配置写回（现有 104/104 基线不回退）
- [ ] 7. App v1.33.0/103：通行证解析（`dshpush://v1` 与裸 `tk_` 两条路）、topic 持久化、订阅地址派生、状态卡片显示 topic
- [ ] 8. App 验收：模拟器上粘新通行证 ⇒ 连到 `dsh-<name>` 并收到该 topic 的推送；粘老通行证 ⇒ 仍连 `dsh`（回归）
- [ ] 9. 发版：插件 tgz + 两端 profile 钉版（0.3.0）；App 走 `verify/release.ps1`（核对 `update-notify` 与线上包大小两条）
- [ ] 10. 文档：HANDOVER、openspec 归档、公开仓同步、skill 补「发号服务」硬事实
