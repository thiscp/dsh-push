/**
 * Relay client for the DSH push host plugin.
 *
 * Two directions:
 *  - push:   POST <relay>/            (ntfy JSON publish, write token)
 *            POST <relay>/answer/register   (tell the relay a question is pending, with hostId)
 *  - answer: GET  <relay>/answer/pending?host=<id>   (poll, X-Host-Token)
 *            POST <relay>/answer/ack                (remove delivered answers)
 *
 * The poll direction is outbound-only on purpose: a host behind NAT needs no inbound port and the
 * relay never has to reach it (this replaced the old DSH-cookie bridge).
 */

export class RelayClient {
  constructor(config) {
    this.base = config.relayBase.replace(/\/+$/, '');
    this.host = config.host;
    this.hostToken = config.hostToken;
    this.regToken = config.regToken;
    this.ntfyToken = config.ntfyToken;
    this.topic = config.topic;
    this.fetchImpl = config.fetch ?? globalThis.fetch;
  }

  async #json(res) {
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { ok: false, raw: text.slice(0, 200) }; }
  }

  /**
   * Publish a notification to the phone through ntfy (same JSON body shape the app expects).
   *
   * `priority` MUST be an integer 1-5. ntfy's JSON body only accepts numbers here: passing the
   * string 'default' (which is what ntfy's *header* form uses) makes the server answer
   * 400 `invalid request: request body must be valid JSON` — a message that points nowhere near
   * the real cause. Callers inside this plugin always pass 1/3/4; the default used to be the
   * string 'default', which broke every caller that omitted it.
   */
  async push({ title, body, click, priority = 3, tags = [] }) {
    const r = await this.fetchImpl(this.base + '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.ntfyToken },
      body: JSON.stringify({ topic: this.topic, title, message: body, priority, click, tags }),
    });
    return { status: r.status, ...(await this.#json(r)) };
  }

  /** Register a pending question so the phone can answer it; the relay queues the reply for us. */
  async register({ callId, agentId, questions, ttl = 86400 }) {
    const r = await this.fetchImpl(this.base + '/answer/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Reg-Token': this.regToken },
      body: JSON.stringify({ callId, agentId, questions, hostId: this.host, ttl }),
    });
    return { status: r.status };
  }

  /** Poll for answers addressed to this host. Returns [] when idle. */
  async pending() {
    // The `_` cache-buster is not cosmetic: DSH's fetch runs through its own proxy layer, and
    // an identical GET URL that had been polled before kept coming back as the FIRST response
    // (observed 2026-10-12: the relay queue grew while the plugin kept seeing one stale item).
    // A unique query string keeps every poll a distinct request.
    const url = this.base + '/answer/pending?host=' + encodeURIComponent(this.host) + '&_=' + String(Date.now());
    const r = await this.fetchImpl(url, { headers: { 'X-Host-Token': this.hostToken } });
    if (r.status !== 200) return [];
    const j = await this.#json(r);
    return Array.isArray(j.items) ? j.items : [];
  }

  /** Confirm delivery so the relay drops them (at-least-once; the caller dedupes by callId). */
  async ack(callIds) {
    const r = await this.fetchImpl(this.base + '/answer/ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Host-Token': this.hostToken },
      body: JSON.stringify({ host: this.host, callIds }),
    });
    return { status: r.status, ...(await this.#json(r)) };
  }

  /** Long-running poll loop; `onAnswer(item)` may throw — the item is acked only when it returns. */
  async runAnswerLoop(onAnswer, { intervalMs = 3000, log = console.log } = {}) {
    for (;;) {
      try {
        for (const item of await this.pending()) {
          try {
            await onAnswer(item);
            await this.ack([item.callId]);
            log('[relay] answered ' + item.callId);
          } catch (e) {
            log('[relay] answer failed for ' + item.callId + ': ' + (e?.message ?? e));
          }
        }
      } catch (e) {
        log('[relay] poll failed: ' + (e?.message ?? e));
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}
