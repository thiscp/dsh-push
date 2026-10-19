// fix-openspec-strict-2.mjs -- second pass.
// Pass 1 left two companion-app requirements over the 500-char bar:
//   网页直达按钮 (508) and 内置浏览器提问卡窄屏防塌陷 (580).
// This pass shortens ONLY those two prose paragraphs and moves the detail into
// NEW scenarios (existing scenarios are never touched).
import fs from 'node:fs';

const REQ = /^### Requirement:\s*(.+)$/;
const SCEN = /^####\s/;

function replaceProse(file, reqName, newProse, newScenarios = []) {
  const raw = fs.readFileSync(file, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);
  const starts = [];
  lines.forEach((l, i) => { const m = l.match(REQ); if (m) starts.push({ i, name: m[1].trim() }); });
  const idx = starts.findIndex(s => s.name === reqName);
  if (idx < 0) throw new Error(`requirement not found: ${reqName}`);
  const s = starts[idx];
  const end = (starts[idx + 1] ? starts[idx + 1].i : lines.length);
  let scen = end;
  for (let i = s.i + 1; i < end; i++) { if (SCEN.test(lines[i])) { scen = i; break; } }

  const out = [...lines.slice(0, s.i + 1), ...newProse.split('\n')];
  if (newScenarios.length) {
    out.push('');
    for (const sc of newScenarios) { out.push(...sc.split('\n')); out.push(''); }
    out.pop();
  }
  out.push('');
  out.push(...lines.slice(scen));
  fs.writeFileSync(file, out.join(eol), 'utf8');
  const len = newProse.split('\n').join('\n').trim().length;
  console.log(`  prose replaced (${len} chars): ${reqName}`);
  newScenarios.forEach(sc => console.log(`    + scenario: ${sc.split('\n')[0].replace('#### Scenario: ', '')}`));
}

const CA = 'openspec/specs/companion-app/spec.md';

// (1) 508 -> under 500: drop the sub-details that existing scenarios already cover
// (窗口复用 covers reuse, 深色页面适配 covers dark rendering, 标题标识实例 covers naming).
replaceProse(CA, '网页直达按钮',
  'App SHALL 解析推送中的 `\\n#web <url>` 机器行（从正文剥离不展示）并把最近一次 URL 持久化；常驻服务通知 SHALL 在已存有 URL 时提供"打开 DSH"按钮，事件通知 SHALL 在 action 名额有空位时（任务结束、或提问无 2 个及以上直答选项按钮）追加同一按钮，主界面每条消息卡片 SHALL 自带"DSH 网页"胶囊、打开该条消息自身携带的链接（无链接的条目不显示），常驻通知按钮 SHALL 随新消息携带的新 URL 自动更新。全部网页直达入口 SHALL 落入 App 内置的**单实例网页窗口**（WebView，跟随所选主题），窗口已存在时 SHALL 复用它并加载新链接，MUST 不叠加新窗口；加载失败 SHALL 显示带重试的人设错误页，网络恢复时 SHALL 自动重试。标题栏 SHALL 显示「DSH 网页 · <实例名>」并随链接加载与窗口复用换新链接同步刷新；最近任务卡片标签 SHALL 同样携带实例名。');

// (2) 580 -> under 500: move the three patch rules into scenarios.
replaceProse(CA, '内置浏览器提问卡窄屏防塌陷',
  '应用内浏览器（WebActivity）加载 DSH Web 后 SHALL 注入一段幂等的窄屏补丁样式（按元素 id 查重，重复注入 SHALL 不产生第二个节点；事件监听 SHALL 另有独立标记，重复注入 MUST NOT 重复挂载），全部规则 SHALL 限定在视口 ≤1023px（与 DSH Web 自身的侧栏自动收起断点 `SIDEBAR_AUTO_COLLAPSE = 1024` 一致），使 ≥1024px 的桌面布局与未修补版本一致。窄屏下补丁 SHALL 让提问卡可读、让会话侧栏以浮层呈现且不挤压内容列；注入 SHALL 不影响玻璃化注入、UA 策略、上传下载与错误页等既有行为。',
  [
    '#### Scenario: 提问卡头部换行与文字占满整行\n\n- **WHEN** 窄屏下提问卡的右侧动作组（等待倒计时、等待按钮、最小化/关闭图标）在一行放不下\n- **THEN** 提问卡头部允许换行（`flex-wrap:wrap`）使动作组落到下一行，提问卡文字块占满整行（`flex:1 1 100%` 且 `min-width:0`）',
    '#### Scenario: 窄屏侧栏不占用网格列\n\n- **WHEN** 窄屏下会话侧栏存在\n- **THEN** 侧栏不占用网格列去挤压内容列（中心列恒为「视口宽 − 56px 图标轨道」），展开态以浮层呈现（`position:fixed`、宽 280px、自身可纵向滚动、置于内容之上），关闭态回到 56px 图标轨道且只显示图标、不残留被裁的会话标题文字',
  ]);

console.log('== re-measure (companion-app) ==');
const lines = fs.readFileSync(CA, 'utf8').split(/\r?\n/);
const starts = [];
lines.forEach((l, i) => { const m = l.match(REQ); if (m) starts.push({ i, name: m[1].trim() }); });
let bad = 0;
starts.forEach((s, k) => {
  const end = (starts[k + 1] ? starts[k + 1].i : lines.length);
  let scen = end;
  for (let i = s.i + 1; i < end; i++) { if (SCEN.test(lines[i])) { scen = i; break; } }
  const len = lines.slice(s.i + 1, scen).join('\n').trim().length;
  if (len > 500) { bad++; console.log(`  OVER [${k}] ${len}  ${s.name}`); }
});
console.log(bad === 0 ? '  all companion-app requirement prose <= 500 chars' : `  ${bad} still over`);
