#!/bin/sh
# 列出一台远端机器上「当前有效的 DSH Web token」候选，按可信度从高到低，一行一个：<token>|<来源文件>
# 为什么不能只看 ~/.dsh/web.log：2026-11-19 实测 VM1 的 web.log 最后写入 10:18，而 DSH 进程 10:21
# 被 market-restart 流程重启、stdout 改投 /tmp/dsh-market-restart-*.out.log ⇒ web.log 里那条 token 已过期，
# 真 token 只在重启日志里。运行中进程 fd/1 指向的日志才是第一真值。
# 也别用 HTTP 探测判 token 有效性：非浏览器请求带对的 token 也回 401，只有 WebView 里
# "dsh web authentication required" 这段文案能判（见 geom-matrix.mjs）。
# 用法：ssh <host> sh -s < geom-first-token.sh
LC_ALL=C
pid=$(pgrep -f 'bin.js --patch' 2>/dev/null | head -1)
[ -z "$pid" ] && pid=$(pgrep -f 'dsh/lib/bin.js' 2>/dev/null | head -1)
out=""
[ -n "$pid" ] && out=$(readlink /proc/$pid/fd/1 2>/dev/null)
seen=""
for f in "$out" $(ls -t /tmp/dsh-market-restart-*.out.log 2>/dev/null | head -3) "$HOME/.dsh/web.log" "$HOME/.dsh/logs/web.log"; do
  [ -n "$f" ] && [ -f "$f" ] || continue
  t=$(grep -h '^dsh web:' "$f" 2>/dev/null | tail -1 | sed -n 's/.*token=\([A-Za-z0-9._-]*\).*/\1/p')
  [ -n "$t" ] || continue
  case " $seen " in *" $t "*) continue ;; esac
  seen="$seen $t"
  printf '%s|%s\n' "$t" "$f"
done
