# Proposal: answered-marks-read

## Why
实测（v1.27.0 截图）：用户在 DSH Web 用文字作答后，手机卡片出现"已答：…"气泡（#ans 回声生效）但左上角 ● 未读点仍在，要再点一次「已读」才消。自己亲手答过的题 obviously 已经看过，二次确认是多余动作。

## What Changes
- `markAnswered` 增加 `read` 参数（默认 true）：任何入口作答成功/过期回写已答态时**同时标已读**。
- 作答回声（#ans）路径同样标已读——覆盖"在 DSH Web / relay 网页作答"的场景。
- **唯一例外**：回声答案以 `【监督者自动唤醒】` 开头（救援模式代答）→ 保持未读，用户仍能看到"这条我错过了"。
- 显式「已读」入口对非问题类卡片（任务结束等）行为不变。

## Impact
- Affected specs: `companion-app`（MODIFIED：消息列表管理——作答即已读）
- Affected code: `PushService.kt`（markAnswered + 回声分支）、`AnswerReceiver.kt` / `QuickAnswerActivity.kt`（调用点语义不变，默认参数即得）
