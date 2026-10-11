# push-relay-server Specification

## Purpose
定义阿里云上自建 ntfy 推送服务的外部可观察行为：HTTPS 可达性、写入鉴权、重启自愈。

## Requirements

### Requirement: HTTPS 可达
ntfy 服务 SHALL 通过 `https://ntfy.cpyh.xyz` 提供 API 与 WebSocket，证书由 certbot 自动续期。

#### Scenario: 健康检查
- **WHEN** 执行 `curl https://ntfy.cpyh.xyz/healthserver`
- **THEN** 返回 200，且响应经边缘 nginx SNI 分流到达 ntfy

#### Scenario: 证书续期
- **WHEN** certbot 续期周期到达
- **THEN** `ntfy.cpyh.xyz` 证书被自动续期，无需人工干预

### Requirement: 写入需鉴权
未携带有效凭据的发布请求 SHALL 被拒绝；凭据 SHALL 按最小权限签发——服务器发布方仅持有 topic `dsh` 的只写凭据，手机订阅方仅持有只读凭据，任一凭据泄露都不足以同时读和写该 topic。

#### Scenario: 匿名写入被拒
- **WHEN** 不带 token 向 topic `dsh` POST
- **THEN** 返回 401/403，消息不入库

#### Scenario: token 写入成功
- **WHEN** 携带有效 write-only access token 向 topic `dsh` POST
- **THEN** 返回 200，订阅者收到消息

#### Scenario: 只写凭据读不了
- **WHEN** 用 write-only token 订阅或轮询 topic `dsh`
- **THEN** 返回 403/404，读不到任何消息内容

#### Scenario: 只读凭据写不进
- **WHEN** 用 read-only token 向 topic `dsh` POST
- **THEN** 返回 403，消息不入库

### Requirement: 重启自愈
aliyun-relay 重启后推送服务 SHALL 自动恢复。

#### Scenario: 机器重启
- **WHEN** aliyun-relay 重启完成
- **THEN** ntfy 容器自动运行（restart 策略），HTTPS 推送在无人工操作下恢复

#### Scenario: 内存受约束
- **WHEN** 容器内存使用达到 limit
- **THEN** 仅 ntfy 容器受限，不影响同机 DERP/nginx 等其他服务
