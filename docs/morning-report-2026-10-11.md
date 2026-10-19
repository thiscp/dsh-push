# 晨报 · 2026-10-11（夜间自主优化批次）

> 你睡觉期间（约 02:00–07:00）Lead 带 team 自主干活，未提问。一夜上线 **6 个版本**（v1.10.0→v1.15.0，现线上 v1.15.0 / versionCode 39）+ 服务端 relay 升级 + 两端 hook 升级。调研 P0 全部做完，P1/P2 留给你拍板。

## 一、装哪个

**https://ntfy.cpyh.xyz/dl/dsh-push.apk?v=47** （v1.15.0，2,157,840 字节，覆盖安装，token/主题/消息全保留）

## 二、今晚做了什么（按版本）

| 版本 | 内容 | 对应立项 |
|---|---|---|
| v1.10.0 | 消息列表管理（未读圆点+计数、打开 1.2s 自动标已读、清空消息按钮、历史 10→30 条）；新主题两套（星空·银河入梦 / 焦糖·焦糖布丁，共 6 套）；星空主题也有星点闪烁；**FGS 类型 dataSync→specialUse**（Android 14+ 的 6 小时超时会被掐，这是到达率隐患，调研实锤） | android-msg-list-management / android-theme-pack-2 |
| v1.11.0 | **通知内自由文本直答**（RemoteInput）：点"肥鱼快答"直接弹系统输入框，前 3 个选项做成可点 chips，一次提交完成——上游 ntfy 官方 App 至今没这功能；系统不弹框时自动降级打开快答界面，零回归；hook 两端加 `#qid` trailer | android-notify-free-reply |
| v1.12.0 | 内置网页窗口三件套：深色主题下网页自动深色渲染（不再白屏刺眼）、连不上时人设错误页（睡觉鲸鱼+重试按钮）、断网恢复自动重载 | android-webview-polish |
| v1.13.0 | **作答回声**：在网页/浏览器上作答后，relay 发静默 `#ans` 消息 → 手机通知自动消失、卡片入已答态（以前只有从手机作答才回销）；aliyun relay 已改+重启+通路验证 | android-answer-echo |
| v1.14.0 | **保活体检**对话框：通知权限/电池白名单实时 ✓✘ 检测；自启动、后台高耗电、睡眠待机优化（夜间断网元凶）、最近任务锁四项 vivo 直达跳转（跳不过自动落应用详情页，永不崩）；按钮行拆两行 | android-keepalive-checkup |
| v1.15.0 | **蹦床修正**：自由直答的回复 PendingIntent 从广播改为 activity 直达快答界面——Android 14+ 禁止"通知→广播→拉活动"蹦床（你的手机是 Android 16，旧写法在 vivo 不弹输入框时会点了没反应）；弹框时结果随 intent 直交提交，不弹框走正常快答流程 | android-notify-free-reply |

服务端/钩子：aliyun answer-relay 加作答回声（备份 `answer-relay.py.bak-echo-20261011-062628`，凭据 `/etc/answer-relay/ntfytok`）；Windows + 工作机 hook 加 `#qid`（模拟推送已验证）。

## 三、醒来验收清单（按重要度）

1. **升级**：浏览器开 `?v=47` 链接装 v1.15.0；图标没变就强制停止再打开一次（vivo 图标缓存老毛病）
2. **自由直答（今晚最大新功能）**：随便让 DSH 提个问 → 通知上点"肥鱼快答"→ **应弹系统输入框**（带选项 chips）→ 输入提交 → 通知消失、卡片入已答态。若 vivo 不弹输入框：会直接打开快答界面（=旧行为，也算通过，但告诉我一声）
3. **网页作答回销**：提问时改在通知的"DSH 网页"或浏览器页作答 → 提交后手机那条提问通知应自动消失、卡片显示已答
4. **保活体检**：主界面第二行"保活体检"→ 两项自动检测状态与实际相符；四个"去设置"逐个点——跳到对应 vivo 页算满分，落到应用详情页也及格（哪个跳歪了报我组件名）
5. **主题**：换"星空·银河入梦"（应有星点闪烁+紫夜色鲸鱼）和"焦糖·焦糖布丁"（暖色）各逛一遍所有界面
6. **消息管理**：来两条新推送看未读圆点+顶部计数 → 打开 App 稍等圆点消失；点"清空消息"确认清空
7. **网页窗口**：深夜/星空主题下开"DSH 网页"→ 页面应深色；把工作机 DSH 停掉再开 → 鲸鱼错误页 → 恢复后自动/点重试加载
8. **FGS 修复**（无感）：用一天后监听仍活着即可（以前 Android 14+ 理论上 6 小时会被掐）

## 四、调研留下的建议（docs/research-2026-10-11.md，未动手）

- **P1 会话化**：提问通知做成 MessagingStyle 会话进系统置顶会话区（与 RemoteInput 天然组合）；vivo 横幅渲染需真机验证
- **P1 channel 细分**：Android 15/16 通知冷却会压连发声——提问/任务结束已分 channel，若实测连发被压再拆细
- **P2 Material You 取色**：values-v31 别名指 `@android:color/system_accent1_*`，2 小时试点；OriginOS 是否跟随壁纸待实测（可能和 6 套人设主题打架）
- **P2 下拉刷新**：建议做在 DSH Web 前端，不引 App 依赖
- **P2 X-Delay 延时追发**：提问 10 分钟未答自动追发，服务端已有定时能力，边际收益小
- 已否决/观望：bubbles（OriginOS 存疑）、UnifiedPush/FCM（无 GMS 不适用）、黑科技保活（Android 14+ 已死）

## 五、回滚点

- 每个版本独立 git 提交（vm1 + Gitee 双仓）；线上想回 v1.9.8：`F:\work\work_dsh\dsh-push-v198.apk` 重传即可
- relay：`cp -a /usr/local/bin/answer-relay.py.bak-echo-20261011-062628 /usr/local/bin/answer-relay.py && systemctl restart answer-relay`
- 5 个 openspec change 全部**未归档**，等你验收后 Lead 再归档

## 六、team 分工记录

msg-list（消息管理/自由直答/保活体检）、themes（星空焦糖两套主题）、webview（网页窗口三件套）、research（六方向调研+P0/P1/P2 优先级表）、Lead（立项/集成/构建/部署/提交/拍板）。所有 teammate 改动 Lead 已逐段审查后构建。
