# 设计：通知栏直接作答

## 载荷协议

钩子脚本在提问消息体末尾追加一行（仅单问题时）：

```
#opts <questionId>=<label1>|<label2>|<label3>
```

- 标签内的 `|` `=` `#` 罕见，出现则整个 trailer 省略（保守降级走快答）
- App 展示正文时剥掉 trailer 行（与现有剥 📱 链接同理）
- 多问题 → 无 trailer → 通知只有"肥鱼快答"（现状）

## 按钮编排（AOSP action 上限 3）

| 选项数 | action 1..3 |
|---|---|
| 1-2 | 各选项 + "肥鱼快答"（兜底自由输入） |
| 3 | 三个选项（快答入口=点通知本体进主页列表） |
| >3 或多问题 | 仅"肥鱼快答"（现状） |

横幅（heads-up）折叠态只显示前 2 个 action，展开后可见 3 个——2 选项问题在锁屏即可完整直答。

## 直答链路

```
点选项 action → PendingIntent.getBroadcast(AnswerReceiver,
    extras: callId, qid, label, notifId)
  → AnswerReceiver.goAsync() → OkHttp POST /answer/submit
      body {callId, answers:[{id:qid, selected:[label]}]}（与快答页同协议）
  → 2xx ok：NotificationManager.cancel(notifId) + toast "已答：label"
  → 4xx（nonce 已消费/过期）：cancel + toast "问题已过期"
  → 网络错：toast "提交失败"，通知保留可重试
```

- receiver `android:exported="false"`，进程未运行时由系统拉起（无需前台服务）
- 同一通知的其余 action 点击在 cancel 后自然消失；不同通知（不同问题）互不影响
- 提交协议与 QuickAnswerActivity.submit 完全一致 → 服务端零改动

## 钩子脚本（两台主机）

`dsh-ntfy-push.py` 在 PreToolUse(ask_user_question) 分支：解析 questions，若 `len(questions)==1` 且 `2<=len(options)<=3`，message 追加 trailer。工作机与 Windows 同步部署（Windows 侧改动遵循 dsh-self-restart 纪律，钩子脚本本身即时生效无需重启）。

## 风险

- vivo 对 action 数量的实际限制可能 <3 或样式折叠：真机验收，必要时降为 2 选项直答
- 重复点击：提交成功后通知已 cancel，无重复入口；连点两次在 cancel 竞态内 → 第二次 4xx 提示过期，无害
- 锁屏直答后手机未解锁，DSH 立即继续 → 后续"任务结束"通知照常到达（体验闭环）
