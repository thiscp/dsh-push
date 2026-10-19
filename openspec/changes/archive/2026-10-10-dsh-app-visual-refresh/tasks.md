# Tasks

## 1. 素材与资源加工（测试VM1）

- [x] 1.1 `assets-src/` 素材入库（已下载），确认 LICENSE/NOTICE 随仓库
- [x] 1.2 vm1 `pip install pillow`（阿里云镜像），脚本生成：自适应图标前景 432×432（`pet-02-happy` LANCZOS 居中贴透明画布）+ legacy mipmap 48/72/96/144/192（mdpi→xxxhdpi）
- [x] 1.3 Python 标准库合成 `res/raw/notify_done.wav` 与 `notify_question.wav`（design §3 规格），拷到 Windows 用 read_image 之外的方式试听（ffprobe 时长/峰值校验）
- [x] 1.4 手绘鲸鱼剪影 `ic_stat_whale.xml`（24dp VectorDrawable，纯 alpha）

## 2. 代码改造（v1.5 / versionCode 6）

- [x] 2.1 `colors.xml`/`strings.xml` 重写为 design §1 配色与 §5 文案
- [x] 2.2 PushService：新渠道 `dsh2`/`dsh_urgent2`（声音+着色），删旧渠道；通知加 `setLargeIcon`（成功/"请"表情）；前台服务通知静音挂 `dsh2`；`APP_VER="1.5"`
- [x] 2.3 MainActivity：背景 ImageView（CENTER_CROP 顶对齐）、顶栏头像+副题、消息卡片化（白圆角+描边）、空状态插画+文案、底部署名行、状态行配色
- [x] 2.4 QuickAnswerActivity：同风格背景/卡片、"请"表情头图、标题"帮鱼片拿个主意？"、提交成功薄荷反馈
- [x] 2.5 manifest/图标接线：`ic_launcher` 自适应（前景立绘+背景 `#E2EEFF`），通知小图标 `ic_stat_whale`

## 3. 构建与分发

- [x] 3.1 vm1 gradle assembleDebug（Clash 7897 探测，无新依赖应秒过）
- [x] 3.2 APK 推 aliyun `/var/www/certbot/dl/dsh-push.apk`，nginx 校验，分享 `?v=15` 链接

## 4. 真机验收（对照 spec 场景）

- [x] 4.1 主界面：壁纸+卡片+三级文字可读；空状态插画文案
- [x] 4.2 快答界面：头图+卡片选项+薄荷反馈；提交成功
- [x] 4.3 通知：小图标剪影不着白块；大图标两类表情；**两种提示音可区分**；横幅优先级
- [x] 4.4 桌面图标完整居中；署名行可见；状态行显示 (v1.5)
- [x] 4.5 旧行为回归：WS 连接、10 条留存、实时刷新、快答提交全部不回归

## 5. 收尾

- [x] 5.1 VERIFICATION.md 增补本轮验收记录
- [x] 5.2 提交推送（vm1 → Windows → Gitee），openspec 归档
