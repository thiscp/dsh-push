#!/usr/bin/env node
/**
 * relay-queue-roundtrip.mjs — prove the per-host answer queue works end to end on the live relay.
 *
 *   node tools/relay-queue-roundtrip.mjs
 *
 * Env:
 *   DSH_PUSH_PROOF_HOST        host id to use (default: test1)
 *   DSH_PUSH_PROOF_HOST_TOKEN  that host's `hk_` queue token — from `POST /answer/host` (required)
 *   DSH_PUSH_PROOF_REG_TOKEN   relay registration token (optional; without it the register step is
 *                              skipped and the ack of a queue item cannot be shown)
 *   DSH_PUSH_PROOF_RELAY       relay base (default: https://ntfy.cpyh.xyz)
 *
 * What it does, in order — and nothing else:
 *   1. GET  /answer/pending?host=<host>                    with the host token   (baseline)
 *   2. GET  …with a wrong token                                                  (expect 401)
 *   3. POST /answer/register  {callId, questions, hostId}  with the reg token     (needs reg token)
 *   4. GET  /answer/<callId>                                                     (answer page renders)
 *   5. POST /answer/submit    {callId, answers}                                  (queued for the host)
 *   6. GET  /answer/pending   → the item appears                                 (queue round-trip)
 *   7. POST /answer/ack       {host, callIds}                                    (queue left clean)
 *
 * It never publishes a notification, never touches another host, and always acks what it queued.
 */
const relay = String(process.env.DSH_PUSH_PROOF_RELAY ?? 'https://ntfy.cpyh.xyz').replace(/\/+$/, '')
const host = String(process.env.DSH_PUSH_PROOF_HOST ?? 'test1')
const hostToken = String(process.env.DSH_PUSH_PROOF_HOST_TOKEN ?? '').trim()
const regToken = String(process.env.DSH_PUSH_PROOF_REG_TOKEN ?? '').trim()
const callId = 'pairproof-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)

if (hostToken.length === 0) {
  process.stderr.write('need DSH_PUSH_PROOF_HOST_TOKEN (the host\'s hk_ queue token)\n')
  process.exit(2)
}

const results = []
const note = (step, ok, detail) => {
  results.push({ step, ok, detail })
  process.stdout.write((ok === true ? 'PASS  ' : ok === false ? 'FAIL  ' : 'SKIP  ') + step + '  -> ' + detail + '\n')
}

try {
  const base = await fetch(relay + '/answer/pending?host=' + encodeURIComponent(host) + '&_=' + Date.now(), {
    headers: { 'X-Host-Token': hostToken },
  })
  note('pending with host token', base.status === 200, 'HTTP ' + String(base.status))

  const wrong = await fetch(relay + '/answer/pending?host=' + encodeURIComponent(host) + '&_=' + Date.now(), {
    headers: { 'X-Host-Token': 'hk_wrong_' + Math.random().toString(36).slice(2) },
  })
  note('pending with wrong token', wrong.status === 401, 'HTTP ' + String(wrong.status) + ' (expect 401)')

  if (regToken.length === 0) {
    note('register + submit + ack round-trip', undefined, 'no DSH_PUSH_PROOF_REG_TOKEN given, so the relay will not accept a register')
  } else {
    const register = await fetch(relay + '/answer/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Reg-Token': regToken },
      body: JSON.stringify({
        callId,
        agentId: 'pairproof-agent',
        hostId: host,
        ttl: 300,
        questions: [{ id: 'q1', question: 'pairing proof: which one?', options: ['alpha', 'beta'] }],
      }),
    })
    note('register ' + callId, register.status === 200, 'HTTP ' + String(register.status))

    const page = await fetch(relay + '/answer/' + encodeURIComponent(callId))
    const html = await page.text()
    note('answer page renders the question', page.status === 200 && html.includes('alpha'), 'HTTP ' + String(page.status))

    const submit = await fetch(relay + '/answer/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callId, answers: [{ id: 'q1', selected: ['beta'] }] }),
    })
    const submitted = await submit.json()
    note('submit queues for this host', submit.status === 200 && submitted.queued === true && submitted.host === host, JSON.stringify(submitted))

    const after = await fetch(relay + '/answer/pending?host=' + encodeURIComponent(host) + '&_=' + Date.now(), {
      headers: { 'X-Host-Token': hostToken },
    })
    const payload = await after.json()
    const item = (payload.items ?? []).find((entry) => entry.callId === callId)
    note('pending returns the queued item', item !== undefined && item.answers?.[0]?.selected?.[0] === 'beta', JSON.stringify(item ?? payload))

    const ack = await fetch(relay + '/answer/ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Host-Token': hostToken },
      body: JSON.stringify({ host, callIds: [callId] }),
    })
    const acked = await ack.json()
    note('ack cleans the queue', ack.status === 200 && acked.removed === 1, JSON.stringify(acked))

    const final = await fetch(relay + '/answer/pending?host=' + encodeURIComponent(host) + '&_=' + Date.now(), {
      headers: { 'X-Host-Token': hostToken },
    })
    const finalItems = (await final.json()).items ?? []
    note('queue no longer holds the proof item', finalItems.every((entry) => entry.callId !== callId), JSON.stringify(finalItems.map((entry) => entry.callId)))
  }
} catch (error) {
  note('transport', false, String(error?.message ?? error))
}

const failed = results.filter((entry) => entry.ok === false)
const skipped = results.filter((entry) => entry.ok === undefined)
process.stdout.write(
  '\n' + String(results.length - failed.length - skipped.length) + '/' + String(results.length - skipped.length) +
    ' checks passed' + (skipped.length > 0 ? ' (' + String(skipped.length) + ' skipped)' : '') + '\n',
)
process.exitCode = failed.length === 0 ? 0 : 1
