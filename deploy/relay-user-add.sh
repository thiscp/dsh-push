#!/bin/bash
# relay-user-add.sh <user> [topic] -- provision an isolated per-user push channel:
#   ntfy users (write-only host / read-only phone) + topic ACL + relay host entry + pairing payload
# usage: bash relay-user-add.sh alice        # topic defaults to dsh-alice
set -u
U="${1:?usage: relay-user-add.sh <user> [topic]}"
TOPIC="${2:-dsh-$U}"
RT=$(cat /etc/answer-relay/regtoken)
PUB="dsh-$U-pub"; PH="dsh-$U-phone"

P1=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')
P2=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')

echo "== 1) 建 ntfy 用户（已存在则跳过密码设置）=="
docker exec ntfy ntfy user list | grep -q "^user $PUB " || docker exec -e NTFY_PASSWORD="$P1" ntfy ntfy user add "$PUB" >/dev/null
docker exec ntfy ntfy user list | grep -q "^user $PH "  || docker exec -e NTFY_PASSWORD="$P2" ntfy ntfy user add "$PH"  >/dev/null
echo "   users: $PUB / $PH"

echo "== 2) 绑 topic 权限（只写 / 只读）=="
docker exec ntfy ntfy access "$PUB" "$TOPIC" write-only >/dev/null 2>&1 || docker exec ntfy ntfy access "$PUB" "$TOPIC" wo >/dev/null
docker exec ntfy ntfy access "$PH"  "$TOPIC" read-only  >/dev/null 2>&1 || docker exec ntfy ntfy access "$PH"  "$TOPIC" ro >/dev/null
docker exec ntfy ntfy user list | grep -A2 "^user $PUB\|^user $PH"

echo "== 3) 签令牌 =="
TPUB=$(docker exec ntfy ntfy token add "$PUB" 2>/dev/null | grep -oE 'tk_[A-Za-z0-9]+' | tail -1)
TPH=$(docker exec ntfy ntfy token add "$PH" 2>/dev/null | grep -oE 'tk_[A-Za-z0-9]+' | tail -1)
echo "   host token: ${TPUB:0:10}...   phone token: ${TPH:0:10}..."

echo "== 4) relay 侧开 host 条目 =="
HOSTRESP=$(curl -s -X POST http://127.0.0.1:2587/answer/host -H "X-Reg-Token: $RT" \
  -H 'Content-Type: application/json' -d "{\"host\":\"$U\",\"topic\":\"$TOPIC\"}")
HK=$(echo "$HOSTRESP" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))')
echo "   host=$U topic=$TOPIC hostToken=${HK:0:10}..."

echo
echo "== 5) 配对载荷（给 App 扫/粘）=="
python3 - "$U" "$TOPIC" "$TPUB" "$TPH" "$HK" <<'PY'
import json, sys
u, topic, tpub, tph, hk = sys.argv[1:6]
print(json.dumps({"v": 1, "relay": "https://ntfy.cpyh.xyz", "host": u, "topic": topic,
                  "writeToken": tpub, "readToken": tph, "hostToken": hk}, ensure_ascii=False))
PY
