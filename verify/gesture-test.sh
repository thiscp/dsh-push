#!/bin/bash
# 1.33.35 头像手势验收：点=开关凭证卡片；长按=打开且不清空；清空=卡片内按钮+确认框
# 用法：bash verify/gesture-test.sh [serial]
# 判据全部走 prefs 的 token 基线对比（绝不写死测试数据字面值 —— 见 skill 里
# 「往 prefs 里塞假 token 会后者覆盖前者」那条坑，v1.33.35 曾因此白跑 4 轮发布）。
ADB="${ADB:-G:/Android/Sdk/platform-tools/adb.exe}"
SER="${1:-emulator-5554}"
D="${TMPDIR:-/tmp}/gesture-test"
mkdir -p "$D"
AVX=166; AVY=439   # 头像中心：dump 里 clickable+long-clickable ImageView bounds [72,342][261,536]
F=0
say(){ echo "$1"; }
pass(){ say "ok   $1"; }
fail(){ say "FAIL $1"; F=1; }
ui(){ for i in 1 2 3 4 5; do MSYS_NO_PATHCONV=1 "$ADB" -s "$SER" shell uiautomator dump /sdcard/u.xml >/dev/null 2>&1; MSYS_NO_PATHCONV=1 "$ADB" -s "$SER" shell cat /sdcard/u.xml > "$D/u.xml" 2>/dev/null; [ -s "$D/u.xml" ] && grep -q "hierarchy" "$D/u.xml" && return 0; sleep 1; done; }
has(){ grep -q "$1" "$D/u.xml" && pass "$2" || fail "$2"; }
nhas(){ grep -q "$1" "$D/u.xml" && fail "$2" || pass "$2"; }
tok(){ MSYS_NO_PATHCONV=1 "$ADB" -s "$SER" exec-out "run-as xyz.cpyh.dshpush cat /data/data/xyz.cpyh.dshpush/shared_prefs/dshpush.xml" 2>/dev/null; }
curtok(){ tok | grep -o 'name="token">tk_[^<]*' | head -1; }

"$ADB" -s "$SER" shell am force-stop xyz.cpyh.dshpush
# 基线：记录此刻真实 token，后续断言「未被改动」而不是比对某个字面值
BASE=$(curtok)
[ -n "$BASE" ] || { echo "FAIL 基线里没有 token（先手工配一张通行证再跑）"; exit 1; }
say "base: $BASE"
"$ADB" -s "$SER" shell am start -n xyz.cpyh.dshpush/.MainActivity >/dev/null
sleep 3

# 1) 初始：有证 → 卡片隐藏
ui; has "DSH 入口" "主页已加载"
nhas "收好通行证" "初始卡片隐藏"

# 2) 点头像 → 卡片打开，显示当前状态
"$ADB" -s "$SER" shell input tap $AVX $AVY; sleep 1
ui; has "收好通行证" "点头像打开卡片"
has "当前凭证已生效" "卡片显示当前凭证状态"

# 3) 再点 → 关闭
"$ADB" -s "$SER" shell input tap $AVX $AVY; sleep 1
ui; nhas "收好通行证" "再点关闭卡片"

# 4) 长按 → 打开且**不清空**（token 仍在）
"$ADB" -s "$SER" shell input swipe $AVX $AVY $AVX $AVY 1000; sleep 1.2
ui; has "收好通行证" "长按打开卡片"
has "当前凭证已生效" "长按后仍显示已生效"
[ "$(curtok)" = "$BASE" ] && pass "长按未清空 token" || fail "长按把 token 清了"

# 5) 清空按钮 → 弹确认框，未立即清
tapbytext(){  # tapbytext "清空凭证" -> 按 text 现取 bounds 点中心
  local b x1 y1 x2 y2
  b=$(grep -o "text=\"$1\"[^>]*bounds=\"\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"" "$D/u.xml" | grep -o 'bounds="\[[0-9,]*\]\[[0-9,]*\]"' | head -1)
  [ -n "$b" ] || return 1
  set -- $(echo "$b" | sed 's/bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]"/\1 \2 \3 \4/')
  "$ADB" -s "$SER" shell input tap $(( ($1+$3)/2 )) $(( ($2+$4)/2 ))
}
tapbytext "清空凭证"; sleep 1
ui; has "清空后大肥鱼会停收推送" "清空弹确认框"
[ "$(curtok)" = "$BASE" ] && pass "确认前未清空" || fail "确认前就被清了"

# 6) 取消 → token 仍在
tapbytext "取消"; sleep 0.8
[ "$(curtok)" = "$BASE" ] && pass "取消后 token 仍在" || fail "取消却清了"

# 7) 收尾：点回卡片关闭，状态卡应回「已连接」（**别用 keyevent 4**：会把 Activity 退到桌面，
#    之后 dump 里没有本 App 的节点，断言必然假 FAIL —— v1.33.35 实测踩过）
"$ADB" -s "$SER" shell input tap $AVX $AVY; sleep 1
ui; nhas "收好通行证" "收尾时卡片已关"
has "通行证：已配置" "收尾状态卡已连接"

[ "$F" -eq 0 ] && say "GESTURE PASS" || say "GESTURE FAIL"
exit $F
