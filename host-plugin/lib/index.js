/**
 * dsh-push-host — in-process DSH host plugin: question notifications to the phone, plus
 * phone answers for questions the agent has already given up waiting on (`continued`).
 *
 * Design (2026-10-12, "A path"): the plugin lives INSIDE the DSH host and uses DSH's own
 * question seam instead of an out-of-process HTTP/WS bridge.
 *
 *   1. notification layer — it claims the host waterfall `user-questions/request`
 *      (`inject: ['userQuestions']`, prepended listener), pushes the question to ntfy and
 *      registers it at the answer relay, then returns `next()`: the foreground answering
 *      right stays with the Web UI, which keeps working exactly as before.
 *   2. late-answer layer — a poll loop drains the relay's per-host queue
 *      (`lib/relay.js`); each answer is applied with
 *      `ctx.userQuestions.answer(liveRootAgent, callId, { answers })`, which steers a
 *      `user-question-reply` user message into the agent. This route only exists for
 *      questions whose foreground wait already ended, i.e. questions asked with the timed
 *      tool (see "timed" below).
 *
 * Nothing here talks to DSH's Web API: no cookie, no `/api/remote.mux`, no RPC.
 *
 * `request.wait?.timed` (the probe that decides whether the late-answer layer can ever
 * fire): `askTimed()` sets `wait = { callId, timed: true }` and only that shape folds into
 * the session projection, which is where `answer()` looks the question up. `ask_user_question`
 * reaches it only when `tool-ask-user` runs with `mode: timed`; in the shipped default
 * (`mode: legacy`) `wait` carries just `callId`, no question ever folds, `answer()` always
 * returns false and a phone answer can only be applied through the Web UI. We therefore log
 * `timed=` for every question and refuse (loudly, once) to apply a phone answer to a
 * legacy-mode question instead of silently acking it.
 *
 * Credentials (v0.1.0): the three secrets come from a **credentials file** first and environment
 * variables second, so a real user is onboarded by saving the pairing payload
 * `deploy/relay-user-add.sh <user>` printed (or `npx dsh-push-pair` output) as
 * `~/.config/dsh-push/credentials.json` and never touching env vars. Layering, later wins:
 *
 *   defaults → credentials file → profile/overlay config → environment variables
 *
 * A missing credentials file is a clean no-op (it does not even log), which keeps the plugin a
 * transparent listener; an unreadable/broken one is logged once and otherwise ignored. Env-var-only
 * setups (`DSH_PUSH_HOST_TOKEN` / `DSH_PUSH_REG_TOKEN` / `DSH_PUSH_NTFY_TOKEN`) keep working
 * unchanged, because the environment still outranks the file.
 *
 * @module dsh-push-host
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import { RelayClient } from './relay.js'
import { credentialsPath, loadCredentials } from './credentials.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-push-host'

/**
 * `userQuestions` owns the `user-questions/request` waterfall; `timer` mixes
 * `ctx.interval` / `ctx.timeout` onto the context (auto-disposed with this plugin).
 */
export const inject = ['userQuestions', 'timer']

/** Shipped relay base (a self-hosted ntfy + answer relay); every field below has a default. */
export const RELAY_DEFAULT = 'https://ntfy.cpyh.xyz'

/** Every field has a default, so mounting without config can never break a boot. */
const DEFAULTS = {
  relayBase: RELAY_DEFAULT,
  topic: 'dsh',
  host: '',
  hostToken: '',
  hostTokenEnv: 'DSH_PUSH_HOST_TOKEN',
  regToken: '',
  regTokenEnv: 'DSH_PUSH_REG_TOKEN',
  ntfyToken: '',
  phoneToken: '',
  ntfyTokenEnv: 'DSH_PUSH_NTFY_TOKEN',
  credentialsFile: '',
  webLog: join(homedir(), '.dsh', 'web.log'),
  webBase: '',
  webName: '',
  answerBase: '',
  pollIntervalMs: 3000,
  pushQuestions: true,
  notifyTurns: true,
  echoAnswers: true,
  claimForeground: false,
  log: true,
}

/** Config keys (schema/overlay vocabulary) = the defaults above. */
const CONFIG_KEYS = Object.keys(DEFAULTS)

/** Declared schema (loader diagnostics / `--dump-config-schema`). */
export const Config = z.object({
  /** Relay base URL (also serves the phone's `/answer/<callId>` page). */
  relayBase: z.string().default('https://ntfy.cpyh.xyz'),
  /** ntfy topic this host publishes to and the phone subscribes to. */
  topic: z.string().default('dsh'),
  /** Host id provisioned by `deploy/relay-user-add.sh` (empty disables the relay side). */
  host: z.string().default(''),
  /** `hk_…` host token for the queue endpoints; prefer `hostTokenEnv`. */
  hostToken: z.string().default(''),
  hostTokenEnv: z.string().default('DSH_PUSH_HOST_TOKEN'),
  /** Relay registration token (`/etc/answer-relay/regtoken`); prefer `regTokenEnv`. */
  regToken: z.string().default(''),
  regTokenEnv: z.string().default('DSH_PUSH_REG_TOKEN'),
  /** ntfy write token of the host user (`tk_…`); prefer `ntfyTokenEnv`. */
  ntfyToken: z.string().default(''),
  ntfyTokenEnv: z.string().default('DSH_PUSH_NTFY_TOKEN'),
  /** ntfy read token of the phone user (`tk_…`): not used here, carried for the pairing payload. */
  phoneToken: z.string().default(''),
  /** Credentials file; empty = `$DSH_PUSH_CREDENTIALS` else `~/.config/dsh-push/credentials.json`. */
  credentialsFile: z.string().default(''),
  /** Where DSH writes its Web URL + token; only used for the `#web` trailer. */
  webLog: z.string().default(join(homedir(), '.dsh', 'web.log')),
  /** Tailnet-facing Web base used to rebuild the `#web` link (empty = use the web.log URL as-is). */
  webBase: z.string().default(''),
  /** Friendly instance name appended as `#name` (multi-DSH chooser on the phone). */
  webName: z.string().default(''),
  /** Base for the phone's answer page; defaults to `relayBase`. */
  answerBase: z.string().default(''),
  /** Relay queue poll cadence. */
  pollIntervalMs: z.number().step(1).min(500).max(60000).default(3000),
  /** Push a notification for every pending question. */
  pushQuestions: z.boolean().default(true),
  /** Send the silent `#ans` echo once an answer is delivered (clears the phone card). */
  echoAnswers: z.boolean().default(true),
  /**
   * Opt-in: hold the foreground waterfall open and race the phone against the Web UI.
   * Off by default — the Web UI owns foreground answering (see the module doc).
   */
  claimForeground: z.boolean().default(false),
  /** Print diagnostics through ctx.logger + console. */
  log: z.boolean().default(true),
})

/** `[{label, description?}]` (service vocabulary) → `[label]` (what the relay/phone render). */
function optionLabels(question) {
  return (question.options ?? [])
    .map((option) => (typeof option === 'string' ? option : option?.label))
    .filter((label) => typeof label === 'string' && label.length > 0)
}

/** Project the service's camelCase questions into the relay's `{id, question, options:[str]}`. */
function relayQuestions(questions) {
  return questions.map((question, index) => ({
    id: typeof question?.id === 'string' && question.id.length > 0 ? question.id : 'q' + String(index),
    question: typeof question?.question === 'string' ? question.question : '',
    options: optionLabels(question ?? {}),
  }))
}

/** One human-readable line per answer, the same shape the hook and the relay echo use. */
function answerSummary(answers) {
  const parts = []
  for (const answer of answers ?? []) {
    if (answer === null || typeof answer !== 'object') continue
    const selected = Array.isArray(answer.selected) ? answer.selected : []
    const text = selected.length > 0 ? String(selected[0]) : String(answer.custom ?? '')
    if (text.length > 0) parts.push(text)
  }
  return parts.join(' / ')
}

/** The tool result of a question call: `{pending:true}` means the wait timed out unanswered. */
function resultValue(result) {
  return result !== null && typeof result === 'object' && 'value' in result ? result.value : result
}

/** First error that carries a service code (NO_PROVIDER / ASK_TIMED_OUT …) wins the report. */
function preferCodedError(errors) {
  return errors.find((error) => typeof error?.code === 'string') ?? errors[0]
}

class PushHost {
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config
    this.relay = new RelayClient({
      relayBase: config.relayBase,
      host: config.host,
      hostToken: config.hostToken,
      regToken: config.regToken,
      ntfyToken: config.ntfyToken,
      topic: config.topic,
    })
    /** callIds whose foreground waterfall we hold (only when claimForeground). */
    this.waiters = new Map()
    /** callId → { questions (relay shape), timed, ts, echoed }. */
    this.questions = new Map()
    /** `sessionId:turn` → timestamp, so one turn pushes once (the Stop-hook dedupe). */
    this.turns = new Map()
    /** callId → `{ ts, timed }`: one push per question, plus the value we actually logged. */
    this.announced = new Map()
    /** callId → timestamp of the last complaint we logged (log throttling). */
    this.complained = new Map()
    this.polling = false
    /** Last poll's callId set, so the queue line is printed only when it changes. */
    this.lastQueue = ''
  }

  get enabled() {
    return this.config.host.length > 0 && this.config.hostToken.length > 0
  }

  log(message) {
    if (this.config.log !== true) return
    try {
      this.ctx.logger('dsh-push-host').info(message)
    } catch {
      /* ctx.logger is not wired in a bare profile */
    }
    console.log('[dsh-push-host] ' + message)
  }

  start() {
    if (!this.enabled) {
      this.log('relay disabled (set host + hostToken, or DSH_PUSH_HOST_TOKEN): push/answer off')
      return
    }
    this.ctx.interval(() => {
      void this.pollOnce()
    }, this.config.pollIntervalMs)
    this.log(
      'relay ready host=' + this.config.host +
      ' topic=' + this.config.topic +
      ' poll=' + String(this.config.pollIntervalMs) + 'ms' +
      (this.config.claimForeground === true ? ' claimForeground=on' : ''),
    )
  }

  stop() {
    this.waiters.clear()
    this.questions.clear()
    this.announced.clear()
    this.complained.clear()
    this.turns.clear()
  }

  // ── notification layer ───────────────────────────────────────────────────────────

  /**
   * The `user-questions/request` listener. Notify, then hand the request back to the chain
   * (the Web UI answerer) — `next()` is what keeps browser answering untouched.
   */
  onRequest(request, next) {
    const questions = Array.isArray(request?.questions) ? request.questions : []
    if (questions.length === 0) return next()
    if (!this.enabled || this.config.pushQuestions !== true) return next()

    const callId = request.wait?.callId ?? 'pq-' + randomUUID()
    const agentId = request.agent?.id ?? ''
    const sessionId = request.agent?.session?.id ?? agentId
    const timed = request.wait?.timed === true
    void this.announce({ callId, agentId, sessionId, timed, questions })

    if (this.config.claimForeground !== true) return next()
    return this.firstOf([this.hold(callId, request), Promise.resolve().then(() => next())], request.signal, callId)
  }

  /** Push + register, fire and forget: a network hiccup must never block a question. */
  async announce({ callId, agentId, sessionId, timed, questions }) {
    const registered = relayQuestions(questions)
    const now = Date.now()
    const previous = this.announced.get(callId)
    if (previous !== undefined && now - previous.ts < 3600_000) {
      // The `tools/pre-execute` fallback usually fires FIRST and can only *guess* `timed` from
      // the tool arguments (`args.timeout`); a timed-mode call that omitted the optional timeout
      // argument is guessed as `false`, and the authoritative `user-questions/request` waterfall
      // (which sees `wait.timed`) lands here second and is deduped. Keep the log honest instead of
      // leaving a wrong `timed=false` line as the only evidence.
      if (previous.timed !== true && timed === true) {
        this.announced.set(callId, { ts: now, timed })
        this.log('question ' + callId + ' timed corrected to true by the request waterfall (the pre-execute guess had no timeout argument)')
      }
      this.questions.set(callId, { questions: registered, timed, ts: now, echoed: false })
      return
    }
    this.announced.set(callId, { ts: now, timed })
    this.sweep()
    this.questions.set(callId, { questions: registered, timed, ts: now, echoed: false })
    this.log(
      'question ' + callId + ' agent=' + (agentId || '(none)') + ' timed=' + String(timed) +
      ' q=' + JSON.stringify(registered.map((question) => question.id)),
    )
    if (!timed) {
      this.log(
        'note: ' + callId + ' has no timed wait, so it never enters the session projection — ' +
        'a phone answer cannot be applied to it (only the Web UI can answer). ' +
        'Switch tool-ask-user to mode: timed to make phone answering work for late answers.',
      )
    }
    try {
      const result = await this.relay.register({ callId, agentId, questions: registered, ttl: 86400 })
      // Log the success too: without a positive line, "the phone can answer this" is only visible
      // as the *absence* of the 401 line, which is exactly how tonight's 401 hid in plain sight.
      this.log('register ' + callId + ' -> HTTP ' + String(result.status))
    } catch (error) {
      this.log('register failed for ' + callId + ': ' + String(error?.message ?? error))
    }
    try {
      await this.relay.push({
        title: 'DSH 等你选择 [' + String(sessionId).slice(-8) + ']',
        body: this.questionBody(callId, registered),
        priority: 4,
      })
    } catch (error) {
      this.log('push failed for ' + callId + ': ' + String(error?.message ?? error))
    }
  }

  /** The phone renders this body: question, options, answer link, then machine trailers. */
  questionBody(callId, questions) {
    const first = questions[0] ?? { id: 'q0', question: '', options: [] }
    const labels = (first.options ?? []).filter((label) => typeof label === 'string')
    let body = (first.question || 'DSH 正在等你选择') + (labels.length > 0 ? '\n→ ' + labels.slice(0, 3).join(' / ') : '')
    body += '\n📱 作答: ' + this.answerUrl(callId)
    body += '\n#qid ' + first.id
    if (
      questions.length === 1 &&
      labels.length >= 2 &&
      labels.length <= 3 &&
      labels.every((label) => !/[|=#\n]/.test(label))
    ) {
      body += '\n#opts ' + first.id + '=' + labels.join('|')
    }
    const web = this.webUrl()
    if (web.length > 0) body += '\n#web ' + web
    const friendly = this.config.webName.trim()
    if (friendly.length > 0) body += '\n#name ' + friendly.replace(/\n/g, ' ')
    return body
  }

  answerUrl(callId) {
    const base = (this.config.answerBase || this.config.relayBase).replace(/\/+$/, '')
    return base + '/answer/' + encodeURIComponent(callId)
  }

  /**
   * `#web` trailer: the last `?token=` URL DSH printed to web.log.
   *
   * With `webBase` set the link is rehosted onto that base (the address the phone can actually
   * reach). With `webBase` empty the logged URL is used as-is (v0.1.1): a fresh install then still
   * ships a web entry instead of silently dropping it — reachable exactly as far as whatever
   * address DSH bound to, which is precisely what `webBase` exists to override.
   */
  webUrl() {
    const base = this.config.webBase.trim()
    const file = this.config.webLog.length > 0 ? this.config.webLog : join(homedir(), '.dsh', 'web.log')
    try {
      const text = readFileSync(file, 'utf8')
      const matches = [...text.matchAll(/dsh web: (http:\/\/\S+[?&]token=\S+)/g)]
      if (matches.length === 0) return ''
      const logged = matches[matches.length - 1][1]
      if (base.length === 0) return logged
      const token = /[?&]token=(\S+)/.exec(logged)?.[1] ?? ''
      return base.replace(/\/+$/, '') + '/?token=' + token
    } catch (error) {
      this.log('web.log unreadable (' + file + '): ' + String(error?.message ?? error))
      return ''
    }
  }

  // ── turn-end notification + answer echo (Stop / PostToolUse parity) ──────────────

  /**
   * `tools/pre-execute` is the PreToolUse seam — a second, ordering-independent trigger for
   * the notification. The waterfall trigger above can be jumped by another answerer that
   * prepends *after* this plugin loads (a later prepend wins the head) and answers without
   * calling `next()`; in that case the `user-questions/request` listener never runs. Both
   * triggers announce the same `exec.callId`, and `announce()` dedupes on it, so the usual
   * case still pushes exactly once (and the waterfall path, which knows `wait.timed`, gets
   * to refresh the entry).
   */
  onPreExecute(exec, next) {
    try {
      const callId = String(exec?.callId ?? '')
      if (callId.length > 0 && this.enabled === true && this.config.pushQuestions === true && !this.questions.has(callId)) {
        const args = exec?.arguments ?? {}
        const agent = exec?.agent
        const common = {
          callId,
          agentId: String(agent?.id ?? ''),
          sessionId: String(agent?.session?.header?.id ?? ''),
          // The tool is the only place the timeout argument is visible before the wait opens;
          // `-1` is the tool's "block forever" sentinel, anything else asks `askTimed`.
          timed: typeof args.timeout === 'number' && args.timeout !== -1,
        }
        if (Array.isArray(args.questions) && args.questions.length > 0) {
          void this.announce({ ...common, questions: args.questions })
        } else if (typeof args.plan === 'string' && args.plan.length > 0) {
          void this.announce({ ...common, questions: [{ id: 'plan', question: args.plan, options: [] }] })
        }
      }
    } catch (error) {
      this.log('pre-execute notify failed: ' + String(error?.message ?? error))
    }
    return next()
  }

  /**
   * `agent/turn-stopping` is the in-process event behind the Claude-Code `Stop` hook
   * (`dsh-hooks-claude-code/lib/index.js:292`), so "DSH 任务结束" needs no hook script.
   * Fire and forget — a dead relay must never block a turn from ending.
   */
  onTurnStopping(payload) {
    if (this.enabled !== true || this.config.notifyTurns !== true) return
    const session = payload?.agent?.session
    const sessionId = String(session?.header?.id ?? '')
    if (sessionId.length === 0) return
    const key = sessionId + ':' + String(payload?.turn ?? '')
    if (this.turns.has(key)) return
    this.turns.set(key, Date.now())
    this.sweepTurns()

    let body = '目录: ' + String(session?.header?.cwd ?? '')
    const web = this.webUrl()
    if (web.length > 0) body += '\n#web ' + web
    const friendly = this.config.webName.trim()
    if (friendly.length > 0) body += '\n#name ' + friendly.replace(/\n/g, ' ')
    void this.relay
      .push({ title: 'DSH 任务结束 [' + sessionId.slice(-8) + ']', body, priority: 3 })
      .then((result) => {
        if (result?.status !== 200) this.log('turn push -> HTTP ' + String(result?.status))
      })
      .catch((error) => this.log('turn push failed: ' + String(error?.message ?? error)))
  }

  /**
   * `tools/post-execute` is the PostToolUse seam. For a question we pushed: an answered
   * result echoes `#ans` so the phone clears the card; a `pending` result (timed wait expired
   * unanswered) must NOT clear it, because that question is still answerable from the phone.
   */
  onPostExecute(exec, result, next) {
    try {
      const callId = String(exec?.callId ?? '')
      const entry = this.questions.get(callId)
      if (entry !== undefined && this.config.echoAnswers === true) {
        const value = resultValue(result)
        if (value?.pending === true) {
          this.log('question ' + callId + ' returned pending; the phone card stays answerable')
        } else if (entry.echoed !== true) {
          entry.echoed = true
          void this.echo(callId, Array.isArray(value?.answers) ? value.answers : [])
        }
      }
    } catch (error) {
      this.log('post-execute echo failed: ' + String(error?.message ?? error))
    }
    return next()
  }

  sweepTurns() {
    const now = Date.now()
    for (const [key, ts] of this.turns) if (now - ts > 6 * 3600_000) this.turns.delete(key)
  }

  // ── foreground claim (opt-in only) ───────────────────────────────────────────────

  /** Register a waiter the poll loop can settle with the phone's answer. */
  hold(callId, request) {
    let resolvePhone = () => {}
    const promise = new Promise((resolve) => {
      resolvePhone = resolve
    })
    this.waiters.set(callId, {
      resolve: (answers) => resolvePhone({ answers }),
      agent: request.agent,
      since: Date.now(),
    })
    return promise
  }

  /**
   * Resolve with the first fulfilment; reject once every candidate failed (keeping the most
   * informative error) or when the question is aborted.
   */
  firstOf(candidates, signal, callId) {
    return new Promise((resolve, reject) => {
      let settled = false
      const errors = []
      const finish = (run) => {
        if (settled) return
        settled = true
        this.waiters.delete(callId)
        try {
          signal?.removeEventListener?.('abort', onAbort)
        } catch {
          /* not an EventTarget */
        }
        run()
      }
      const onAbort = () => finish(() => reject(signal?.reason ?? new Error('question aborted')))
      if (signal?.aborted) return onAbort()
      signal?.addEventListener?.('abort', onAbort, { once: true })
      for (const candidate of candidates) {
        Promise.resolve(candidate).then(
          (value) => finish(() => resolve(value)),
          (error) => {
            if (settled) return
            errors.push(error)
            if (errors.length === candidates.length) finish(() => reject(preferCodedError(errors)))
          },
        )
      }
    })
  }

  // ── late-answer layer ────────────────────────────────────────────────────────────

  async pollOnce() {
    if (this.polling) return
    this.polling = true
    try {
      const items = await this.relay.pending()
      const signature = items.map((item) => String(item?.callId ?? '?')).join(' ')
      if (signature !== this.lastQueue) {
        this.lastQueue = signature
        if (items.length > 0) {
          this.log('queue: ' + String(items.length) + ' item(s) [' + items.map((item) => String(item?.callId ?? '?').slice(0, 12)).join(' ') + ']')
        }
      }
      for (const item of items) {
        try {
          await this.deliver(item)
        } catch (error) {
          // No ack: the relay keeps it for another hour and we retry next tick.
          this.complain('defer:' + String(item?.callId ?? '?'), 'delivery deferred: ' + String(error?.message ?? error))
          continue
        }
        try {
          await this.relay.ack([item.callId])
        } catch (error) {
          this.log('ack failed for ' + String(item?.callId ?? '?') + ': ' + String(error?.message ?? error))
        }
      }
    } catch (error) {
      this.log('poll failed: ' + String(error?.message ?? error))
    } finally {
      this.polling = false
    }
  }

  /**
   * Deliver one queued answer. Returns normally = settled (the caller acks); throws = keep it
   * queued and retry next tick (never drop an answer we could not hand over yet).
   */
  async deliver(item) {
    const callId = String(item?.callId ?? '')
    if (callId.length === 0) return
    const answers = this.padAnswers(callId, item)

    const waiter = this.waiters.get(callId)
    if (waiter !== undefined) {
      this.waiters.delete(callId)
      waiter.resolve(answers)
      this.log('answered (foreground) ' + callId)
      await this.echo(callId, answers)
      return
    }

    const known = this.questions.get(callId)
    if (known !== undefined && known.timed !== true) {
      this.log(
        'cannot apply the phone answer to ' + callId + ': the question has no timed wait, ' +
        'so the agent never gave up the foreground and there is nothing left to answer.',
      )
      return
    }

    const agent = this.liveRoot(item?.agentId)
    if (agent === undefined) {
      this.complain(callId, 'no live root agent for ' + String(item?.agentId ?? '') + '; keeping the answer queued')
      throw new Error('agent not live: ' + String(item?.agentId ?? ''))
    }
    let accepted
    try {
      accepted = this.ctx.userQuestions.answer(agent, callId, { answers })
    } catch (error) {
      if (error?.code === 'CALLER_NOT_LIVE' || error?.code === 'DELEGATED_CALLER') {
        this.complain(callId, 'agent not answerable (' + String(error.code) + '); keeping the answer queued')
        throw error
      }
      this.log('answer rejected for ' + callId + ' (' + String(error?.code ?? error?.message ?? error) + '); dropping')
      return
    }
    if (accepted === false) {
      // `answer()` only accepts a *continued* question (the projection's own filter). A phone
      // answer that lands while the foreground window is still open must NOT be thrown away:
      // hold it in the relay queue and retry — it becomes answerable the moment the wait ends.
      const view = this.questionState(agent, callId)
      if (view.settled === true) {
        this.log('question ' + callId + ' is settled; dropping the queued answer')
        return
      }
      this.complain(
        callId,
        'not answerable yet (' + (view.available ? 'state=' + String(view.state) : 'projection seam unavailable') +
        '); keeping the phone answer queued and retrying',
      )
      throw new Error('question not continued yet: ' + callId)
    }
    this.log('answered (continued) ' + callId)
    if (known !== undefined) known.echoed = true
    await this.echo(callId, answers)
  }

  /**
   * Where the question sits in the session projection. The registered unit's state is
   * `{ timed, questions: { active, settled } }` (the `dsh-user-questions` fold), and
   * `answer()` accepts only `state === 'continued'`.
   */
  questionState(agent, callId) {
    const seam = this.ctx.get('sessionProjections')
    if (seam?.stateOf === undefined) return { available: false, state: undefined, settled: false }
    try {
      const state = seam.stateOf(agent?.session, 'userQuestions')
      const active = (state?.questions?.active ?? []).find((item) => item?.callId === callId)
      const settled = (state?.questions?.settled ?? []).some((item) => item?.callId === callId)
      return { available: true, state: active?.state, settled }
    } catch (error) {
      this.log('projection read failed for ' + callId + ': ' + String(error?.message ?? error))
      return { available: false, state: undefined, settled: false }
    }
  }

  /** The exact live root agent owning this question, by agent id then by session id. */
  liveRoot(agentId) {
    const id = String(agentId ?? '')
    if (id.length === 0) return undefined
    const registry = this.ctx.get('agents') ?? this.ctx.agents
    if (registry === undefined) return undefined
    const exact = registry.get?.(id)
    if (exact !== undefined) return exact
    return (registry.roots?.() ?? []).find((agent) => agent?.session?.id === id)
  }

  /** Pad a partial batch (the phone's one-tap answer sends a single item) to the full set. */
  padAnswers(callId, item) {
    const known =
      this.questions.get(callId)?.questions ?? (item?.qids ?? []).map((id) => ({ id, question: '', options: [] }))
    const given = Array.isArray(item?.answers) ? item.answers : []
    const byId = new Map()
    for (const answer of given) {
      if (answer !== null && typeof answer === 'object' && typeof answer.id === 'string') byId.set(answer.id, answer)
    }
    if (known.length === 0) return given
    return known.map((question) => {
      const answer = byId.get(question.id)
      if (answer === undefined) return { id: question.id, selected: [] }
      return {
        id: question.id,
        selected: Array.isArray(answer.selected) ? answer.selected : [],
        ...(typeof answer.custom === 'string' ? { custom: answer.custom } : {}),
      }
    })
  }

  /** Silent `#ans` echo on this host's own topic (the relay's echo is hard-wired to `dsh`). */
  async echo(callId, answers) {
    if (this.config.echoAnswers !== true) return
    const summary = answerSummary(answers)
    try {
      await this.relay.push({
        title: 'DSH 已答',
        body: '#ans ' + callId + ' ' + (summary.length > 0 ? summary : '已作答'),
        priority: 1,
      })
    } catch (error) {
      this.log('echo failed for ' + callId + ': ' + String(error?.message ?? error))
    }
  }

  complain(callId, message) {
    const now = Date.now()
    const previous = this.complained.get(callId) ?? 0
    if (now - previous < 300_000) return
    this.complained.set(callId, now)
    this.log(callId + ': ' + message)
  }

  /** Drop bookkeeping older than a day (the relay queue TTL is 1 h). */
  sweep() {
    const now = Date.now()
    for (const [callId, entry] of this.announced) if (now - entry.ts > 86_400_000) this.announced.delete(callId)
    for (const [callId, ts] of this.complained) if (now - ts > 86_400_000) this.complained.delete(callId)
    for (const [callId, entry] of this.questions) {
      if (this.waiters.has(callId)) continue
      if (now - entry.ts > 86_400_000) this.questions.delete(callId)
    }
  }
}

/** Merge what the profile patch supplied over our defaults (never trust Config to be applied). */
function resolveConfig(config) {
  const resolved = { ...DEFAULTS }
  for (const [key, value] of Object.entries(config ?? {})) {
    if (value === undefined || value === null) continue
    if (typeof DEFAULTS[key] === 'string') resolved[key] = String(value)
    else if (typeof DEFAULTS[key] === 'number') resolved[key] = Number(value)
    else if (typeof DEFAULTS[key] === 'boolean') resolved[key] = value === true || value === 'true'
    else resolved[key] = value
  }
  return resolved
}

/** The credentials file this profile would read, for diagnostics and for the `pair` command. */
export function credentialFilePath(config = {}, env = process.env) {
  return credentialsPath(config, env)
}

/**
 * Resolve the effective plugin configuration, secrets included.
 *
 *   built-in defaults → credentials file → profile/overlay config → environment variables
 *
 * The credentials file only ever *fills in* values: an explicit profile config or environment
 * variable wins over it, and a missing file contributes nothing at all.
 */
export function resolvePluginConfig(config = {}, { env = process.env, readFile = readFileSync } = {}) {
  const path = credentialFilePath(config, env)
  const file = loadCredentials(path, { readFile })
  // Credentials outrank the built-in defaults; the profile/overlay config outranks the credentials,
  // so anything the operator wrote down explicitly still wins over the file.
  //
  // 2026-10-12 fix (production cutover caught this): at `apply()` time `config` has ALREADY been
  // through schema validation, so its defaults are *present* (`host: ''`, `hostToken: ''`,
  // `ntfyToken: ''`, …). Spreading that over the credentials file therefore erased every value the
  // file contributed → the plugin logged "relay disabled" on a perfectly good credentials file,
  // with the old hook already retired (= no phone notifications at all). An empty string now counts
  // as "not set", so the file can fill it in. `false` stays meaningful (never dropped).
  const fromCredentials = pickConfigKeys(file.value)
  const explicit = {}
  for (const [key, value] of Object.entries(config)) {
    if (value !== '' && value !== undefined && value !== null) explicit[key] = value
  }
  const resolved = resolveConfig({ ...fromCredentials, ...explicit })

  const envOverride = (key, name) => {
    const overridden = typeof env[name] === 'string' ? env[name].trim() : ''
    return overridden.length > 0 ? overridden : resolved[key]
  }
  return {
    path,
    file,
    resolved: {
      ...resolved,
      hostToken: envOverride('hostToken', resolved.hostTokenEnv),
      regToken: envOverride('regToken', resolved.regTokenEnv),
      ntfyToken: envOverride('ntfyToken', resolved.ntfyTokenEnv),
    },
  }
}

/** Normalize the legacy `withEnv` shape (a resolved config + the process environment). */
export function withEnv(config, env = process.env) {
  const resolved = resolvePluginConfig(config, { env })
  return { ...resolved.resolved, credentialsPath: resolved.path }
}

/** Only the config keys a credentials file can legitimately carry (never booleans/secrets env names). */
export const CREDENTIAL_CONFIG_KEYS = [
  'relayBase',
  'answerBase',
  'topic',
  'host',
  'hostToken',
  'ntfyToken',
  'phoneToken',
  'webBase',
  'webName',
  'webLog',
  'pollIntervalMs',
  'credentialsFile',
  'regToken',
]

function pickConfigKeys(values) {
  const picked = {}
  for (const key of CREDENTIAL_CONFIG_KEYS) if (values[key] !== undefined) picked[key] = values[key]
  return picked
}

/** Log credentials-file trouble once per boot; a missing file is not trouble. */
function reportCredentials(file, log) {
  if (file.error !== undefined) log('credentials ignored: ' + file.error)
}

export function apply(ctx, config = {}) {
  const { resolved, file } = resolvePluginConfig(config)
  const host = new PushHost(ctx, resolved)
  reportCredentials(file, (message) => host.log(message))
  if (file.present && file.error === undefined) host.log('credentials file: ' + file.path)
  // Question notifications: claim the request waterfall, then hand the request back.
  ctx.on('user-questions/request', (request, next) => host.onRequest(request, next), { prepend: true })
  // Turn-end notification (the Stop-hook parity), the PreToolUse notify fallback and the
  // `#ans` echo (PostToolUse parity).
  ctx.on('agent/turn-stopping', (payload) => host.onTurnStopping(payload))
  ctx.on('tools/pre-execute', (exec, next) => host.onPreExecute(exec, next))
  ctx.on('tools/post-execute', (exec, result, next) => host.onPostExecute(exec, result, next))
  ctx.effect(() => () => host.stop(), 'dsh-push-host: relay bookkeeping')
  host.start()
}

export { PushHost, resolveConfig, CONFIG_KEYS }
