## ADDED Requirements

### Requirement: 通行证发号面板

插件 SHALL 在 DSH 网页的设置面板提供「发通行证」入口：SHALL 调用发号服务为本机签发 topic 与一对凭据，并把
返回的**手机通行证文本** `dshpush://v1?base=…&topic=…&token=…` 展示为可复制文本；SHALL 把 `topic` 与只写 token
写回插件自身配置并提示需重启生效。面板 SHALL 列出已签发的通行证且每项可吊销。发号失败 SHALL 显示可读错误且
MUST NOT 破坏现有配置或已工作的推送链路。provision secret MUST NOT 出现在 git 跟踪的文件里。

#### Scenario: 点按钮拿到通行证

- **WHEN** 用户在面板填名字并点「发通行证」
- **THEN** 出现可复制的 `dshpush://v1` 文本，含 base / topic / token 三项

#### Scenario: 写回自身配置

- **WHEN** 发号成功
- **THEN** 插件配置的 `topic` 与只写 token 被更新，面板提示重启后生效

#### Scenario: 列表与吊销

- **WHEN** 用户打开面板并点某项的「吊销」
- **THEN** 服务端对应账号被删，列表刷新后不再显示该项

#### Scenario: 发号服务不可达

- **WHEN** 发号服务超时或不可达
- **THEN** 面板显示错误原因，原配置不变、原有推送继续工作
