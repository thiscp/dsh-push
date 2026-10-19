#!/bin/bash
# vm1-host-onboard.sh - give the vm1 DSH host its own push credentials so phone
# notifications and phone answering work, then verify.
#
# WHY a separate host id: the relay keeps a PER-HOST answer queue
#   /var/lib/answer-relay/hosts.json  {hostId: {token, topic}}
#   /var/lib/answer-relay/queue.json  {hostId: [{callId, agentId, qids, answers, ts}]}
# and a plugin only polls ITS OWN host queue. Copying the desktop's credentials
# (host=desktop) would make both plugins poll the same queue: the desktop (3 s
# poll) can steal vm1's answer item and drop it, so the phone would show
# "answered" while vm1 waits forever. Use a distinct host id.
#
# WHY the topic may be shared: the phone App's readToken is authorised per TOPIC
# (dsh-desktop-phone has read on `dsh`). Pointing vm1's write at the same topic
# `dsh` means the phone sees vm1's pushes with NO re-pairing. This is how the
# work VM is wired (relay ready host=work topic=dsh).
#
# Usage (on vm1):
#   bash vm1-host-onboard.sh status                     # read-only diagnosis
#   bash vm1-host-onboard.sh write <payload.json> [--web-base URL] [--web-name NAME]
#   bash vm1-host-onboard.sh restart                    # restart with the right node
#   bash vm1-host-onboard.sh verify [--probe]           # log criteria (+ optional live push)
#   bash vm1-host-onboard.sh cleanup-seed               # drop my check snapshots/seed marker
#
# Exit codes: 0 ok; 2 environment error; 3 verification not satisfied; 4 blocked.

set -u

DSH_HOME_REAL="$HOME/.dsh"
PROFILE_DIR="$DSH_HOME_REAL/profiles/web"
PATCH="$PROFILE_DIR/cordis.patch.yml"
PKG="$PROFILE_DIR/package.json"
WEBLOG="$DSH_HOME_REAL/web.log"
CRED="$HOME/.config/dsh-push/credentials.json"
TK="$HOME/work/cp_learn_vmware/deepseek-harness"
# node must be an official build with stripTypeScriptTypes, else dsh refuses to
# boot (ERR_NO_TYPESCRIPT) and `dsh-net.sh restart` leaves the service down.
export PATH="$HOME/.local/bin:$PATH"

say()  { echo "[onboard] $*"; }
fail() { echo "[onboard] ERROR: $*"; exit 2; }

mask() { # print a secret's length, never its value
  local v="${1:-}"
  if [ -z "$v" ]; then echo '<empty>'; else echo "<len ${#v}>"; fi
}

cmd_status() {
  echo "== A. plugin =="
  if [ -d "$PROFILE_DIR/node_modules/dsh-push-host" ]; then
    local ver
    ver=$(node -e "console.log(require('$PROFILE_DIR/node_modules/dsh-push-host/package.json').version)" 2>/dev/null || echo '?')
    echo "   installed : version=$ver  client.js=$( [ -f "$PROFILE_DIR/node_modules/dsh-push-host/lib/client.js" ] && echo yes || echo no )"
  else
    echo "   installed : NO"
  fi
  echo "   wiring    : $(grep -c 'dsh-push-host' "$PKG" 2>/dev/null || true) mention(s) in profile package.json"
  echo "   mounted   : $(npx --yes "@deepseek-ai/dsh@$(cat "$DSH_HOME_REAL/.guard-pin" 2>/dev/null || echo latest)" --profile web --dump-config 2>/dev/null | grep -c 'id: push-host' || echo 0)"

  echo
  echo "== B. relay state (decisive) =="
  echo "   relay ready    : $(grep -c 'relay ready' "$WEBLOG" 2>/dev/null || true)"
  echo "   relay disabled : $(grep -c 'relay disabled' "$WEBLOG" 2>/dev/null || true)"
  echo "   credentials ln : $(grep -c 'credentials file' "$WEBLOG" 2>/dev/null || true)"
  grep -m1 'relay ready' "$WEBLOG" 2>/dev/null | sed 's/^/   last ready   : /'
  grep -m1 'relay disabled' "$WEBLOG" 2>/dev/null | sed 's/^/   last disabled: /'

  echo
  echo "== C. credentials =="
  if [ -f "$CRED" ]; then
    echo "   file      : $CRED  (mode $(stat -c '%a' "$CRED" 2>/dev/null))"
    node -e "
      const c = require('$CRED')
      const show = ['v','relay','host','topic','webBase','webName']
      for (const k of show) console.log('   ' + k.padEnd(9) + ': ' + (c[k] === undefined ? '<missing>' : c[k]))
      for (const k of ['writeToken','readToken','hostToken','regToken'])
        console.log('   ' + k.padEnd(9) + ': ' + (c[k] ? '<len ' + String(c[k]).length + '>' : '<missing>'))
    " 2>/dev/null || echo "   (file present but not valid JSON)"
  else
    echo "   file      : ABSENT ($CRED)"
    echo "   -> this is why 'relay disabled' appears and pushes never leave vm1"
  fi
  for v in DSH_PUSH_HOST DSH_PUSH_HOST_TOKEN DSH_PUSH_NTFY_TOKEN DSH_PUSH_REG_TOKEN DSH_PUSH_CREDENTIALS; do
    eval "val=\${$v:-}"
    echo "   env $v = $([ -n "$val" ] && echo '<set>' || echo '<unset>')"
  done

  echo
  echo "== D. what the phone would see (webBase/webName go into the push) =="
  if [ -f "$CRED" ]; then
    echo "   #name : $(node -e "console.log(require('$CRED').webName||'(unset)')" 2>/dev/null)"
    echo "   #web  : $(node -e "console.log(require('$CRED').webBase||'(unset)')" 2>/dev/null)"
  fi

  echo
  echo "== E. leftovers from my verification runs =="
  echo "   baseline snapshots: $(ls "$PATCH".baseline-check "$PKG".baseline-check 2>/dev/null | wc -l)"
  echo "   seed marker lines : $(grep -c 'seeded by vm1-dshnet-check.sh' "$PATCH" 2>/dev/null || true)"
  echo "   lock dir          : $( [ -d "$DSH_HOME_REAL/.vm1-check.lock" ] && echo present || echo absent )"
}

cmd_write() {
  local payload="${1:?usage: write <payload.json> [--web-base URL] [--web-name NAME]}"
  shift || true
  local webbase="" webname=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --web-base) webbase="${2:?--web-base needs a value}"; shift 2 ;;
      --web-name) webname="${2:?--web-name needs a value}"; shift 2 ;;
      *) fail "unknown option: $1" ;;
    esac
  done
  [ -f "$payload" ] || fail "payload not found: $payload"

  mkdir -p "$(dirname "$CRED")"
  node - "$payload" "$CRED" "$webbase" "$webname" <<'NODE'
const fs = require('fs')
const [src, dst, webBase, webName] = process.argv.slice(2)
let c
try { c = JSON.parse(fs.readFileSync(src, 'utf8')) } catch (e) { console.error('payload is not valid JSON: ' + e.message); process.exit(2) }
for (const k of ['relay', 'host', 'topic', 'writeToken', 'readToken', 'hostToken']) {
  if (!c[k]) { console.error('payload is missing required field: ' + k); process.exit(2) }
}
if (c.host === 'desktop') {
  console.error('REFUSING: host id "desktop" is already used by the desktop host.')
  console.error('Two hosts sharing one id share one answer queue -> answers get stolen and dropped.')
  console.error('Provision a distinct host id on the relay (deploy/relay-user-add.sh <user> [topic]).')
  process.exit(2)
}
if (webBase) c.webBase = webBase
if (webName) c.webName = webName
fs.writeFileSync(dst, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 })
fs.chmodSync(dst, 0o600)
console.log('   wrote ' + dst)
console.log('   host=' + c.host + ' topic=' + c.topic + ' relay=' + c.relay)
console.log('   webBase=' + (c.webBase || '(unset)') + '  webName=' + (c.webName || '(unset)'))
NODE
  local rc=$?
  [ "$rc" -eq 0 ] || fail "credential write refused (see above)"
  say "credentials installed; next: bash $0 restart"
}

cmd_restart() {
  [ -f "$TK/dsh-net.sh" ] || fail "dsh-net.sh not found at $TK"
  if ! node -e "require('node:module').stripTypeScriptTypes ? 0 : process.exit(1)" 2>/dev/null; then
    fail "node on PATH ($(command -v node) $(node -v)) lacks stripTypeScriptTypes; need export PATH=\$HOME/.local/bin:\$PATH"
  fi
  say "restarting with node $(node -v)"
  (cd "$TK" && ./dsh-net.sh restart) 2>&1 | tail -12
  sleep 8
  say "next: bash $0 verify"
}

cmd_verify() {
  local probe=0
  [ "${1:-}" = "--probe" ] && probe=1

  # NOTE on the window: the plugin's boot lines ("credentials file", "relay ready")
  # are emitted BEFORE that boot's "dsh web: http://..." marker, so a
  # "since the last marker" window sees none of them and reports a false
  # NOT-SATISFIED (that happened on 2026-10-14). web.log is append-only, so judge
  # by ORDER instead: the newest state wins. Credentials/relay lines must come
  # AFTER the last "relay disabled" line.
  local cred_n last_dis ready_n last_ready
  cred_n=$(grep -n 'credentials file' "$WEBLOG" 2>/dev/null | tail -1 | cut -d: -f1)
  ready_n=$(grep -n 'relay ready' "$WEBLOG" 2>/dev/null | tail -1 | cut -d: -f1)
  last_dis=$(grep -n 'relay disabled' "$WEBLOG" 2>/dev/null | tail -1 | cut -d: -f1)
  last_ready=$ready_n
  cred_n=${cred_n:-0}; ready_n=${ready_n:-0}; last_dis=${last_dis:-0}

  echo "== verification (newest state wins, by line order) =="
  echo "   last 'credentials file' line : $cred_n"
  echo "   last 'relay ready'      line : $ready_n"
  echo "   last 'relay disabled'   line : $last_dis"
  echo "   -- newest boot block (last 12 lines before the newest 'dsh web:' marker) --"
  awk '/dsh web: http/{last=NR} {lines[NR]=$0} END{for(i=(last>12?last-12:1);i<last;i++) print lines[i]}' "$WEBLOG" 2>/dev/null | sed 's/^/   | /'

  local ok=1
  # credentials parsed after the last failure, and relay came up after it too
  [ "$cred_n" -gt "$last_dis" ] || ok=0
  [ "$ready_n" -gt "$last_dis" ] || ok=0
  [ "$ready_n" -gt 0 ] || ok=0
  echo "   credentials newer than last failure : $([ "$cred_n" -gt "$last_dis" ] && echo yes || echo NO)"
  echo "   relay ready newer than last failure : $([ "$ready_n" -gt "$last_dis" ] && echo yes || echo NO)"

  if [ "$probe" = "1" ]; then
    echo
    echo "== live probe: one qa- push to the shared topic (reaches the user's phone) =="
    local topic relay wtok
    topic=$(node -e "console.log(require('$CRED').topic)" 2>/dev/null || echo '')
    relay=$(node -e "console.log(require('$CRED').relay)" 2>/dev/null || echo '')
    wtok=$(node -e "console.log(require('$CRED').writeToken)" 2>/dev/null || echo '')
    if [ -z "$topic" ] || [ -z "$relay" ] || [ -z "$wtok" ]; then
      echo "   SKIP: credentials incomplete"
    else
      local code url
      # ntfy publishes to a TOPIC PATH: the credentials carry relay and topic as
      # two separate fields, so the URL must be "$relay/$topic". Posting to the
      # bare relay host returns HTTP 400 (that mistake cost a round on 2026-10-14).
      url="${relay%/}/$topic"
      code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$url" \
        -H "Authorization: Bearer $wtok" \
        -H 'Title: vm1 onboarding probe' -H 'Tags: qa-onboard' \
        -d "qa-vm1-onboard-$(date +%s) - one-line probe from vm1's DSH host")
      echo "   POST $url -> HTTP $code  (200 = written; expect exactly ONE notification)"
      [ "$code" = "200" ] || [ "$code" = "201" ] || ok=0
    fi
  fi

  echo
  if [ "$ok" = "1" ]; then
    echo "VERDICT: PASS - vm1's push chain is up; the next agent question/turn-end will reach the phone."
    exit 0
  fi
  echo "VERDICT: NOT SATISFIED - see the lines above (most likely: credentials missing/host id clash)."
  exit 3
}

cmd_cleanup_seed() {
  # Keep the plugin installed (vm1 is meant to run it long-term). Only remove my
  # verification leftovers: the byte-restore snapshots and the seed comment.
  say "removing baseline snapshots"
  rm -f "$PATCH.baseline-check" "$PKG.baseline-check"
  if grep -q 'seeded by vm1-dshnet-check.sh' "$PATCH" 2>/dev/null; then
    local tmp
    tmp=$(mktemp)
    grep -v 'seeded by vm1-dshnet-check.sh' "$PATCH" | grep -v '^# seeded by' >"$tmp"
    cp "$tmp" "$PATCH"
    rm -f "$tmp"
    say "removed the seed comment line (the tool-ask-user timed block is KEPT: phone answering needs it)"
  else
    say "no seed comment present"
  fi
  rm -rf "$DSH_HOME_REAL/.vm1-check.lock"
  echo "   patch lines now: $(wc -l <"$PATCH")"
  echo "   tool-ask-user  : $(grep -c 'id: tool-ask-user' "$PATCH" || true) (expect >=1: timed for phone answering)"
  echo "   next: bash $0 status"
}

case "${1:-}" in
  status)       cmd_status ;;
  write)        shift; cmd_write "$@" ;;
  restart)      cmd_restart ;;
  verify)       shift; cmd_verify "$@" ;;
  cleanup-seed) cmd_cleanup_seed ;;
  *) echo "usage: $0 {status | write <payload.json> [--web-base URL] [--web-name NAME] | restart | verify [--probe] | cleanup-seed}"; exit 2 ;;
esac
