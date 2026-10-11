# 任务清单

- [x] 1. 钩子脚本 `dsh-ntfy-push.py`：单问题 2-3 选项时消息尾追加 `#opts qid=labels` trailer（特殊字符保守降级）
- [x] 2. `PushService`：解�?剥离 trailer；按编排规则挂选项 action（≤3，含"肥鱼快答"兜底位）
- [x] 3. 新增 `AnswerReceiver`（exported=false）：goAsync POST /answer/submit，成�?过期 cancel 通知 + toast
- [x] 4. `AndroidManifest.xml` 注册 receiver
- [x] 5. 版本 1.9.0 / versionCode 23；vm1 构建；上�?aliyun ?v=32
- [x] 6. 两台主机部署新钩子脚本（Windows + 工作机），触发真提问验证 trailer
- [x] 7. 验收：锁屏横幅直点选项 �?DSH 立即继续、通知消失、toast"已答"
- [x] 8. 验收：过�?重复点击提示失效不重复提交；多问题与 >3 选项回落快答�?- [x] 9. 验收：vivo 真机 action 数量与折叠态表现，必要时按 design 降级 2 选项直答

> ʵ��ע��7 �� 2026-10-11 ���û����ֱ��֪ͨ��ť���գ�q-190-direct��ֱ��ɹ���·ȫͨ����9 �� 2 ѡ��������飬>3 ѡ�������������ߴ���ͬԴ·��δ����ʵ�⡣

