# Spec Delta

## ADDED Requirements

### Requirement: 小清新视觉主题
App 界面 SHALL 采用浅蓝小清新主题：页面底色近白带蓝、消息以白色圆角卡片呈现、文字深浅两级、强调色统一为 DSH 蓝，主界面 SHALL 以鲸鱼娘插画为背景且不影响文字可读性。

#### Scenario: 主界面渲染
- **WHEN** 用户打开 App 主界面
- **THEN** 背景显示鲸鱼娘插画（顶部对齐裁切），消息列表为白色圆角卡片浮于其上，标题/正文/时间戳三级可读，无纯黑纯红硬色

#### Scenario: 快答界面同风格
- **WHEN** 用户从通知或列表进入快答界面
- **THEN** 界面使用同一配色体系与鲸鱼娘头图，选项按钮为浅蓝卡片、按下态加深，提交成功有薄荷色反馈

### Requirement: 形象与文案
App SHALL 使用 DeepSeek 鲸鱼娘 Q 版形象作为视觉主体，并在空状态、快答、提交反馈处使用"鱼片/鲸鱼娘"人设文案。

#### Scenario: 空状态
- **WHEN** 消息列表为空
- **THEN** 居中显示睡觉鲸鱼娘插画与文案"鱼片，暂时没有消息"

#### Scenario: 通知大图标区分事件
- **WHEN** 弹出"任务结束"或"等你选择"通知
- **THEN** 大图标分别为成功表情与"请"表情立绘，与事件类型对应

### Requirement: 差异化通知提示音
"任务结束"与"等你选择"两类通知 SHALL 使用不同的内置合成提示音（轻快琶音 vs 稍急促三连音），通过新建通知渠道挂载（旧渠道删除），不依赖系统默认音。

#### Scenario: 任务结束音
- **WHEN** 收到轮次结束通知
- **THEN** 播放轻快上行琶音（渠道 dsh2）

#### Scenario: 等你选择音
- **WHEN** 收到提问待答通知
- **THEN** 播放稍急促三连音（渠道 dsh_urgent2），且横幅为 HIGH 优先级

#### Scenario: 前台服务通知静音
- **WHEN** 前台服务常驻通知存在
- **THEN** 不播放声音、不弹横幅

### Requirement: 鲸鱼剪影通知图标与主题化启动图标
通知小图标 SHALL 为透明底单色鲸鱼剪影（alpha 掩码 VectorDrawable）；启动器图标 SHALL 为鲸鱼娘 Q 版自适应图标（前景立绘、浅蓝背景），并提供各密度 legacy 位图。

#### Scenario: 通知栏小图标
- **WHEN** 任意通知出现在状态栏/通知栏
- **THEN** 小图标为鲸鱼剪影且随系统着色，不出现白方块或裁切

#### Scenario: 桌面图标
- **WHEN** 安装 v1.5 后查看桌面
- **THEN** 图标为鲸鱼娘 Q 版（自适应圆形/圆角遮罩下完整居中）

### Requirement: 素材署名
App SHALL 在主界面底部展示素材署名行（立绘 © yunxi · BSD-3 · 形象源自 DeepSeek 鲸鱼娘二创），仓库 SHALL 随附素材的 LICENSE 与 NOTICE。

#### Scenario: 署名可见
- **WHEN** 用户打开主界面
- **THEN** 底部以小字号显示署名行

#### Scenario: 授权文件在库
- **WHEN** 查看 `android-app/assets-src/`
- **THEN** 存在 LICENSE（BSD-3）与 NOTICE（来源说明）
