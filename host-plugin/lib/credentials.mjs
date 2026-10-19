/**
 * Credentials for the DSH push host plugin.
 *
 * One file carries a whole user's push channel, so an operator never has to keep three secrets in
 * environment variables (and never has to edit a YAML with secrets in it):
 *
 *   ~/.config/dsh-push/credentials.json
 *
 * The natural way to create it is to save the **pairing payload** that
 * `deploy/relay-user-add.sh <user>` printed, or to run the plugin's own `dsh-push-pair` command,
 * which writes the same shape. Both are accepted verbatim:
 *
 *   { "v": 1, "relay": "https://ntfy.cpyh.xyz", "host": "alice", "topic": "dsh-alice",
 *     "writeToken": "tk_…",     // ← this host publishes with it   (plugin side)
 *     "readToken": "tk_…",      // ← the phone subscribes with it    (phone side)
 *     "hostToken": "hk_…" }     // ← relay queue token               (plugin side)
 *
 * Field names are matched case-insensitively, in this order:
 *
 *   hostToken  → hostToken
 *   writeToken → ntfyToken   (also accepted: ntfyToken, pushToken, publishToken, tkWrite, tkPub)
 *   readToken  → phoneToken  (also accepted: phoneToken, tkRead, tkPhone) — informational only;
 *                              the plugin never reads the topic, only the phone does
 *   regToken   → regToken    (also accepted: registrationToken) — the relay's registration
 *                              secret (`/etc/answer-relay/regtoken`), used as `X-Reg-Token`
 *                              by `POST /answer/register`
 *   relay      → relayBase   (also: relayBase, base)
 *   host / hostId, topic
 *   webBase / webName / answerBase / pollIntervalMs / credentialsFile (optional extras)
 *
 * Nested form (one file, several hosts) is also accepted; the root fields act as defaults:
 *
 *   { "relay": "https://ntfy.cpyh.xyz", "host": "alice",
 *     "hosts": { "alice": { "topic": "dsh-alice", "writeToken": "tk_…",
 *                           "readToken": "tk_…", "hostToken": "hk_…" } } }
 *
 * Layering (later wins), resolved by `resolvePluginConfig` in `lib/index.js`:
 *
 *   built-in defaults  →  credentials file  →  profile/overlay config  →  environment variables
 *
 * A missing file is a clean no-op (empty credentials, no log line at all): a profile that has no
 * credentials degrades to the transparent listener it already is. An unreadable or malformed file
 * is reported — the operator must be able to tell "not set up yet" from "set up but broken".
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Default credentials location, anchored to the user's home directory.
 *
 * The `~` is load-bearing (2026-10-13): this used to be the bare relative path
 * `.config/dsh-push/credentials.json`, which `expandHome` fed to `path.resolve()` and therefore
 * resolved against the **process cwd**, not the home directory. The production Web host happens to
 * run with cwd = `C:\Users\<user>`, so it found the file and nobody noticed; a DSH started from any
 * other directory (a workspace, the repo, a shortcut's "start in", …) silently lost its credentials
 * and degraded to the transparent no-op — i.e. the phone just goes quiet, with no error anywhere,
 * which is the worst possible failure signature for a push channel. A relative path a user writes
 * into `credentialsFile` still resolves against the cwd exactly as before; only the *default* is
 * now home-anchored.
 */
export const CREDENTIALS_FILE = '~/.config/dsh-push/credentials.json'

/** Env var that overrides the credentials file location (used by ops and by the self-test). */
export const CREDENTIALS_ENV = 'DSH_PUSH_CREDENTIALS'

/** The three tokens, in the vocabulary this plugin uses, mapped to the accepted file keys. */
export const CREDENTIAL_KEYS = {
  hostToken: ['hosttoken'],
  // 2026-10-12 (production cutover): the relay's registration secret was missing from this table
  // even though `CREDENTIAL_CONFIG_KEYS` in lib/index.js had been taught about it, so
  // `parseCredentials` never produced a `regToken` and `X-Reg-Token` went out empty ->
  // `POST /answer/register` answered `401 bad reg token` on a perfectly good credentials file.
  // The two lists have to stay in sync: index.js decides *which* keys may come from the file,
  // this table decides which file keys are *read* in the first place.
  regToken: ['regtoken', 'registrationtoken'],
  ntfyToken: ['ntfytoken', 'writetoken', 'pushtoken', 'publishtoken', 'tkwrite', 'tkpub'],
  phoneToken: ['phonetoken', 'readtoken', 'tkread', 'tkphone'],
  host: ['host', 'hostid'],
  topic: ['topic'],
  relayBase: ['relaybase', 'relay', 'base'],
  answerBase: ['answerbase'],
  webBase: ['webbase'],
  webName: ['webname'],
  pollIntervalMs: ['pollintervalms'],
  credentialsFile: ['credentialsfile'],
  // 2026-10-17 (v0.3.0 发号面板)：同一个坑又踩一次——provisionToken/provisionBase 加进了
  // index.js 的 CREDENTIAL_CONFIG_KEYS，却没进这张表，于是 parseCredentials 根本不读它，
  // 面板回「缺少发号密钥」而文件里明明有（真机实测）。webLog 是同一类潜在漏，一并补上。
  // 现在 selftest 有一条断言比对两张清单，漏一个就 FAIL。
  provisionToken: ['provisiontoken'],
  provisionBase: ['provisionbase'],
  webLog: ['weblog'],
}

/** Keys that hold secrets: they are never echoed back in logs or diagnostic output. */
export const SECRET_KEYS = ['hostToken', 'ntfyToken', 'phoneToken', 'regToken', 'provisionToken']

/** `~` / `~/x` / `~\x` → the real home path; everything else resolves against `base`. */
export function expandHome(input, home = homedir()) {
  const text = String(input ?? '').trim()
  if (text.length === 0) return ''
  if (text === '~') return home
  if (text.startsWith('~/') || text.startsWith('~\\')) return join(home, text.slice(2))
  return resolve(text)
}

/** `env.DSH_PUSH_CREDENTIALS` else `~/.config/dsh-push/credentials.json`. */
export function credentialsPath(config = {}, env = process.env, home = homedir()) {
  const configured = String(config.credentialsFile ?? '').trim()
  const fromEnv = String(env[CREDENTIALS_ENV] ?? '').trim()
  return expandHome(configured.length > 0 ? configured : (fromEnv.length > 0 ? fromEnv : CREDENTIALS_FILE), home)
}

function asString(value) {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
}

function pick(object, keys) {
  for (const key of keys) {
    const value = asString(object[key])
    if (value.length > 0) return value
  }
  return ''
}

function pickNumber(object, keys) {
  const text = pick(object, keys)
  if (text.length === 0) return undefined
  const value = Number(text)
  return Number.isFinite(value) ? value : undefined
}

/** Lower-case every key of a plain object (tolerates `HostToken`, `host_token`, …). */
function normalizeKeys(object) {
  const out = {}
  if (object === null || typeof object !== 'object' || Array.isArray(object)) return out
  for (const [key, value] of Object.entries(object)) out[String(key).toLowerCase().replace(/[_-]/g, '')] = value
  return out
}

/** Project one normalized object (root or a single host entry) into plugin vocabulary. */
function projectEntry(normalized) {
  const out = {}
  for (const [field, keys] of Object.entries(CREDENTIAL_KEYS)) {
    if (field === 'pollIntervalMs') {
      const value = pickNumber(normalized, keys)
      if (value !== undefined) out[field] = value
      continue
    }
    const value = pick(normalized, keys)
    if (value.length > 0) out[field] = value
  }
  return out
}

/**
 * Parse credentials text (pure; exported for the self-test).
 * @returns `{ value, error }`: `value` is always an object (possibly empty); `error` is a message
 *   when the text was present but unusable.
 */
export function parseCredentials(text, { source = CREDENTIALS_FILE } = {}) {
  if (typeof text !== 'string' || text.trim().length === 0) return { value: {}, error: undefined }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { value: {}, error: `${source} is not valid JSON (${error?.message ?? error})` }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { value: {}, error: `${source} must contain a JSON object` }
  }
  const root = normalizeKeys(parsed)
  const base = projectEntry(root)
  const hosts = root.hosts ?? root.hostentries ?? root.credentials
  if (hosts === null || typeof hosts !== 'object' || Array.isArray(hosts)) return { value: base, error: undefined }

  const wanted = asString(base.host)
  const names = Object.keys(hosts)
  const chosen = wanted.length > 0 && Object.hasOwn(hosts, wanted) ? wanted : names[0]
  if (chosen === undefined) return { value: base, error: undefined }
  const entry = projectEntry(normalizeKeys(hosts[chosen]))
  // Root fields are defaults for every host entry; the entry itself wins.
  return { value: { ...base, host: entry.host || wanted || names[0] || '', ...entry }, error: undefined }
}

/**
 * Load credentials for real: missing file → clean no-op, broken file → reported.
 * @returns `{ value, path, present, error }`.
 */
export function loadCredentials(path, { readFile = readFileSync } = {}) {
  let text
  try {
    text = readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return { value: {}, path, present: false, error: undefined }
    }
    return { value: {}, path, present: true, error: `cannot read ${path} (${error?.code ?? error?.message ?? error})` }
  }
  const { value, error } = parseCredentials(text, { source: path })
  return { value, path, present: true, error }
}

/** Log one line per problem through the supplied sink (the plugin passes its own logger). */
export function reportCredentials(result, log = () => {}) {
  if (result.error !== undefined) log('credentials ignored: ' + result.error)
}

/** `[name, value]` pairs for diagnostics: secrets are masked, never printed. */
export function describeSecrets(values) {
  return SECRET_KEYS.filter((key) => typeof values?.[key] === 'string' && values[key].length > 0).map(
    (key) => key + '=' + values[key].slice(0, 3) + '…(' + String(values[key].length) + ' chars)',
  )
}
