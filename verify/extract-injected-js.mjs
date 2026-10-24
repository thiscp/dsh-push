// 从 WebActivity.kt 里抽出**所有** evaluateJavascript 注入段，逐个做语法闸。
// 按**标记**定边界，不按行号：每个 evaluateJavascript( 开始，遇到带 , null) 的行结束。
// 用法：
//   node verify/extract-injected-js.mjs                 打印第 1 段到 stdout（老行为）
//   node verify/extract-injected-js.mjs --out <文件>     第 1 段写到文件
//   node verify/extract-injected-js.mjs --all <前缀>     每段写到 <前缀>.N.js，并逐段 new Function 语法校验
// 退出码：0 全部通过 / 1 有段语法错 / 2 找不到段
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'android-app', 'app', 'src', 'main', 'java', 'xyz', 'cpyh', 'dshpush', 'WebActivity.kt');
const argv = process.argv.slice(2);
const outAt = argv.indexOf('--out');
const allAt = argv.indexOf('--all');
const src = fs.readFileSync(SRC, 'utf8').split('\n');

// Kotlin 字符串字面量解转义：\" -> " ，\\ -> \ （顺序不能反）
function unkotlin(s) {
  return s.split('\\"').join(String.fromCharCode(34)).split('\\\\').join(String.fromCharCode(92));
}

// 收集每一段：start/end 是 1-based 行号，js 是拼好的注入代码
const blocks = [];
for (let i = 0; i < src.length; i++) {
  if (src[i].indexOf('evaluateJavascript(') < 0) continue;
  let start = i + 1;
  let end = -1;
  for (let k = start; k < src.length; k++) { if (src[k].indexOf(', null)') >= 0) { end = k; break; } }
  if (end < 0) { console.error('段 L' + (start + 1) + ' 找不到 , null) 终点'); process.exit(2); }
  const parts = [];
  const missed = [];
  for (let k = start; k <= end; k++) {
    const t = src[k].trim();
    if (t === '' || t.startsWith('//')) continue;
    const m = t.match(/^"((?:[^"\\]|\\.)*)"\s*[+,;]?[^"']*$/);
    if (!m) { if (k < end) missed.push('L' + (k + 1) + ': ' + t.slice(0, 80)); continue; }
    parts.push(unkotlin(m[1]));
  }
  blocks.push({ line: start + 1, endLine: end + 1, js: parts.join(''), lines: parts.length, missed });
  i = end;
}
if (!blocks.length) { console.error('找不到 evaluateJavascript( 起点'); process.exit(2); }

// 语法闸：new Function 编译但不执行（等价于 node --check，且能一次跑完所有段）
// 单行调用式（bannerJs(true) / __dshDiagSet(...) 这种把整段 JS 交给辅助函数的）收进 0 行，
// 不是内联注入段，跳过不报，避免每次跑都刷两条噪音。
let bad = 0;
let n2 = 0;
for (let n = 0; n < blocks.length; n++) {
  const b = blocks[n];
  if (!b.lines) continue;
  n2++;
  let err = '';
  try { new Function(b.js); } catch (e) { err = String(e && e.message); bad++; }
  console.error('段 ' + n2 + ' L' + b.line + '-' + b.endLine + '  收进 ' + b.lines + ' 行  漏收 ' + b.missed.length +
    '  JS ' + b.js.length + ' 字节  ' + (err ? 'SYNTAX_FAIL: ' + err : 'SYNTAX_OK'));
  b.missed.slice(0, 5).forEach((x) => console.error('   漏 ' + x));
}
console.error('共 ' + n2 + ' 段内联注入 JS，语法错 ' + bad + ' 段');
if (allAt >= 0 && argv[allAt + 1]) {
  for (let n = 0; n < blocks.length; n++) fs.writeFileSync(argv[allAt + 1] + '.' + (n + 1) + '.js', blocks[n].js);
} else if (outAt >= 0 && argv[outAt + 1]) {
  fs.writeFileSync(argv[outAt + 1], blocks[0].js);
} else if (allAt < 0 && outAt < 0) {
  process.stdout.write(blocks[0].js);
}
process.exit(bad ? 1 : 0);
