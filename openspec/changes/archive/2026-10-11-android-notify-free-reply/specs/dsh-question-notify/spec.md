# dsh-question-notify delta

## ADDED Requirements

### Requirement: 提问推送携带首问 id
提问推送发布时，钩子 SHALL 追加 `\n#qid <首问id>` 机器行（多问题时为第一个问题的 id），使 App 在不拉取问题 JSON 的情况下也能把通知内自由文本答案提交到正确问题。

#### Scenario: 单问题
- **WHEN** 单问题提问推送发出
- **THEN** `#qid` 行含该问题 id，与 `#opts` 中的 qid 一致

#### Scenario: 多问题
- **WHEN** 多问题提问推送发出（无 `#opts`）
- **THEN** `#qid` 行含第一个问题的 id，通知自由直答默认答给首问
