#!/bin/bash
# vm1 independent QA environment for the host-plugin "phone answer mode" switch.
#
# Why this exists: verifying that switch on the production desktop DSH means
# restarting the very host that runs the agent (and 0.2.0 proved that a bad
# switch can rewrite the production profile). This script builds a FULLY
# ISOLATED DSH home on vm1, exercises the plugin boot there, and reports
# whether the boot wrote the profile patch file.
#
# Isolation: everything lives under $HOME/dsh-qa (DSH_HOME=$HOME/dsh-qa/home).
# Nothing under vm1's real ~/.dsh is touched.
#
# NOTE (2026-10-14): the USER'S OWN vm1 service (dsh-net.sh, DSH_HOME=~/.dsh,
# profile=web, 0.2.0-rc.2 - same version as desktop production, proxy included)
# is now the STANDARD verification env - see verify/vm1-dshnet-check.sh. This
# script remains the fully-isolated fallback (private DSH_HOME under ~/dsh-qa).
#
# Usage: bash vm1-qa-env.sh <plugin-tarball> [profile-name] [expected-mode]
#   expected-mode: timed (default) - seed the profile so tool-ask-user is timed,
#                  i.e. reproduce production's state and assert the boot does
#                  NOT downgrade it to legacy.
#   keep:          pass "keep" as 4th arg to leave the instance RUNNING (for UI
#                  checks); it then also prints the token and the proxy command.
#
# Exit codes: 0 = clean (no write), 3 = WRITE DETECTED (P0 class), 2 = env error,
#             4 = BLOCKED (plugin never loaded - proves nothing).

set -u

TARBALL="${1:?usage: vm1-qa-env.sh <plugin-tarball> [profile] [expected-mode] [keep]}"
PROFILE="${2:-qa020}"
EXPECTED="${3:-timed}"
KEEP="${4:-}"

ROOT="$HOME/dsh-qa"
export DSH_HOME="$ROOT/home"
DSH_NODE="$ROOT/node_modules/@deepseek-ai/dsh/lib/bin.js"
PORT=3099
PROXY_PORT=3098
BOOT_SECONDS=75
TRUSTED_HOST="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^100\.' | head -1)"
[ -n "$TRUSTED_HOST" ] || TRUSTED_HOST="127.0.0.1"

say() { echo "[vm1-qa] $*"; }
fail() { echo "[vm1-qa] ERROR: $*"; exit 2; }

[ -f "$DSH_NODE" ] || fail "dsh not installed at $DSH_NODE (npm i @deepseek-ai/dsh@0.2.0-rc.2 in $ROOT)"
[ -f "$TARBALL" ] || fail "tarball not found: $TARBALL"
command -v node >/dev/null || fail "node missing"

PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
PATCH="$PROFILE_DIR/cordis.patch.yml"
BOOTLOG="$ROOT/boot-$PROFILE.log"

say "profile=$PROFILE expected=$EXPECTED dsh_home=$DSH_HOME"

# ── 0. stop any leftover instance from a previous run ────────────────────────
pkill -f "dsh/lib/bin.js --profile $PROFILE" 2>/dev/null && sleep 2
rm -rf "$PROFILE_DIR"
rm -f "$BOOTLOG"

# ── 1. fresh profile from the shipped web template ───────────────────────────
cd "$ROOT" || fail "cd $ROOT"
node "$DSH_NODE" --profile "$PROFILE" --from-default-profile web --dump-config >"$ROOT/init-$PROFILE.log" 2>&1 \
  || fail "profile creation failed, see $ROOT/init-$PROFILE.log"
say "profile created"

# Isolated DSH_HOME has no credentials: borrow the real one so the web app can boot
# (the account grant lives in the web-app bundle, which this template uses).
if [ -f "$HOME/.dsh/.credentials.yaml" ] && [ ! -f "$DSH_HOME/.credentials.yaml" ]; then
  cp "$HOME/.dsh/.credentials.yaml" "$DSH_HOME/.credentials.yaml"
  chmod 600 "$DSH_HOME/.credentials.yaml"
  say "credentials borrowed from ~/.dsh"
fi

# ── 2. seed the expected live mode (mimics production: a timed ask-user insert)
if [ "$EXPECTED" = "timed" ]; then
  body=$(grep -v '^[[:space:]]*#' "$PATCH" 2>/dev/null | tr -d '[:space:]')
  # Seed with printf (not a heredoc): a heredoc seeded block came out with a
  # truncated id ("tool-ask-use") on 2026-10-14, which sent the plugin down the
  # "entry not found" path and muddied the verdict.
  seed=$(mktemp)
  printf '%s\n' \
    '- insert:' \
    '    - id: tool-ask-user' \
    "      name: '@deepseek-ai/dsh-tool-ask-user'" \
    '      config:' \
    '        mode: timed' \
    '        timeout: 120' >"$seed"
  if [ "$body" = "[]" ] || [ -z "$body" ]; then
    tmp=$(mktemp)
    grep '^[[:space:]]*#' "$PATCH" >"$tmp" 2>/dev/null
    cat "$seed" >>"$tmp"
    mv "$tmp" "$PATCH"
  else
    printf '\n' >>"$PATCH"
    cat "$seed" >>"$PATCH"
  fi
  rm -f "$seed"
  if ! grep -q 'id: tool-ask-user' "$PATCH"; then
    fail "seeding failed: profile patch has no tool-ask-user entry"
  fi
  say "seeded: tool-ask-user mode=timed"
fi

# ── 3. install the plugin under test ─────────────────────────────────────────
node "$DSH_NODE" plugin --profile "$PROFILE" add "$TARBALL" >"$ROOT/add-$PROFILE.log" 2>&1 \
  || fail "plugin add failed, see $ROOT/add-$PROFILE.log"
VERSION=$(node -e "console.log(require('$PROFILE_DIR/node_modules/dsh-push-host/package.json').version)" 2>/dev/null)
CLIENT=$( [ -f "$PROFILE_DIR/node_modules/dsh-push-host/lib/client.js" ] && echo yes || echo no )
say "plugin installed: version=$VERSION client.js=$CLIENT"

# ── 4. before snapshot ───────────────────────────────────────────────────────
H1=$(sha256sum "$PATCH" | cut -d' ' -f1)
BAK1=$(ls "$PROFILE_DIR"/cordis.patch.yml.bak-* 2>/dev/null | wc -l)
say "H1=$H1 baks_before=$BAK1"

# ── 5. boot the host long enough for plugins to load, then stop it ───────────
# NOTE: with `--profile <p>` the booted app takes no positional name; passing
# "web" yields "too many arguments. Expected 0 arguments but got 1: web." and
# an empty boot (that produced a false PASS on 2026-10-14).
( timeout "$BOOT_SECONDS" node "$DSH_NODE" --profile "$PROFILE" --no-open --host 127.0.0.1 \
    --port "$PORT" --trusted-host "$TRUSTED_HOST" >"$BOOTLOG" 2>&1 ) &
BOOT_PID=$!
for i in $(seq 1 "$BOOT_SECONDS"); do
  grep -qE 'dsh web: http|relay ready' "$BOOTLOG" 2>/dev/null && break
  sleep 1
done
sleep 8   # let post-boot reconciliation (tools/change, volatile, HMR) settle
if [ "$KEEP" = "keep" ]; then
  say "keeping the QA instance RUNNING (no --keep means it is stopped and snapshotted below)"
else
  kill "$BOOT_PID" 2>/dev/null
  pkill -f "dsh/lib/bin.js --profile $PROFILE" 2>/dev/null
  sleep 3
fi

# ── 5b. boot-validity gate: "ran but measured nothing" is BLOCKED, not PASS ──
if ! grep -q 'dsh-push-host' "$BOOTLOG" 2>/dev/null; then
  echo
  echo "==================== VM1 CLEAN-ENV RESULT ===================="
  echo "VERDICT: BLOCKED - the plugin never loaded, so this run proves nothing"
  echo "boot log ($BOOTLOG) tail:"
  tail -12 "$BOOTLOG" 2>/dev/null
  echo "============================================================"
  exit 4
fi

# ── 6. after snapshot ────────────────────────────────────────────────────────
H2=$(sha256sum "$PATCH" | cut -d' ' -f1)
BAK2=$(ls "$PROFILE_DIR"/cordis.patch.yml.bak-* 2>/dev/null | wc -l)
SWITCH_LINES=$(grep -c '手机作答模式' "$BOOTLOG" 2>/dev/null || true)
LEGACY_LINES=$(grep -c 'mode: legacy' "$PATCH" 2>/dev/null || true)
TIMED_LINES=$(grep -c 'mode: timed' "$PATCH" 2>/dev/null || true)
# P07 assertion: the plugin must NOT add its own entry to the user's patch file
# for status display (0.2.0 did exactly that: "- id: push-host / askUserStatus: ...").
PUSH_HOST_ENTRY=$(grep -c '^ *- *id: *push-host' "$PATCH" 2>/dev/null || true)

echo
echo "==================== VM1 CLEAN-ENV RESULT ===================="
echo "plugin version        : $VERSION   (client.js=$CLIENT)"
echo "boot log              : $BOOTLOG"
echo "patch hash before     : $H1"
echo "patch hash after      : $H2"
echo "backups before/after  : $BAK1 / $BAK2"
echo "switch log lines      : $SWITCH_LINES"
echo "patch mode: timed     : $TIMED_LINES"
echo "patch mode: legacy    : $LEGACY_LINES"
echo "patch 'id: push-host' : $PUSH_HOST_ENTRY   (must be 0: no status write-back)"
if [ "$KEEP" = "keep" ]; then
  TOKEN=$(grep -oE 'token=[A-Za-z0-9_-]+' "$BOOTLOG" 2>/dev/null | tail -1 | cut -d= -f2)
  echo "instance              : RUNNING on 127.0.0.1:$PORT (token below)"
  echo "token                 : $TOKEN"
  echo "expose for a browser  : node ~/work/cp_learn_vmware/deepseek-harness/dsh-net-proxy.mjs \\"
  echo "                          --listen-host 0.0.0.0 --listen-port $PROXY_PORT \\"
  echo "                          --target-host 127.0.0.1 --target-port $PORT --pid-file $ROOT/proxy.pid"
  echo "then open             : http://$TRUSTED_HOST:$PROXY_PORT/?token=$TOKEN"
fi
echo "------------------------------------------------------------"
if [ "$H1" = "$H2" ] && [ "$BAK1" = "$BAK2" ] && [ "$SWITCH_LINES" = "0" ] && [ "$PUSH_HOST_ENTRY" = "0" ]; then
  echo "VERDICT: PASS - boot wrote nothing (no hash change, no backup, no switch log, no push-host entry)"
  echo "============================================================"
  exit 0
fi
echo "VERDICT: WRITE DETECTED - the boot mutated the profile patch file"
echo "--- offending boot log lines ---"
grep -n '手机作答模式\|dsh-push-host' "$BOOTLOG" 2>/dev/null | head -12
echo "--- patch tail ---"
tail -12 "$PATCH"
echo "============================================================"
exit 3
