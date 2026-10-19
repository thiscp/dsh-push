#!/bin/bash
# host-plugin verification against the vm1 SERVICE (the user's own dsh-net.sh
# instance, DSH_HOME=~/.dsh, profile=web, proxy 3080 -> 3081).
#
# Why this instead of verify/vm1-qa-env.sh: that one built a private isolated
# DSH_HOME under ~/dsh-qa. The user asked (2026-10-14) to standardise on the
# service they already run and upgraded to 0.2.0-rc.2 - same version as the
# desktop production host - and it comes with the dsh-net proxy already in the
# link, so the Web settings page (isLoopback rewrite) works and can be used to
# verify the switch UI. Nothing here touches the desktop production host.
#
# What it proves: booting the host with a plugin installed must NOT rewrite the
# user's cordis.patch.yml. That is exactly the 0.2.0 P0 (it downgraded
# tool-ask-user from timed to legacy on boot, with no user action).
#
# Usage:
#   bash vm1-dshnet-check.sh check  <tarball>     # install + restart + verdict
#   bash vm1-dshnet-check.sh check  <tarball> --no-seed
#   bash vm1-dshnet-check.sh cleanup             # remove plugin + restore patch
#   bash vm1-dshnet-check.sh status              # service + profile report
#
# Exit codes: 0 = PASS (boot wrote nothing)
#             3 = WRITE DETECTED (P0 class: patch mutated / backup added)
#             4 = BLOCKED (plugin never loaded -> proves nothing)
#             2 = environment error

set -u

TK="$HOME/work/cp_learn_vmware/deepseek-harness"
DSH_NET="$TK/dsh-net.sh"
DSH_HOME_REAL="$HOME/.dsh"
PROFILE="web"
PATCH="$DSH_HOME_REAL/profiles/$PROFILE/cordis.patch.yml"
WEBLOG="$DSH_HOME_REAL/web.log"
PROFILE_DIR="$DSH_HOME_REAL/profiles/$PROFILE"
PIN_FILE="$DSH_HOME_REAL/.guard-pin"
PUBLIC_HOST="<tailnet-vm1>"

say()  { echo "[check] $*"; }
fail() { echo "[check] ERROR: $*"; exit 2; }

# ── serialisation lock ───────────────────────────────────────────────────────
# This service (and its profile) is SHARED: more than one agent may verify
# plugins on it. On 2026-10-14 two concurrent runs interleaved - one agent's
# check re-seeded and re-installed while the other was mid-cleanup, so the
# profile appeared to mutate on its own. Serialise with a lock dir; a stale lock
# (older than 30 min, e.g. a killed run) is stolen.
LOCK_DIR="$DSH_HOME_REAL/.vm1-check.lock"
acquire_lock() {
  local tries=0 age
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    age=$(( $(date +%s) - $(date -r "$LOCK_DIR" +%s 2>/dev/null || date +%s) ))
    if [ "$age" -gt 1800 ]; then
      say "stealing stale lock (age ${age}s): $LOCK_DIR"
      rm -rf "$LOCK_DIR"
      continue
    fi
    tries=$((tries + 1))
    if [ "$tries" -gt 60 ]; then
      fail "another check holds $LOCK_DIR (age ${age}s); retry later or remove it if stale"
    fi
    [ "$tries" = "1" ] && say "waiting for the lock held by another run (age ${age}s)"
    sleep 5
  done
  echo "$$" >"$LOCK_DIR/pid"
  trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM
  say "lock acquired: $LOCK_DIR"
}

[ -f "$DSH_NET" ] || fail "dsh-net.sh not found: $DSH_NET"
[ -f "$PATCH" ]   || fail "profile patch not found: $PATCH"

# pnpm is required by `dsh plugin add` and lives in ~/.local/bin on vm1.
# CRITICAL (2026-10-14): the node that runs dsh must be an OFFICIAL build with
# TypeScript stripping. vm1's /usr/bin/node v22.22.1 (Ubuntu pkg) lacks
# stripTypeScriptTypes() -> dsh refuses to boot with ERR_NO_TYPESCRIPT, which
# makes `dsh-net.sh restart` fail and leaves the service down. ~/.local/bin/node
# is a symlink to ~/.hermes/node/bin/node (v22.22.3, official) and works.
export PATH="$HOME/.local/bin:$PATH"

if ! node -e "require('node:module').stripTypeScriptTypes ? 0 : process.exit(1)" 2>/dev/null; then
  fail "node on PATH ($(command -v node) $(node -v)) lacks stripTypeScriptTypes; put ~/.local/bin first (export PATH=\$HOME/.local/bin:\$PATH)"
fi

dsh_cli() {
  local pin
  pin=$(cat "$PIN_FILE" 2>/dev/null || echo "")
  [ -n "$pin" ] || fail "cannot read $PIN_FILE"
  npx --yes "@deepseek-ai/dsh@$pin" "$@"
}

seed_timed() {
  # Mimic production: tool-ask-user configured timed via a top-level insert.
  if grep -q 'id: tool-ask-user' "$PATCH"; then
    say "already configured: tool-ask-user present in patch"
    return 0
  fi
  {
    printf '\n'
    printf '%s\n' \
      '# seeded by vm1-dshnet-check.sh: mimic the production timed baseline' \
      '- insert:' \
      '    - id: tool-ask-user' \
      "      name: '@deepseek-ai/dsh-tool-ask-user'" \
      '      config:' \
      '        mode: timed' \
      '        timeout: 120'
  } >>"$PATCH"
  grep -q 'id: tool-ask-user' "$PATCH" || fail "seeding failed"
  say "seeded tool-ask-user mode=timed (production baseline)"
}

cmd_status() {
  echo "== dsh-net.sh status =="
  (cd "$TK" && ./dsh-net.sh status)
  echo
  echo "== version guard =="
  (cd "$TK" && ./dsh-net.sh version)
  echo
  echo "== profile $PROFILE =="
  echo "patch      : $PATCH ($(wc -l <"$PATCH") lines)"
  echo "plugin     : $( [ -d "$PROFILE_DIR/node_modules/dsh-push-host" ] && node -e "console.log(require('$PROFILE_DIR/node_modules/dsh-push-host/package.json').version)" 2>/dev/null || echo 'not installed' )"
  # A leftover bundle entry with no installed package makes EVERY boot log
  # `skipping profile bundle "dsh-push-host"` - check it explicitly.
  echo "dangling bundle entry: $(grep -c '"dsh-push-host"' "$PROFILE_DIR/package.json" 2>/dev/null || echo 0) (0 = clean; >0 while 'not installed' = stale)"
  echo "tool-ask-user in patch: $(grep -c 'id: tool-ask-user' "$PATCH" || true)"
  echo "push-host entries  : $(grep -c '^ *- *id: *push-host' "$PATCH" || true)"
  echo "baseline snapshot  : $( [ -f "$PATCH.baseline-check" ] && echo present || echo absent )"
  echo "patch sha256: $(sha256sum "$PATCH" | cut -d' ' -f1)"
  echo "backups     : $(ls "$PROFILE_DIR"/cordis.patch.yml.bak-* 2>/dev/null | wc -l)"
}

cmd_check() {
  local tarball="${1:?usage: check <tarball> [--no-seed]}"
  shift || true
  local do_seed=1
  [ "${1:-}" = "--no-seed" ] && do_seed=0
  [ -f "$tarball" ] || fail "tarball not found: $tarball"
  acquire_lock

  # Snapshot the user's own patch BEFORE we touch anything, so cleanup can put
  # the profile back exactly as it was (the plugin's own .bak files are taken
  # after our seed, so they cannot serve as the baseline).
  local BASELINE="$PATCH.baseline-check"
  local PKG="$PROFILE_DIR/package.json"
  local PKG_BASE="$PKG.baseline-check"
  if [ ! -f "$BASELINE" ]; then
    cp "$PATCH" "$BASELINE"
    say "baseline saved: $BASELINE"
  else
    say "baseline already exists (kept): $BASELINE"
  fi
  # `dsh plugin add` writes the dependency AND the dsh.profile.bundles entry into
  # package.json. Removing only node_modules leaves a dangling bundle entry, and
  # every later boot then logs
  #   dsh: skipping profile bundle "dsh-push-host": cannot resolve ...
  # (observed 2026-10-14). Snapshot it so cleanup can restore it too.
  if [ ! -f "$PKG_BASE" ]; then
    cp "$PKG" "$PKG_BASE"
    say "package.json baseline saved: $PKG_BASE"
  else
    say "package.json baseline already exists (kept): $PKG_BASE"
  fi

  if [ "$do_seed" = "1" ]; then seed_timed; fi

  # 1. install the plugin under test (same-version re-add is a no-op -> drop first)
  rm -rf "$PROFILE_DIR/node_modules/dsh-push-host"
  say "installing $tarball"
  dsh_cli plugin --profile "$PROFILE" add "$tarball" >"$DSH_HOME_REAL/check-add.log" 2>&1 \
    || { tail -5 "$DSH_HOME_REAL/check-add.log"; fail "plugin add failed (see $DSH_HOME_REAL/check-add.log)"; }
  local version
  version=$(node -e "console.log(require('$PROFILE_DIR/node_modules/dsh-push-host/package.json').version)" 2>/dev/null || echo '?')
  local client_js
  [ -f "$PROFILE_DIR/node_modules/dsh-push-host/lib/client.js" ] && client_js=yes || client_js=no
  say "installed: version=$version client.js=$client_js"

  # 2. before snapshot
  local h1 bak1
  h1=$(sha256sum "$PATCH" | cut -d' ' -f1)
  bak1=$(ls "$PROFILE_DIR"/cordis.patch.yml.bak-* 2>/dev/null | wc -l)
  say "H1=$h1 baks_before=$bak1"

  # 3. restart the service and wait for the new boot
  # web.log is APPEND-ONLY across restarts, so only the lines written after this
  # restart may be judged. Counting the whole file made a clean 0.2.1 boot look
  # like WRITE DETECTED because the previous 0.2.0 run's switch lines were still
  # in the log (2026-10-14).
  local log_before newlog
  log_before=$(wc -l <"$WEBLOG" 2>/dev/null || echo 0)
  say "restarting the vm1 service (web.log offset before: $log_before)"
  (cd "$TK" && ./dsh-net.sh restart >"$DSH_HOME_REAL/check-restart.log" 2>&1)
  local deadline=$((SECONDS + 90))
  while [ "$SECONDS" -lt "$deadline" ]; do
    [ "$(wc -l <"$WEBLOG" 2>/dev/null || echo 0)" -gt "$log_before" ] && \
      tail -n "+$((log_before + 1))" "$WEBLOG" | grep -q 'dsh-push-host' && break
    sleep 2
  done
  sleep 6   # let post-boot reconciliation (tools/change, volatile, HMR) settle
  newlog=$(mktemp)
  tail -n "+$((log_before + 1))" "$WEBLOG" >"$newlog" 2>/dev/null || true

  # 4. after snapshot
  local h2 bak2 switch_lines push_host_entries timed_lines legacy_lines loaded skip_err
  h2=$(sha256sum "$PATCH" | cut -d' ' -f1)
  bak2=$(ls "$PROFILE_DIR"/cordis.patch.yml.bak-* 2>/dev/null | wc -l)
  switch_lines=$(grep -c '手机作答模式' "$newlog" 2>/dev/null || true)
  push_host_entries=$(grep -c '^ *- *id: *push-host' "$PATCH" 2>/dev/null || true)
  timed_lines=$(grep -c 'mode: timed' "$PATCH" 2>/dev/null || true)
  legacy_lines=$(grep -c 'mode: legacy' "$PATCH" 2>/dev/null || true)
  # Boot-validity gate must be POSITIVE. Counting any line containing
  # "dsh-push-host" is too weak: the host's own error line
  #   dsh: skipping profile bundle "dsh-push-host": ... cannot resolve ...
  # contains that string, so a boot where the plugin NEVER loaded would have been
  # certified as "loaded" (2026-10-14 - caught while auditing the 0.2.1 run).
  loaded=$(grep -cE 'relay ready|relay disabled|credentials file' "$newlog" 2>/dev/null || true)
  skip_err=$(grep -cE 'skipping profile bundle|cannot resolve profile bundle' "$newlog" 2>/dev/null || true)

  local token
  token=$(grep -oE 'token=[A-Za-z0-9_-]+' "$WEBLOG" 2>/dev/null | tail -1 | cut -d= -f2)

  echo
  echo "================= VM1 SERVICE CHECK RESULT ================="
  echo "plugin version          : $version   (client.js=$client_js)"
  echo "boot log                : $WEBLOG  (restart log: $DSH_HOME_REAL/check-restart.log)"
  echo "patch hash before/after : $h1 / $h2"
  echo "backups before/after    : $bak1 / $bak2"
  echo "plugin log lines        : $loaded   (positive load marker; 0 => never loaded)"
  echo "dangling bundle errors  : $skip_err   (must be 0)"
  echo "switch log lines        : $switch_lines   (must be 0)"
  echo "patch '- id: push-host' : $push_host_entries   (must be 0)"
  echo "patch mode: timed       : $timed_lines"
  echo "patch mode: legacy      : $legacy_lines"
  [ -n "$token" ] && echo "web UI                  : http://$PUBLIC_HOST:3080/?token=$token"
  echo "-----------------------------------------------------------"
  if [ "$skip_err" != "0" ]; then
    echo "VERDICT: BLOCKED - the host skipped the bundle (install did not take effect)"
    grep -nE 'skipping profile bundle.*dsh-push-host|cannot resolve profile bundle.*dsh-push-host' "$newlog" | head -3
    echo "==========================================================="
    exit 4
  fi
  if [ "$loaded" = "0" ]; then
    echo "VERDICT: BLOCKED - the plugin never loaded, so this run proves nothing"
    tail -12 "$newlog"
    echo "==========================================================="
    exit 4
  fi
  if [ "$h1" = "$h2" ] && [ "$bak1" = "$bak2" ] && [ "$switch_lines" = "0" ] && [ "$push_host_entries" = "0" ]; then
    echo "VERDICT: PASS - boot wrote nothing (hash, backups, switch log, entries all clean)"
    echo "==========================================================="
    exit 0
  fi
  echo "VERDICT: WRITE DETECTED - the boot mutated the profile patch file"
  echo "--- plugin log lines ---"
  grep -n 'dsh-push-host' "$newlog" 2>/dev/null | tail -8
  echo "--- patch tail ---"
  tail -14 "$PATCH"
  echo "==========================================================="
  exit 3
}

cmd_cleanup() {
  acquire_lock
  say "removing dsh-push-host from profile $PROFILE"
  rm -rf "$PROFILE_DIR/node_modules/dsh-push-host"
  # Prefer the pre-check baseline snapshot: the plugin's own .bak files were taken
  # AFTER our seed, so restoring one of those would keep the seeded timed block.
  local BASELINE="$PATCH.baseline-check"
  if [ -f "$BASELINE" ]; then
    cp "$BASELINE" "$PATCH"
    rm -f "$BASELINE"
    say "patch restored from pre-check baseline (seeded block removed)"
  else
    local newest
    newest=$(ls -t "$PROFILE_DIR"/cordis.patch.yml.bak-* 2>/dev/null | head -1)
    if [ -n "$newest" ]; then
      cp "$newest" "$PATCH"
      say "no baseline; restored from newest plugin backup $newest (may still contain the seed)"
    else
      say "no baseline and no backup found; leaving patch as-is"
    fi
  fi
  # package.json must be restored too: `dsh plugin add` added both a dependency
  # and a dsh.profile.bundles entry, and a leftover bundle entry makes every
  # subsequent boot log `skipping profile bundle "dsh-push-host"`.
  local PKG="$PROFILE_DIR/package.json"
  if [ -f "$PKG.baseline-check" ]; then
    cp "$PKG.baseline-check" "$PKG"
    rm -f "$PKG.baseline-check"
    say "package.json restored from baseline (dependency + bundle entry removed)"
  else
    say "WARNING: no package.json baseline; if a dangling dsh-push-host bundle entry remains, every boot will log 'skipping profile bundle'"
  fi
  # plugin's own backups from this check are noise in the user's profile -> drop
  # only those created during the check window (baseline mtime .. now)
  if [ -f "$DSH_HOME_REAL/check-add.log" ]; then
    find "$PROFILE_DIR" -maxdepth 1 -name 'cordis.patch.yml.bak-*' \
      -newer "$DSH_HOME_REAL/check-add.log" -delete 2>/dev/null || true
  fi
  say "restarting the service on the restored profile"
  (cd "$TK" && ./dsh-net.sh restart >"$DSH_HOME_REAL/check-cleanup.log" 2>&1)
  sleep 12
  local h1 h2
  h1=$(sha256sum "$PATCH" | cut -d' ' -f1)
  sleep 20
  h2=$(sha256sum "$PATCH" | cut -d' ' -f1)
  echo "cleanup: hash stable after 20s = $([ "$h1" = "$h2" ] && echo yes || echo 'NO - something is still writing')"
  echo "cleanup: patch sha256        = $h2"
  echo "cleanup: tool-ask-user entries= $(grep -c 'id: tool-ask-user' "$PATCH" || true)"
  echo "cleanup: push-host entries   = $(grep -c '^ *- *id: *push-host' "$PATCH" || true)"
  echo "cleanup: plugin installed    = $( [ -d "$PROFILE_DIR/node_modules/dsh-push-host" ] && echo yes || echo no )"
  echo "cleanup: plugin log lines    = $(grep -c '手机作答模式' "$DSH_HOME_REAL/web.log" 2>/dev/null || true) (historical; 0 expected only on a fresh log)"
  echo "cleanup: last boot version   = $(grep -m1 -oE '@deepseek-ai/dsh@[0-9a-zA-Z.-]+' "$DSH_HOME_REAL/check-cleanup.log" 2>/dev/null | head -1)"
}

case "${1:-}" in
  check)   shift; cmd_check "$@" ;;
  cleanup) cmd_cleanup ;;
  status)  cmd_status ;;
  *) echo "usage: $0 {check <tarball> [--no-seed] | cleanup | status}"; exit 2 ;;
esac
