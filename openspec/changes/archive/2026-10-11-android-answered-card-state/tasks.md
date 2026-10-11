# Tasks: android-answered-card-state

- [x] 1. `PushService.markAnswered()`：按 callId 回写 msgs `answered` 并通知 listeners
- [x] 2. 三处回写：AnswerReceiver（ok=标签 / 404·410=__expired）、QuickAnswerActivity（成功=答案摘要 / 取题失败=__expired）
- [x] 3. MainActivity 已答态渲染：徽章（已答：xxx / 已过期）+ 收起作答按钮 + 整卡 alpha 0.6 + 保留 DSH 网页胶囊；版本 1.9.6 / versionCode 30
- [x] 4. vm1 构建 → 部署 aliyun `?v=39` → 真机验收：通知按钮答完主界面卡片立即变已答态；快答答完显示摘要；重启后状态保持
  - 实测注：2026-10-11 用户真机验收通过（v1.9.6，验收题即测试题——答完该卡片当场显示"已答：已答态正常"并压暗，重开不丢）。线上 v1.9.6 / ?v=39。
- [x] 5. 验收后归档、同步 Gitee/vm1
