# 提案：通知栏直接作答（v1.9.0「不解锁作答」）

## Why

提问通知目前只有一个"肥鱼快答"按钮，答一道选择题要：点亮→展开通知→点按钮→等加载→点选项——锁屏上完不成，得解锁打开 App。而"收到问题→选一个选项"是这个软件最高频的核心动作。Android 通知 action 按钮在锁屏和横幅上直接可点：把问题的选项直接做成通知按钮，**不解锁、不打开 App，一次点击就答完**，DSH 立刻继续跑。

## What Changes

- **钩子脚本载荷扩展**：`dsh-ntfy-push.py`（Windows + 工作机两台都要）在单问题消息体尾部追加机器可读行 `#opts <qid>=<标签>|<标签>|…`；多问题不追加（走快答页）
- **App 通知按钮**：PushService 解析 `#opts`——单问题 2-3 选项时，通知 action 直接放选项按钮（AOSP 上限 3 个；选项 ≤2 时第三个位置保留"肥鱼快答"兜底，选项 =3 时三个全是选项，快答走通知本体点击进入主页）
- **直答接收器**：新增 `AnswerReceiver`（未导出），goAsync 后台 POST `/answer/submit`；成功→撤销该通知 + toast"已答：xxx"；失效(4xx)→撤销 + toast"问题已过期"
- 通知本体点击行为不变（进主页）；多问题/超 3 选项/自由输入仍走快答页

## Impact

- 受影响的 capability：`companion-app`（MODIFIED 一键作答）
- 受影响的文件：`PushService.kt`、新增 `AnswerReceiver.kt`、`AndroidManifest.xml`（receiver 注册）；两台主机的 `dsh-ntfy-push.py`
- 服务端（ntfy/answer-relay/桥接）零改动；版本 1.9.0 / versionCode 23
