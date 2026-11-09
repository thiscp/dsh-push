# companion-app 变更

## MODIFIED Requirements

### Requirement: 一键作答
用户在 App 中选择选项后，App SHALL 向 answer-relay 提交答案并得到结果反馈；对单问题且 2-3 个选项的提问通知，通知栏 SHALL 直接提供选项动作按钮（上限 3 个），点击即提交、无需打开 App；超出编排能力的选项、多问题与自由输入仍经快答界面完成。

#### Scenario: 作答成功
- **WHEN** 用户点选某选项且 nonce 有效
- **THEN** 答案送达 DSH Web，任务继续执行，App 显示"已提交"

#### Scenario: nonce 已失效
- **WHEN** 提交时 nonce 已被消费或过期
- **THEN** App 提示失效并给出浏览器兜底链接，不重复提交

#### Scenario: 通知直答
- **WHEN** 用户在通知栏（含锁屏横幅）点击提问通知上的选项按钮
- **THEN** 答案直接提交、该通知消失并提示"已答"，任务立即继续，全程无需解锁或打开 App

#### Scenario: 直答边界
- **WHEN** 问题超过 3 个选项、存在多个问题，或用户需要自由输入
- **THEN** 通知仅提供"肥鱼快答"入口，作答经快答界面完成

#### Scenario: 直答时已过期
- **WHEN** 点击选项按钮时该问题的 nonce 已被消费或过期
- **THEN** 提示已过期并清除该通知，不重复提交
