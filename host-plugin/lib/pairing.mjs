#!/usr/bin/env node
/**
 * Pairing tool for the DSH push host plugin — the operator's single command for onboarding one user.
 *
 *   dsh-push-pair [payload] [options]     print the pairing payload for one user's phone
 *   dsh-push-pair verify   [options]      check a credentials file against the live relay + ntfy
 *
 * Options (both commands):
 *   --credentials-file <path>  credentials JSON (default: $DSH_PUSH_CREDENTIALS or
 *                              ~/.config/dsh-push/credentials.json)
 *   --relay <url>              relay base to put in the payload (default: credentials.relayBase)
 *   --host/--topic/--write-token/--read-token/--host-token <value>   one-off overrides
 *   --web-base/--web-name <value>  optional payload extras (host web link base / instance name)
 *   --pretty                   indent the JSON output
 *   --json                     machine-readable result for `verify`
 *   --help                     usage
 *
 * Schema: identical to what `deploy/relay-user-add.sh` prints (`v`, `relay`, `host`, `topic`,
 * `writeToken`, `readToken`, `hostToken`) — one payload vocabulary in the project, not two. The file
 * it reads is the same credentials file the plugin reads, so one saved payload configures the host
 * side and is handed to the phone unchanged.
 *
 * `verify` performs read-only checks plus one harmless ntfy test message; it never reads another
 * host's queue and never changes relay state.
 */
import { credentialsPath, loadCredentials } from './credentials.mjs'
import { PAYLOAD_FIELDS, PAYLOAD_VERSION, buildPairingPayload, summarizePayload } from './pairing-lib.mjs'

const USAGE = `usage:
  dsh-push-pair [payload] [options]   print the pairing payload for one user's phone
  dsh-push-pair verify   [options]    check a credentials file against the live relay + ntfy

options:
  --credentials-file <path>   credentials JSON file (default: $DSH_PUSH_CREDENTIALS or
                              ~/.config/dsh-push/credentials.json)
  --relay <url>               relay base written into the payload
  --host <id> --topic <name>  overrides for a one-off payload
  --write-token <tk_...> --read-token <tk_...> --host-token <hk_...>
  --web-base <url>            host-side web base for the #web link (optional; written into the
                              payload so the credentials file carries it too)
  --web-name <name>           friendly instance name for #name (optional)
  --pretty                    indented JSON (payload)
  --json                      machine-readable JSON (verify)
  --help                      this text

payload schema (v${PAYLOAD_VERSION}, same field names as deploy/relay-user-add.sh):
  ${PAYLOAD_FIELDS.join(', ')}

  writeToken = host -> ntfy (this plugin publishes with it)
  readToken  = phone -> ntfy (the App subscribes with it)
  hostToken  = host -> relay queue token
`

/** Tiny `--flag value` / `--flag=value` parser (no dependency, no surprises). */
export function parseArgs(argv = []) {
  const options = { command: 'payload', flags: {}, overrides: {} }
  const aliases = {
    '--credentials-file': 'credentialsFile',
    '--relay': 'relayBase',
    '--host': 'host',
    '--topic': 'topic',
    '--write-token': 'ntfyToken',
    '--read-token': 'phoneToken',
    '--host-token': 'hostToken',
    '--web-base': 'webBase',
    '--web-name': 'webName',
  }
  const booleans = { '--pretty': 'pretty', '--json': 'json', '--help': 'help' }
  const queue = [...argv]
  while (queue.length > 0) {
    const raw = queue.shift()
    if (raw === 'payload' || raw === 'verify') {
      options.command = raw
      continue
    }
    const equals = raw.indexOf('=')
    const flag = equals > 0 ? raw.slice(0, equals) : raw
    if (Object.hasOwn(booleans, flag)) {
      options.flags[booleans[flag]] = equals > 0 ? raw.slice(equals + 1) !== 'false' : true
      continue
    }
    if (Object.hasOwn(aliases, flag)) {
      const value = equals > 0 ? raw.slice(equals + 1) : queue.shift()
      if (value === undefined) throw new Error('missing value for ' + flag)
      options.overrides[aliases[flag]] = value
      continue
    }
    if (raw === '-h') {
      options.flags.help = true
      continue
    }
    throw new Error('unknown argument ' + JSON.stringify(raw))
  }
  return options
}

/** Credentials file + per-invocation overrides. */
export function load(options = {}, env = process.env) {
  const path = credentialsPath({ credentialsFile: options.overrides?.credentialsFile ?? '' }, env)
  const file = loadCredentials(path)
  const credentials = { ...file.value }
  for (const field of ['host', 'topic', 'ntfyToken', 'phoneToken', 'hostToken', 'relayBase', 'webBase', 'webName']) {
    const value = options.overrides?.[field]
    if (typeof value === 'string' && value.trim().length > 0) credentials[field] = value.trim()
  }
  return { path, file, credentials }
}

async function fetchStatus(url, headers = {}) {
  const response = await fetch(url, { headers })
  return response.status
}

/** Read-only relay/ntfy checks; the ntfy test message proves the write token actually publishes. */
export async function verify(options = {}, env = process.env) {
  const { path, file, credentials } = load(options, env)
  const relay = String(credentials.relayBase ?? '').replace(/\/+$/, '')
  const results = []

  if (!file.present) results.push({ check: 'credentials-file', ok: false, detail: 'missing: ' + path })
  else if (file.error !== undefined) results.push({ check: 'credentials-file', ok: false, detail: file.error })
  else results.push({ check: 'credentials-file', ok: true, detail: path })

  const { payload, missing } = buildPairingPayload({ credentials })
  results.push({
    check: 'payload-fields',
    ok: missing.length === 0,
    detail: missing.length === 0 ? summarizePayload(payload) : 'missing: ' + missing.join(', '),
  })

  if (relay.length > 0 && payload.host.length > 0 && payload.hostToken.length > 0) {
    const url = relay + '/answer/pending?host=' + encodeURIComponent(payload.host) + '&_=' + String(Date.now())
    try {
      const status = await fetchStatus(url, { 'X-Host-Token': payload.hostToken })
      results.push({ check: 'relay-host-token', ok: status === 200, detail: 'HTTP ' + String(status) + ' <- ' + url })
    } catch (error) {
      results.push({ check: 'relay-host-token', ok: false, detail: String(error?.message ?? error) })
    }
  } else {
    results.push({ check: 'relay-host-token', ok: false, detail: 'no relay base / host / hostToken to probe' })
  }

  if (relay.length > 0 && payload.topic.length > 0 && payload.readToken.length > 0) {
    const url = relay + '/' + encodeURIComponent(payload.topic) + '/json?poll=1&since=1h&limit=1'
    try {
      const status = await fetchStatus(url, { Authorization: 'Bearer ' + payload.readToken })
      results.push({ check: 'ntfy-read-token', ok: status === 200, detail: 'HTTP ' + String(status) + ' <- ' + url })
    } catch (error) {
      results.push({ check: 'ntfy-read-token', ok: false, detail: String(error?.message ?? error) })
    }
  } else {
    results.push({ check: 'ntfy-read-token', ok: false, detail: 'no relay base / topic / readToken to probe' })
  }

  if (relay.length > 0 && payload.topic.length > 0 && payload.writeToken.length > 0) {
    try {
      const response = await fetch(relay + '/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + payload.writeToken },
        body: JSON.stringify({
          topic: payload.topic,
          title: 'DSH 配对自检',
          message: '配对自检成功（字段名与 relay-user-add.sh 一致：' + PAYLOAD_FIELDS.join(', ') + '）',
          priority: 3,
          tags: ['white_check_mark'],
        }),
      })
      results.push({
        check: 'ntfy-write-token',
        ok: response.status === 200,
        detail: 'HTTP ' + String(response.status) + ' <- POST / topic=' + payload.topic,
      })
    } catch (error) {
      results.push({ check: 'ntfy-write-token', ok: false, detail: String(error?.message ?? error) })
    }
  } else {
    results.push({ check: 'ntfy-write-token', ok: false, detail: 'no relay base / topic / writeToken to probe' })
  }

  const failed = results.filter((entry) => entry.ok !== true)
  return { path, results, failed, payload }
}

export async function main(argv = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr } = {}) {
  const options = parseArgs(argv)
  if (options.flags.help === true || argv.length === 0) {
    stdout.write(USAGE)
    return 0
  }

  if (options.command === 'verify') {
    const report = await verify(options)
    if (options.flags.json === true) {
      stdout.write(JSON.stringify({ path: report.path, results: report.results }, undefined, 2) + '\n')
    } else {
      stdout.write('credentials: ' + report.path + '\n')
      for (const entry of report.results) {
        stdout.write((entry.ok === true ? 'PASS  ' : 'FAIL  ') + entry.check + '  -> ' + entry.detail + '\n')
      }
      stdout.write('\n' + String(report.results.length - report.failed.length) + '/' + String(report.results.length) + ' checks passed\n')
    }
    if (report.failed.length > 0) {
      stderr.write(
        '\nnext steps: on the relay host run `bash relay-user-add.sh <user>`, save the payload it prints as ' +
          report.path + ', then run `dsh-push-pair verify` again (see host-plugin/README.md).\n',
      )
      return 1
    }
    return 0
  }

  const { path, file, credentials } = load(options)
  const { payload, missing } = buildPairingPayload({ credentials })
  if (missing.length > 0) {
    stderr.write(
      'cannot build a complete pairing payload: missing ' + missing.join(', ') + '\n' +
        (file.present ? '' : 'credentials file not found: ' + path + '\n') +
        (file.error === undefined ? '' : file.error + '\n') +
        'provision the user first (on the relay host: `bash relay-user-add.sh <user>`) and save its output as\n' +
        path +
        ', or pass --host/--topic/--write-token/--read-token/--host-token explicitly.\n',
    )
    return 1
  }
  stdout.write(JSON.stringify(payload, undefined, options.flags.pretty === true ? 2 : undefined) + '\n')
  return 0
}

/** True when this module is the process entry point (npm bin shim, `node lib/pairing.mjs`, …). */
function isEntryPoint() {
  const invoked = process.argv[1]
  if (typeof invoked !== 'string' || invoked.length === 0) return false
  const file = invoked.replaceAll('\\', '/').split('/').pop()
  return file === 'pairing.mjs' && import.meta.url.endsWith('/' + file)
}

if (isEntryPoint()) {
  try {
    process.exitCode = await main()
  } catch (error) {
    process.stderr.write('dsh-push-pair: ' + String(error?.message ?? error) + '\n')
    process.exitCode = 1
  }
}
