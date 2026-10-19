# Proposal

## Why

dsh-push 伴侣 App v1.4 功能已验收（推送、快答、保活、实时刷新全部正常），但界面是纯程序化视图：白底黑字、无主题、无形象、通知用系统默认音，与"每天看好几次的小工具"定位不符。用户明确要求优化：**小清新风格、DSH 相关（蓝色大肥鱼/鲸鱼娘娘化）、背景、音乐（通知提示音）**。

网上调研已锁定素材与依据：

- 形象：DeepSeek 社区二创"鲸鱼娘"（蓝色渐变长发、呆毛、蝴蝶结、鲸尾、深蓝白裙女仆，管用户叫"鱼片"）。现成 Q 版立绘取自 GitHub 仓库 `yunxiiQwQ/dsh-maid-whale-UI`（**BSD 3-Clause**，20 张 238×260 透明底表情 + 海洋插画壁纸，已下载到 `android-app/assets-src/`）
- 配色：小清新浅蓝系（鸭蛋蓝 #AECED0 / 婴儿蓝 #E2EEFF / 薄荷 #DDFFFC 一族），白底大留白
- 通知小图标必须是透明底单色剪影（Android alpha 掩码规则），彩色立绘只做启动图标、通知大图标与应用内插画
- 提示音：Android 渠道 `setSound(android.resource://…/raw/…)`，mp3/wav 均可；渠道声音创建后不可变，换声必须换新渠道 id

## What Changes

- **视觉主题**：全套小清新浅蓝配色（colors.xml + 卡片化消息列表 + 鲸鱼娘壁纸背景），主界面/快答界面同风格；空状态用睡觉鲸鱼娘 +"鱼片，暂时没有消息"文案梗
- **形象落点**：主界面背景壁纸（群鲸环绕立绘）、空状态插画、快答界面"请"表情头图、通知大图标（任务结束=成功表情 / 等你选择=大眼睛"请"表情）、启动器图标（Q 版立绘自适应图标）、通知小图标（手绘鲸鱼剪影 VectorDrawable）
- **通知提示音**：Python 合成两段小清新提示音放 `res/raw/`——任务结束=轻快上行琶音，等你选择=稍急促三连音；**新建渠道 id（dsh2 / dsh_urgent2）**挂声音与主题色（旧渠道声音改不动）
- **署名**：主界面底部一行素材署名（yunxi / BSD-3 / 鲸鱼娘二创链），LICENSE+NOTICE 随仓库
- 版本 1.5（versionCode 6），APK 走 `https://ntfy.cpyh.xyz/dl/dsh-push.apk` 分发不变

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `companion-app`: 新增 5 条视觉/声音/图标/署名需求（不改任何既有行为需求）

## Impact

- **android-app/**：colors/strings 重写，MainActivity/QuickAnswerActivity/PushService 样式与渠道改动，新增 `res/raw/` 两段 wav、`res/drawable/` 剪影与插画、`res/mipmap*/` 启动图标
- **APK 体积**：+约 400KB（插画 + 提示音），可忽略
- **服务端零改动**：ntfy / answer-relay / 钩子脚本都不动
- **测试VM1**：需 pillow（pip 阿里云镜像）做图标缩放；无新增 Gradle 依赖
