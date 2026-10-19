// 从 WebActivity.kt 里抽出**第一段注入 JS**（bwFind / bwGeomFix / bwPanelBg 那一段）。
// 按**标记**定边界，不按行号：第一段 evaluateJavascript( 开始，遇到带 , null) 的行结束。
// 用法：node verify/extract-injected-js.mjs [--out <文件>]   （不给 --out 就打到 stdout）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'android-app', 'app', 'src', 'main', 'java', 'xyz', 'cpyh', 'dshpush', 'WebActivity.kt');
const argv = process.argv.slice(2);
const outAt = argv.indexOf('--out');
const src = fs.readFileSync(SRC, 'utf8').split('\n');
let start = -1;
for (let i = 0; i < src.length; i++) { if (src[i].indexOf('evaluateJavascript(') >= 0) { start = i + 1; break; } }
if (start < 0) { console.error('找不到 evaluateJavascript( 起点'); process.exit(2); }
let end = -1;
for (let i = start; i < src.length; i++) { if (src[i].indexOf(', null)') >= 0) { end = i; break; } }
if (end < 0) { console.error('找不到 , null) 终点'); process.exit(2); }
const parts = [];
const missed = [];
for (let i = start; i <= end; i++) {
  const t = src[i].trim();
  if (t === '' || t.startsWith('//')) continue;
  const m = t.match(/^"((?:[^"\\]|\\.)*)"\s*[+,;]?[^"']*$/);
  if (!m) { if (i < end) missed.push('L' + (i + 1) + ': ' + t.slice(0, 80)); continue; }
  let s = m[1];
  s = s.split('\\"').join(String.fromCharCode(34));
  s = s.split('\\\\').join(String.fromCharCode(92));
  parts.push(s);
}
const js = parts.join('');
if (outAt >= 0 && argv[outAt + 1]) { fs.writeFileSync(argv[outAt + 1], js); }
console.error('段 L' + (start + 1) + '-' + (end + 1) + '  收进 ' + parts.length + ' 行  漏收 ' + missed.length + '  JS ' + js.length + ' 字节');
missed.slice(0, 5).forEach((x) => console.error('   漏 ' + x));
if (outAt < 0) process.stdout.write(js);
