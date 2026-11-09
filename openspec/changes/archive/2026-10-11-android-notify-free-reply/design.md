# Design: android-notify-free-reply

## RemoteInput 要点（平台 API，零依赖）

- `RemoteInput.Builder("reply").setLabel("自由作答").setChoices(arrayOf(前3选项)).setAllowFreeInput(true).build()`
- 挂在"肥鱼快答" action 的 `Notification.Action.Builder` 上（第 5 参 remoteInputs 数组）；其 PendingIntent **必须 FLAG_MUTABLE**（SystemUI 要把结果写进 intent），与现有 IMMUTABLE 的 activity PendingIntent 分开。
- 取结果：`RemoteInput.getResultsFromIntent(intent)?.getCharSequence("reply")`。
- choices chips 点选 = 直接以该 chip 为结果提交（selected 语义仍走 custom 字段——服务端把 custom 当自由文本，选项标签也是合法文本，无需区分）。

## 提交与降级（AnswerReceiver）

```
onReceive:
  reply = RemoteInput.getResultsFromIntent(i)?.getCharSequence("reply")
  if (i.hasExtra("replySlot")) {          // 来自快答按钮的回复广播
      if (reply.isNullOrBlank()) { 拉起 QuickAnswerActivity(NEW_TASK, callId); return }
      qid = i.getStringExtra("qid")       // 来自 #qid trailer；无则 "q0"
      submit(callId, qid, custom = reply) // {id:qid, selected:[], custom:reply}
      ok → nm.cancel(nid) + markAnswered(reply) + toast "已答：reply…"
      404/410 → cancel + markAnswered(__expired) + toast 过期
      else → toast 没递出去
  } else { 原有 label 直答逻辑不动 }
```

## 名额账（不变）

reply 挂在既有"肥鱼快答"位上，不新增 action：2-3 选项直答编排、3 选项满编、常驻通知全部不受影响。

## #qid trailer（钩子，两端）

`if tid and reg_qs: body += "\n#qid %s" % (qs[0].get("id") or "q0")`——放在 #web 之前。App 用 MULTILINE 正则 `\n#qid (\S+)$` 解析；提问通知没有 #qid 时（旧 hook）自由作答降级提交到 "q0"（服务端按注册的问题 id 校验，单问题场景 q0 常见；失败走"没递出去"toast，不崩）。

## 降级矩阵

| vivo SystemUI 行为 | 结果 |
|---|---|
| 弹输入框（AOSP 预期） | 一次提交，超越 ntfy 官方 App |
| 不弹框、直接发广播 | results=null → 拉起 QuickAnswerActivity，等同 v1.10.0 行为 |
| 不渲染该 action | 无变化 |
