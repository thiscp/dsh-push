# Proposal: android-explicit-read

## Why

已读语义此前是"打开 App 看到列表 1.2 秒后全部自动已读"——用户还没来得及逐条处理，未读标记就全没了，等于没有未读。用户 2026-10-11 午间要求：任务结束推送与主界面卡片都加「已读」按钮，**只有点击已读按钮或打开 DSH 按钮才转已读**。

## What Changes

- 废除自动已读（1.2s 定时器与 markAllRead 退役）
- 消息记录新增 `mid` 主键（= 通知 nid，所有消息都存；老消息按 ts 兜底匹配）
- 四个显式已读入口：
  1. 任务结束通知「已读」按钮（新增动作）→ 标已读 + 撤本通知
  2. 通知「打开 DSH」→ WebActivity 打开即标已读；v1.18.1 起同时撤本通知（按钮不带 setAutoCancel，须显式 cancel）
  3. 主界面卡片「已读」按钮（仅未读时渲染）
  4. 卡片「DSH 网页」按钮 → 打开网页同时标已读
- 提问通知不加已读按钮（动作位被作答选项占满，且作答即已读语义）；常驻服务通知的网页入口不带消息 extras，零副作用
- 版本 1.18.0（versionCode 42）+ 1.18.1（43，补按钮撤通知）

## Impact

- 修改：`PushService`（markRead/mid/readAction/webAction extras）、`AnswerReceiver`（act=read 分支）、`WebActivity`（markMsgRead）、`MainActivity`（删自动已读、卡片已读按钮）
- 已读淡化规格（android-read-fade）不受影响，仅"自动转已读"的触发方式变化
