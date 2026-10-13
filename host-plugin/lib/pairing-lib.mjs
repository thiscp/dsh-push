/**
 * Pairing payload helpers for the DSH push host plugin (pure functions; no I/O).
 *
 * `deploy/relay-user-add.sh <user>` already emits the pairing payload the phone needs; this module
 * emits the *same schema with the same field names* from the host side, so the project has exactly
 * one payload vocabulary:
 *
 *   { "v": 1, "relay": "<relay base>", "host": "<hostId>", "topic": "<ntfy topic>",
 *     "writeToken": "tk_…",   // host  → ntfy (this plugin publishes with it)
 *     "readToken":  "tk_…",   // phone → ntfy (the App subscribes with it)
 *     "hostToken":  "hk_…" }  // host  → relay queue
 *
 * `buildPairingPayload` never invents values: every field comes from the credentials file (or, for
 * `relay`, from the relay base the host will actually use), and a payload with a missing field is
 * reported through `missing` instead of being emitted half-empty.
 */

/** Field order, identical to the payload `relay-user-add.sh` prints. */
export const PAYLOAD_FIELDS = ['v', 'relay', 'host', 'topic', 'writeToken', 'readToken', 'hostToken']

/** Payload schema version — the `v` that `relay-user-add.sh` writes. */
export const PAYLOAD_VERSION = 1

/**
 * @param sources `{ credentials, relayBase }` (credentials use credentials-file vocabulary).
 * @returns `{ payload, missing }`; `missing` lists the payload fields that could not be filled.
 */
export function buildPairingPayload(sources = {}) {
  const credentials = sources.credentials ?? {}
  const candidates = {
    relay: String(sources.relayBase ?? credentials.relayBase ?? '').replace(/\/+$/, ''),
    host: String(credentials.host ?? '').trim(),
    topic: String(credentials.topic ?? '').trim(),
    writeToken: String(credentials.ntfyToken ?? '').trim(),
    readToken: String(credentials.phoneToken ?? '').trim(),
    hostToken: String(credentials.hostToken ?? '').trim(),
  }
  const missing = Object.keys(candidates).filter((field) => candidates[field].length === 0)
  return { payload: { v: PAYLOAD_VERSION, ...candidates }, missing }
}

/** Human-readable one-liner for the operator's terminal (tokens shortened). */
export function summarizePayload(payload) {
  const short = (value, keep = 10) => {
    const text = String(value ?? '')
    return text.length > keep ? text.slice(0, keep) + '…' : text
  }
  return (
    'host=' + String(payload?.host ?? '') +
    ' topic=' + String(payload?.topic ?? '') +
    ' relay=' + String(payload?.relay ?? '') +
    ' writeToken=' + short(payload?.writeToken) +
    ' readToken=' + short(payload?.readToken) +
    ' hostToken=' + short(payload?.hostToken)
  )
}
