// fix-openspec-strict.mjs -- resolve every `openspec validate --all --strict`
// warning without touching requirement names or existing scenarios.
//
// Why programmatic: the paragraphs are long Chinese prose; hand-transcribing them
// into an old_string risks silent mismatches. This locates each requirement by
// index, replaces only its prose paragraph, and inserts NEW scenarios before the
// first existing one -- so every existing scenario is preserved byte-for-byte
// (the repo red line for MODIFIED requirements).
//
// openspec's own advice is "move examples and edge cases into scenarios, or split
// into separate requirements". We use the first form: splitting would rename/split
// requirements that live deltas may MODIFY by name.
import fs from 'node:fs';

const REQ = /^### Requirement:\s*(.+)$/;
const SCEN = /^####\s/;

function splitSpec(text) {
  const lines = text.split(/\r?\n/);
  const starts = [];
  lines.forEach((l, i) => { const m = l.match(REQ); if (m) starts.push({ i, name: m[1].trim() }); });
  return { lines, starts };
}

// measure the same span openspec measures: prose after the heading, up to the
// first scenario heading
function measure(file) {
  const { lines, starts } = splitSpec(fs.readFileSync(file, 'utf8'));
  return starts.map((s, k) => {
    const end = (starts[k + 1] ? starts[k + 1].i : lines.length);
    let scen = end;
    for (let i = s.i + 1; i < end; i++) { if (SCEN.test(lines[i])) { scen = i; break; } }
    const prose = lines.slice(s.i + 1, scen).join('\n').trim();
    return { name: s.name, len: prose.length };
  });
}

function replaceProse(file, reqName, newProse, newScenarios = []) {
  const raw = fs.readFileSync(file, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const { lines, starts } = splitSpec(raw);
  const idx = starts.findIndex(s => s.name === reqName);
  if (idx < 0) throw new Error(`requirement not found in ${file}: ${reqName}`);
  const s = starts[idx];
  const end = (starts[idx + 1] ? starts[idx + 1].i : lines.length);
  let scen = end;
  for (let i = s.i + 1; i < end; i++) { if (SCEN.test(lines[i])) { scen = i; break; } }

  const before = lines.slice(0, s.i + 1);
  const after = lines.slice(scen);
  const out = [...before, ...newProse.split('\n')];
  if (newScenarios.length) {
    out.push('');
    for (const sc of newScenarios) { out.push(...sc.split('\n')); out.push(''); }
    // the last pushed '' plus the block separator below keeps spacing uniform
    out.pop();
  }
  out.push('');
  out.push(...after);
  fs.writeFileSync(file, out.join(eol), 'utf8');
  console.log(`  prose replaced: ${reqName}`);
  newScenarios.forEach(sc => console.log(`    + scenario: ${sc.split('\n')[0].replace('#### Scenario: ', '')}`));
}

function replacePurpose(file, newPurpose) {
  const raw = fs.readFileSync(file, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);
  const i = lines.findIndex(l => l.trim() === '## Purpose');
  if (i < 0) throw new Error(`no Purpose in ${file}`);
  let j = i + 1;
  while (j < lines.length && lines[j].trim() === '') j++;
  if (j >= lines.length) throw new Error(`empty Purpose in ${file}`);
  lines[j] = newPurpose;
  fs.writeFileSync(file, lines.join(eol), 'utf8');
  console.log(`  purpose set (${newPurpose.length} chars): ${file}`);
}

const HP = 'openspec/specs/dsh-host-plugin/spec.md';
const CA = 'openspec/specs/companion-app/spec.md';

console.log('== dsh-host-plugin ==');
replacePurpose(HP, '定义 `dsh-push-host` 宿主插件的行为契约：挂载与生效条件、提问与轮次两类推送、前台作答权归属、手机作答回灌与作答回声、轮询可靠性，以及配置、凭据文件与包分发。');

replaceProse(HP, '包分发',
  '`dsh-push-host` SHALL 是一个可直接发布的 npm 包：元数据齐全、随包带 MIT `LICENSE`、打包清单只含运行所需文件，`main` 与 `dsh.bundle.patch` SHALL 分别指向 `lib/index.js` 与随包的 `cordis.patch.yml`。安装 SHALL 支持三种等价方式（npm 名、tarball、本地目录），三者 SHALL 都把包写入 profile 的 `dependencies` 并在 `dsh.profile.bundles` 登记同名 bundle 层。',
  [
    '#### Scenario: 包元数据与运行入口\n\n- **WHEN** 检查随包发布的 `package.json`\n- **THEN** 含 `repository`、`homepage`、`bugs`、`author`、`engines`、`publishConfig.access = public` 与 `files` 白名单（`lib`、`cordis.patch.yml`、`README.md`、`LICENSE`）；包内带 MIT `LICENSE`；`main` 指向 `lib/index.js`，`dsh.bundle.patch` 指向随包的 `cordis.patch.yml`',
    '#### Scenario: 三种安装方式等价\n\n- **WHEN** 分别从 npm 名（`dsh plugin --profile <profile> add dsh-push-host`）、tarball（`… add ./dsh-push-host-<version>.tgz`）与本地目录（`… add link:<dir>`）安装\n- **THEN** 三者都把包写入 profile 的 `dependencies`，并在 `dsh.profile.bundles` 登记同名 bundle 层',
  ]);

replaceProse(HP, '凭据文件',
  '插件 SHALL 支持从凭据文件读取通道凭据，默认位置 SHALL 为 `~/.config/dsh-push/credentials.json`，并 SHALL 可被配置项 `credentialsFile` 或环境变量 `DSH_PUSH_CREDENTIALS` 覆盖。凭据文件 SHALL 直接接受 `deploy/relay-user-add.sh` 输出的配对载荷字段名与常见别名，并 SHALL 支持多 host 形式（根字段为默认值，`hosts[host]` 覆盖）。取值优先级 SHALL 为**内置默认 < 凭据文件 < profile/overlay 配置 < 环境变量**。凭据文件不存在 SHALL 为干净 no-op（不报错、不打印抱怨、不发起网络请求，插件退化为透明监听器）；文件存在但不可读或 JSON 非法时 SHALL 记录一行含路径的日志并继续挂载。',
  [
    '#### Scenario: 字段名与别名映射\n\n- **WHEN** 凭据文件按 `relay-user-add.sh` 的字段名或常见别名写出\n- **THEN** 映射为 `relay`→relay 基址、`host`→hostId、`topic`→ntfy topic、`writeToken`→本机 ntfy 写令牌、`readToken`→手机 ntfy 读令牌、`hostToken`→relay 队列令牌；键名大小写/连字符差异与别名（`ntfyToken`/`pushToken`/`tkPub`、`phoneToken`/`tkRead`、`relayBase`/`base`、`hostId`）SHALL 同样被接受',
  ]);

replaceProse(HP, '配对载荷',
  '插件 SHALL 提供一条命令产出单个用户的配对载荷，字段与 `deploy/relay-user-add.sh` **逐字同构**：`{v, relay, host, topic, writeToken, readToken, hostToken}`（`v` SHALL 为 1，字段顺序 SHALL 一致）。载荷字段 SHALL 全部来自凭据文件（`relay` 可取插件实际使用的 relay 基址），命令 SHALL NOT 凭空生成任何令牌；当任一字段缺失时命令 SHALL 以非零退出并列出缺失字段，MUST NOT 输出半份载荷。命令 SHALL 同时提供只读自检 `verify`：逐项打印 PASS/FAIL，任一失败即非零退出，且 SHALL NOT 读取其他 host 的队列、SHALL NOT 修改 relay 状态。',
  [
    '#### Scenario: 自检的五项检查\n\n- **WHEN** 用真令牌执行 `verify`\n- **THEN** 逐项检查凭据文件可读、载荷字段齐全、`GET /answer/pending?host=<host>` 带 `X-Host-Token` 返回 200、`GET /<topic>/json?poll=1` 带读令牌返回 200、`POST /` 带写令牌返回 200',
  ]);

console.log('== companion-app ==');
replaceProse(CA, '网页直达按钮',
  'App SHALL 解析推送中的 `\\n#web <url>` 机器行（从正文剥离不展示）并把最近一次 URL 持久化；常驻服务通知 SHALL 在已存有 URL 时提供"打开 DSH"按钮，事件通知 SHALL 在 action 名额有空位时（任务结束、或提问无 2 个及以上直答选项按钮）追加同一按钮，主界面每条消息卡片 SHALL 自带"DSH 网页"胶囊、打开该条消息自身携带的链接（无链接的条目不显示），常驻通知按钮 SHALL 随新消息携带的新 URL 自动更新。全部网页直达入口 SHALL 落入 App 内置的**单实例网页窗口**（WebView，跟随所选主题）：窗口已存在时 SHALL 复用并在其中加载新链接（token 轮换亦然），MUST 不叠加新窗口；所选主题为深色时窗口 SHALL 让页面按深色渲染（框架 API 分档，不引依赖）；加载失败 SHALL 显示带重试的人设错误页，网络恢复时 SHALL 自动重试。标题栏 SHALL 显示「DSH 网页 · <实例名>」并 SHALL 随链接加载、窗口复用换新链接与页内跨主机导航同步刷新；最近任务卡片标签 SHALL 同样携带实例名。',
  [
    '#### Scenario: 实例名反查与退化\n\n- **WHEN** 网页窗口标题栏需要显示实例名\n- **THEN** 按当前链接的 `host:port` 反查实例清单（名称来自推送 `#name` 或用户改名），查不到时退化为 `host:port`',
  ]);

replaceProse(CA, '快答成功页主题立绘动画',
  '提交作答成功后的反馈 SHALL 覆盖全部三条提交路径（快答浮窗、主页消息卡片选项、通知栏直答按钮）：显示当前主题的全身立绘（与主界面 pose 映射一致）。API 28+ SHALL 播放该主题的**动画 WebP 活立绘**——Overshoot 弹跳入场后循环播放，停留约 2.6 秒后自动关闭；API<28 或解码失败 SHALL 退回静图 + 运行时属性动画（以脚底为轴小幅摇摆并轻微浮动、停留约 1.4 秒），行为与 v1.26 一致。播放 SHALL 使用系统 `ImageDecoder`/`AnimatedImageDrawable`，MUST 不引入第三方动画依赖。快答浮窗内嵌展示（底色为主题 `dshCardBg`）；主页选项与通知直答 SHALL 通过全屏透明悬浮窗展示（无背景卡片、无 dim），通知栏后台拉起被系统弹窗管控拦截时 SHALL 以 toast 兜底且不影响提交本身。取问题等待页与通知 largeIcon SHALL 保持鲸鱼团子不变。',
  [
    '#### Scenario: 活立绘素材的来源与规格\n\n- **WHEN** 任一主题的活立绘素材随包发布\n- **THEN** 素材为无缝循环的微动动画 WebP（发丝/裙摆/尾尖波动 + 呼吸起伏），由 AI 视频模型 Wan2.2 I2V-A14B 以"首尾帧同图"方式生成微动循环、再用原始立绘 alpha 遮罩恢复透明背景后内置于 `res/raw`',
  ]);

replaceProse(CA, '内置浏览器提问卡窄屏防塌陷',
  '应用内浏览器（WebActivity）加载 DSH Web 后 SHALL 注入一段幂等的窄屏补丁样式（按元素 id 查重，重复注入 SHALL 不产生第二个节点；事件监听 SHALL 另有独立标记，重复注入 MUST NOT 重复挂载），全部规则 SHALL 限定在视口 ≤1023px（与 DSH Web 自身的侧栏自动收起断点 `SIDEBAR_AUTO_COLLAPSE = 1024` 一致），使 ≥1024px 的桌面布局与未修补版本一致。补丁 SHALL 包含三条规则：①提问卡头部允许换行（`flex-wrap:wrap`），使右侧动作组（等待倒计时、等待按钮、最小化/关闭图标）在一行放不下时落到下一行；②提问卡文字块占满整行（`flex:1 1 100%` 且 `min-width:0`）；③窄屏会话侧栏不占用网格列去挤压内容列（中心列恒为「视口宽 − 56px 图标轨道」），且侧栏展开态 SHALL 以浮层形式呈现（`position:fixed`、宽 280px、自身可纵向滚动、置于内容之上），关闭态 SHALL 回到 DSH 自身的 56px 图标轨道且只显示图标、不残留被裁的会话标题文字；窄屏展开侧栏时，点击内容区（浮层之外）SHALL 触发收起。注入 SHALL 不影响玻璃化注入、UA 策略、上传下载与错误页等既有行为。',
  [
    '#### Scenario: 选择器用属性包含匹配\n\n- **WHEN** 补丁需要选取 DSH Web 的侧栏与网格列元素\n- **THEN** 使用属性包含匹配（`[class*=...]`）加 CSS-module 哈希类名兜底，MUST NOT 硬编码完整哈希类名',
    '#### Scenario: 侧栏浮层不因包含块被裁剪\n\n- **WHEN** 补丁中性化承载侧栏的网格列（`BynINW_sidebarCol` 与 `BynINW_frame`）上的包含块触发属性\n- **THEN** `backdrop-filter`/`-webkit-backdrop-filter`/`filter`/`transform`/`contain`/`will-change` 置为 none/auto、该列 `overflow:visible`，`position:fixed` 的侧栏浮层相对视口而非该 56px 列定位；且玻璃化注入 MUST NOT 再给这两个容器写 `backdrop-filter`（内联 `!important` 优先级高于补丁样式表）',
    '#### Scenario: 浮层收起判定按实际矩形\n\n- **WHEN** 用户点击内容区时判定是否收起浮层\n- **THEN** 判定依据浮层的实际矩形（点落在浮层矩形内 MUST NOT 触发收起），MUST NOT 依赖硬编码的宽度阈值',
    '#### Scenario: 展开面板背景与色相来源\n\n- **WHEN** 窄屏展开态的侧栏面板需要背景\n- **THEN** 不透明度落在 88%~92%、色相取自运行时计算的原有背景色（以随亮/暗主题协调）并带 `box-shadow` 形成层次；收起态的 56px 图标轨道 SHALL 保持玻璃化半透明底色（约 45%），桌面宽度保持原样；由于玻璃化注入以**内联** `!important` 写背景色，玻璃化那一步 MUST NOT 再设置窄屏展开面板的背景色，该背景色的读写 SHALL 由补丁自行负责（状态切换 SHALL 用监听侧栏 class 变化的观察者同步）',
  ]);

replaceProse(CA, '配对载荷导入',
  'App SHALL 支持以**一份配对载荷**完成推送通道配置，载荷 schema SHALL 与 `deploy/relay-user-add.sh` / `dsh-push-pair` 输出的对象一致（`v` 为 1）。App 侧只使用其中的 `relay`（服务器基址）、`topic`（订阅主题）、`readToken`（订阅凭据）三项。导入入口 SHALL 至少支持"粘贴 JSON 文本"，并在存在系统扫码/文件选择能力时支持"扫码"或"选文件"；导入成功后 SHALL 写回既有配置键（ntfy 基址 / topic / 读令牌），使既有的订阅、常驻通知与通知栏直达作答逻辑无需改动即可工作。载荷非法（非 JSON、`v` 不是 1、缺 `relay`/`topic`/`readToken` 任一项）时 App SHALL 拒绝导入并给出可读原因，MUST NOT 写坏既有配置。',
  [
    '#### Scenario: 载荷字段与 App 的取用范围\n\n- **WHEN** 一份载荷进入导入流程\n- **THEN** 对象为 `{v, relay, host, topic, writeToken, readToken, hostToken}`；`host` 与 `hostToken` 属主机侧、App MUST NOT 使用，`writeToken` MUST NOT 被 App 使用（只写权限，拿它也发不出通知）',
  ]);

console.log('\n== other specs: Purpose ==');
replacePurpose('openspec/specs/dsh-host-integration/spec.md',
  '定义 DSH Web 主机接入推送时"钩子链路"的外部可观察契约：桥插件的挂载语义、生效条件（沙箱档位与 temp 根位置），以及条件未满足时应表现出的静默行为。');
replacePurpose('openspec/specs/dsh-turn-notify/spec.md',
  '定义 DSH Web 侧"轮次结束触发推送"的行为契约：一轮 agent 停止时的触发时机、通知载荷与标题格式、失败隔离（推送失败不得阻塞轮次结束），以及同一轮次的去重规则。');
replacePurpose('openspec/specs/push-relay-server/spec.md',
  '定义阿里云上自建 ntfy 推送服务（`https://ntfy.cpyh.xyz`）的外部可观察行为：HTTPS 与 WebSocket 可达性、写入鉴权、边缘 nginx SNI 分流、证书自动续期，以及重启后的自愈。');

console.log('\n== re-measure ==');
let bad = 0;
for (const f of [HP, CA, 'openspec/specs/dsh-host-integration/spec.md', 'openspec/specs/dsh-turn-notify/spec.md', 'openspec/specs/push-relay-server/spec.md']) {
  const rows = measure(f);
  rows.forEach((r, i) => {
    if (r.len > 500) { bad++; console.log(`  OVER  ${f} [${i}] ${r.len}  ${r.name}`); }
  });
}
console.log(bad === 0 ? '  all requirement prose <= 500 chars' : `  ${bad} still over`);
for (const f of ['openspec/specs/dsh-host-integration/spec.md', 'openspec/specs/dsh-host-plugin/spec.md', 'openspec/specs/dsh-turn-notify/spec.md', 'openspec/specs/push-relay-server/spec.md']) {
  const t = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  const i = t.findIndex(l => l.trim() === '## Purpose');
  console.log(`  Purpose len ${t[i + 1].length}: ${f}`);
}
