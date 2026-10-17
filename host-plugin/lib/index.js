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
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
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
 * `configEditor` / `profileContext` / `tools` back the 手机作答模式 switch (v0.2.0);
 * a host without them simply keeps the switch inert (see `AskUserModeSwitch.start`).
 */
export const inject = ['userQuestions', 'timer', 'configEditor', 'profileContext', 'tools']

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
  // 自助发号（v0.3.0）：中继上的 dsh-provd 服务地址与那把共享密钥（见 relay/README.md）。
  provisionBase: 'https://ntfy.cpyh.xyz/provision',
  provisionToken: '',
  provisionTokenEnv: 'DSH_PUSH_PROVISION_TOKEN',
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
  /** 发号服务基址（中继 `dsh-provd`，经 edge nginx 暴露在 /provision/*）。 */
  provisionBase: z.string().default('https://ntfy.cpyh.xyz/provision'),
  /** 发号服务的共享密钥（`/etc/dsh-provd/secret`）；优先 `provisionTokenEnv`。 */
  provisionToken: z.string().default(''),
  provisionTokenEnv: z.string().default('DSH_PUSH_PROVISION_TOKEN'),
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
  /**
   * 手机作答模式（v0.2.1）：期望的 ask_user_question 变体。**只有 'timed' 会触发写入**——
   * 本开关永不降级（0.2.0 的 P0：默认 'legacy' + 开机 sync 把生产 tool-ask-user 反向改回
   * legacy）。未表态（字段缺失=schemastery 不加 default/required 即 optional，值 undefined）
   * = 完全惰性，宿主一个字都不写。注意 schemastery 没有 `.optional()` 方法（也没有
   * `z.literal`，字面量用简写数组或 `z.const`），别写 `.optional()`——会把整个 Config 炸掉。
   * volatile 是为了 Web 设置行能经 settings RPC 写它（mode/timeout 在 tool-ask-user 那边
   * 不是 volatile，客户端写不了）；真正的改写由宿主延后到 HMR 事务之外执行（事务内嵌套
   * configEditor.edit 会抛 "HMR transactions cannot be nested"）。
   */
  askUserMode: z.union(['legacy', 'timed']).volatile(),
  /** 上次切换的结果（'' = 成功/无待办）；volatile，好让 Web 设置行显示失败原因。 */
  askUserStatus: z.string().default('').volatile(),
  /**
   * 实际态镜像（'' = 宿主还没回写）：设置行展示读这个，**不拿期望态当展示值**——P0 之后
   * 期望态和实际态可以相反（期望未表态、实际 timed）。
   */
  askUserActual: z.union(['', 'legacy', 'timed']).default('').volatile(),
  /**
   * 通行证发号面板（v0.3.0）的往返字段，全部 volatile：网页设置行经 settings RPC 只能写
   * volatile 字段（见本文件 823 行那段实测结论），所以「请求」由浏览器写这几个字段来表达，
   * 宿主跑完发号再把结果镜像回 provisionResult / provisionList / provisionDone。
   * provisionSeq 是浏览器生成的请求号：宿主做完原样回写，页面据此清 busy——同一个名字
   * 连点两次也必须各得一次结果，所以不能只靠 action 字段的变化触发。
   */
  provisionName: z.string().default('').volatile(),
  provisionAction: z.union(['', 'issue', 'revoke', 'refresh']).default('').volatile(),
  provisionSeq: z.string().default('').volatile(),
  /** 最近一次操作的结果文本（'' = 无）：成功时是通行证原文，失败时是给人看的中文原因。 */
  provisionResult: z.string().default('').volatile(),
  /** 已发通行证列表的 JSON 文本（宿主写，页面渲染成可吊销的列表）。 */
  provisionList: z.string().default('').volatile(),
  /** 宿主建议的默认名字（本机名清洗过），页面预填、用户可改。 */
  provisionDefault: z.string().default('').volatile(),
  /** 宿主处理完的请求号回写。 */
  provisionDone: z.string().default('').volatile(),
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
        body: this.questionBody(callId, registered, sessionId),
        priority: 4,
      })
    } catch (error) {
      this.log('push failed for ' + callId + ': ' + String(error?.message ?? error))
    }
  }

  /** The phone renders this body: question, options, answer link, then machine trailers. */
  questionBody(callId, questions, sessionId = '') {
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
    const web = this.webUrl(sessionId)
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
  /**
   * v0.2.2 - `sessionId` is appended as a **URL fragment** (`...#session-<uuid>`) so opening the
   * link lands on the conversation that produced the notification; our client module
   * (`lib/client.js`) reads it and switches the main view to that session.
   *
   * A fragment rather than a query param, for two measured reasons: the `?token=` entry answers
   * `303 See Other -> Location: ./`, which drops the query string, while browsers carry the
   * fragment across redirects; and the web client has no router, so nothing else reads path or
   * query. Clients that ignore the fragment keep behaving exactly as before.
   */
  webUrl(sessionId = '') {
    const base = this.config.webBase.trim()
    const file = this.config.webLog.length > 0 ? this.config.webLog : join(homedir(), '.dsh', 'web.log')
    try {
      const text = readFileSync(file, 'utf8')
      const matches = [...text.matchAll(/dsh web: (http:\/\/\S+[?&]token=\S+)/g)]
      if (matches.length === 0) return ''
      const logged = matches[matches.length - 1][1]
      const url = base.length === 0
        ? logged
        : base.replace(/\/+$/, '') + '/?token=' + (/[?&]token=(\S+)/.exec(logged)?.[1] ?? '')
      const sid = String(sessionId ?? '').trim()
      // 只接受 `session-<uuid>` 形态：拿不到或形态不对就不拼，绝不产出 `...#` 这种脏链接。
      if (!/^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sid)) return url
      return url + '#' + sid
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
    const web = this.webUrl(sessionId)
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
      provisionToken: envOverride('provisionToken', resolved.provisionTokenEnv),
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
  'provisionBase',
  'provisionToken',
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

// ── 手机作答模式开关 (v0.2.1) ─────────────────────────────────────────────────────────
// The Web settings row (lib/client.js) writes the volatile `askUserMode` above over the
// settings RPC; the host reacts and rewrites tool-ask-user's OWN config through
// `ctx.configEditor.edit` — mode/timeout are NOT volatile there (dsh-tool-ask-user Config),
// so the settings RPC cannot touch them directly. A non-volatile write hot-restarts just
// that plugin's fiber (cordis-plugin-loader), so the timed tool re-registers WITHOUT a
// host restart. Before every write the profile patch file is copied to `<patchPath>.bak-<ms>`
// (the dsh-app-boot sanitizeProfile naming convention). The timed variant only affects
// sessions created after the switch — tool variants are pinned at session creation; the
// row says so. A same-id home patch / CLI overlay makes the write throw
// "…is overridden by a home patch or command-line overlay" (dsh-config-editor edit():122);
// the message is mirrored into the volatile `askUserStatus` for the row to display.
//
// v0.2.1 hotfix rules (production P0 — 0.2.0 downgraded a live timed production to legacy):
// 1. NEVER downgrade: only an explicit `timed` desire may ever write; unset or `legacy`
//    is fully inert (no file write, no backup).
// 2. At most ONE successful tool-ask-user write per process (`done`): an external repair
//    (file restore + reconcile) must not make a live process downgrade again.
// 3. The write is deferred outside the current HMR transaction (`setTimeout 0`): a
//    volatile-update fires inside the settings RPC's transaction, and a nested
//    configEditor.edit throws "HMR transactions cannot be nested".
// 4. The row displays the ACTUAL tool state, mirrored into volatile `askUserActual`.
// 5. Status/actual mirrors are IN-MEMORY ONLY (defect 3: 0.2.0 persisted the status string
//    into the user's cordis.patch.yml via configEditor.edit). Runtime volatile fields are
//    frozen cosmokit refs whose only setter is the global symbol `cosmokit.volatile.write`
//    (createVolatile; updateVolatile is just `target[write](source.get())`). The settings
//    describe() reads those live refs, so the Web row sees them without any file write.
//    The ONLY file write allowed is the one tool-ask-user upgrade.

/** Read a possibly-volatile config value (a Volatile ref at runtime, a plain value in tests). */
export function volatileValue(value, fallback) {
  if (value === undefined || value === null) return fallback
  if (typeof value === 'object' && typeof value.get === 'function') {
    const live = value.get()
    return live === undefined || live === null ? fallback : live
  }
  return value
}

/**
 * Write an IN-MEMORY volatile config value — never through configEditor (defect 3: status
 * strings must not land in the user's cordis.patch.yml). At runtime a `.volatile()` field
 * is a frozen cosmokit ref whose only setter is the global symbol
 * `cosmokit.volatile.write` (cosmokit createVolatile/updateVolatile); the settings service
 * reads the live ref, so the Web row sees the update on its next describe. Plain values
 * (tests, hosts without volatile wiring) are assigned back so callers still observe it; a
 * ref without the symbol keeps its value and the log line still carries the message.
 */
export function setVolatileValue(container, key, value) {
  const current = container[key]
  if (current && typeof current === 'object' && typeof current.get === 'function') {
    const write = Symbol.for('cosmokit.volatile.write')
    if (typeof current[write] === 'function') current[write](value)
    return
  }
  container[key] = value
}

/** Whether one tool definition is the timed `ask_user_question` (dsh-user-questions projection.js:89). */
export function isTimedAskUserQuestion(tool) {
  if (!tool || tool.name !== 'ask_user_question') return false
  const parameters = tool.parameters
  const properties = parameters && typeof parameters === 'object' ? parameters.properties : undefined
  return !!properties && typeof properties === 'object' && !Array.isArray(properties) && 'timeout' in properties
}

/** `<patchPath>.bak-<ms>` with a collision ordinal — the dsh-app-boot sanitizeProfile convention. */
export function askUserBackupPath(patchPath, now = Date.now, exists = existsSync) {
  const base = `${patchPath}.bak-${now()}`
  let candidate = base
  let ordinal = 0
  while (exists(candidate)) candidate = `${base}-${++ordinal}`
  return candidate
}

/** The next raw config for the tool-ask-user entry given the desired mode. */
export function nextAskUserConfig(current, desired) {
  const next = { ...(current ?? {}) }
  next.mode = desired
  if (desired === 'timed') next.timeout = 120
  return next
}

/**
 * What one sync pass should do, given the desired mode and the live tool definition.
 * v0.2.1: the switch only ever UPGRADES to timed. An unset or `legacy` desire is `inert`
 * — the 0.2.0 P0 treated "user never opted in" as "user wants legacy" and downgraded a
 * live timed production.
 */
export function askUserSyncPlan(desired, tool) {
  if (desired !== 'timed') return { action: 'inert', desired }
  if (tool === undefined) return { action: 'wait' }
  const actual = isTimedAskUserQuestion(tool) ? 'timed' : 'legacy'
  if (actual === 'timed') return { action: 'noop', actual }
  return { action: 'edit', actual, desired }
}

/** Bridges the volatile desire to the tool-ask-user entry's real config. */
export class AskUserModeSwitch {
  /**
   * @param ctx - the plugin context (needs `tools` + `configEditor`; `profileContext` optional).
   * @param config - the validated plugin config (volatile fields are live refs).
   * @param log - logging sink.
   */
  constructor(ctx, config, log) {
    this.ctx = ctx
    this.config = config
    this.log = log
    this.busy = false
    /** One successful tool-ask-user write per process — an external repair is never re-downgraded. */
    this.done = false
    /** Coalesces deferred (outside-HMR-transaction) sync runs into one. */
    this.scheduled = false
    /** Last outcome mirrored into `askUserStatus` (undefined = never written). */
    this.lastStatus = undefined
    /** Last actual state mirrored into `askUserActual` (undefined = never written). */
    this.lastActual = undefined
  }

  /** The mode the settings row asked for; `undefined` = the user never opted in (inert). */
  desired() {
    return volatileValue(this.config.askUserMode, undefined)
  }

  /**
   * Run one sync on the next macrotask: volatile-update and tools/change can fire inside
   * an HMR transaction, where a nested configEditor.edit throws
   * "HMR transactions cannot be nested".
   */
  scheduleSync() {
    if (this.scheduled) return
    this.scheduled = true
    setTimeout(() => {
      this.scheduled = false
      void this.sync()
    }, 0)
  }

  /** Compare desire vs live tool; rewrite tool-ask-user's config only to upgrade to timed. Idempotent. */
  async sync() {
    if (this.busy) return
    const ctx = this.ctx
    if (!ctx.configEditor || !ctx.tools) return
    this.busy = true
    try {
      const tool = ctx.tools.get('ask_user_question')
      const actual = isTimedAskUserQuestion(tool) ? 'timed' : 'legacy'
      // The display always follows reality, never the desire (P0: they can disagree).
      this.writeActual(actual)
      // One successful write per process: after a repair (file restore + reconcile),
      // a live process must not treat the fixed state as drift and downgrade again.
      if (this.done) return
      const plan = askUserSyncPlan(this.desired(), tool)
      if (plan.action === 'inert') return
      if (plan.action === 'wait') return
      if (plan.action === 'noop') {
        this.writeStatus('')
        return
      }
      // Last gate: only an upgrade to timed may ever reach the file (P0 regression guard).
      if (plan.desired !== 'timed') {
        this.log('手机作答模式：拒绝写入——只允许升到 timed，永不降级')
        return
      }
      const entry = ctx.configEditor.entries().find((row) => row.options.id === 'tool-ask-user')
      if (entry === undefined) {
        this.writeStatus('未找到 tool-ask-user 配置项：它可能被停用或改名，手机作答模式未生效')
        return
      }
      const patchPath = ctx.profileContext ? ctx.profileContext.patchPath : undefined
      if (patchPath && existsSync(patchPath)) {
        const backup = askUserBackupPath(patchPath)
        copyFileSync(patchPath, backup)
        this.log('手机作答模式：' + plan.actual + ' → ' + plan.desired + '，已备份 ' + backup)
      } else {
        this.log('手机作答模式：' + plan.actual + ' → ' + plan.desired)
      }
      await ctx.configEditor.edit(entry, (current) => nextAskUserConfig(current, plan.desired))
      const landed = isTimedAskUserQuestion(ctx.tools.get('ask_user_question'))
      if (landed) {
        this.done = true
        this.log('手机作答模式已切换为 timed（新会话立即生效，已开老会话保持旧行为）')
        this.writeStatus('')
        this.writeActual('timed')
      } else {
        this.writeStatus('写入后工具状态未收敛，请检查宿主日志')
      }
    } catch (error) {
      const message = String(error && error.message ? error.message : error)
      this.log('手机作答模式切换失败：' + message)
      this.writeStatus(message)
    } finally {
      this.busy = false
    }
  }

  /** Mirror the outcome into the volatile `askUserStatus` IN MEMORY (never persisted). */
  writeStatus(message) {
    if (message === '' && (this.lastStatus === undefined || this.lastStatus === '')) return
    this.lastStatus = message
    setVolatileValue(this.config, 'askUserStatus', message)
  }

  /** Mirror the ACTUAL tool state into the volatile `askUserActual` IN MEMORY (never persisted). */
  writeActual(actual) {
    if (this.lastActual === actual) return
    this.lastActual = actual
    setVolatileValue(this.config, 'askUserActual', actual)
  }

  /** Wire the triggers: volatile desire changes, tool registration changes, and boot. */
  start() {
    const ctx = this.ctx
    if (!ctx.configEditor || !ctx.tools) return
    ctx.on('loader/volatile-update', (paths) => {
      const touched = Array.isArray(paths) && paths.some((path) => Array.isArray(path) && path[0] === 'askUserMode')
      if (touched) this.scheduleSync()
    })
    // Activation order: tool-ask-user may register after this plugin, and any later
    // registration change re-checks the plan (dsh-tools emits `tools/change`).
    ctx.on('tools/change', () => this.scheduleSync())
    this.scheduleSync()
  }
}

// ---------------------------------------------------------------------------
// 自助通行证发号（v0.3.0）
//
// 中继上的 dsh-provd（见仓库 relay/README.md）是「一人一 topic 一对凭据」的签发口：
// 网页设置行经 settings RPC 写 volatile 的 provisionAction/provisionName/provisionSeq，
// 这里观察到就跑一次 HTTP，把结果镜像回 provisionResult/provisionList/provisionDone。
// 发号成功顺手把 topic + 只写 token + 只读 token 写回插件自己的凭据文件（先备份），
// 因为 resolvePluginConfig 的分层是「默认 < 凭据文件 < profile < env」——写文件就够了，
// 不必碰 configEditor（也就不会撞 HMR 事务嵌套）。重启本插件 fiber 后生效。

/** 发号服务地址拼接：去掉多余斜杠，避免出现 //issue。 */
export function provisionUrl(base, path) {
  const b = String(base || '').trim().replace(/\/+$/, '')
  return b + '/' + String(path || '').replace(/^\/+/, '')
}

/**
 * 通行证文本（App v1.33.0 起解析）：topic 是多人隔离的关键，只有一串 token 的老通行证
 * 在 App 里仍按默认 topic 处理，所以这里必须把三项都带上。
 */
export function passText({ relayBase, topic, readToken } = {}) {
  const parts = []
  if (relayBase) parts.push('base=' + relayBase)
  if (topic) parts.push('topic=' + topic)
  if (readToken) parts.push('token=' + readToken)
  return 'dshpush://v1' + (parts.length ? '?' + parts.join('&') : '')
}

/** 本机名 → ntfy 允许的 topic 名（^[a-z0-9][a-z0-9-]{1,30}$）；中文/空名退化成 dsh-local。 */
export function provisionNameSuggest(config = {}) {
  const raw = String(config.host || '').trim() || String(config.webName || '').trim()
  const cleaned = raw.toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+/g, '-')
    .slice(0, 31)
    .replace(/-+$/, '')
  if (/^[a-z0-9][a-z0-9-]{1,30}$/.test(cleaned)) {
    const named = cleaned.startsWith('dsh-') ? cleaned : ('dsh-' + cleaned).slice(0, 31).replace(/-+$/, '')
    return /^[a-z0-9][a-z0-9-]{1,30}$/.test(named) ? named : 'dsh-local'
  }
  return 'dsh-local'
}

/** 一次发号调用（fetch 可打桩）：返回 {ok,data} 或 {ok:false,error:给人看的中文}。 */
export async function provisionCall({ base, token, path, body, fetchImpl = globalThis.fetch } = {}) {
  if (!token) return { ok: false, error: '缺少发号密钥：填 provisionToken 或设环境变量 DSH_PUSH_PROVISION_TOKEN' }
  if (typeof fetchImpl !== 'function') return { ok: false, error: '这个 Node 运行时没有 fetch，无法发号' }
  let res
  try {
    res = await fetchImpl(provisionUrl(base, path), {
      method: path === 'list' ? 'GET' : 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: path === 'list' ? undefined : JSON.stringify(body || {}),
    })
  } catch (error) {
    return { ok: false, error: '发号服务不可达：' + String(error && error.message ? error.message : error) }
  }
  let text = ''
  try { text = String(await res.text()) } catch { text = '' }
  let data = null
  try { data = JSON.parse(text) } catch { data = null }
  if (!res.ok) {
    const why = data && data.error ? data.error : text.slice(0, 120)
    return { ok: false, error: '发号服务返回 ' + res.status + (why ? '：' + why : '') }
  }
  return { ok: true, data: data === null ? {} : data }
}

/**
 * 把发到的凭据写回插件自己的凭据文件（先 copyFileSync 备份）。只动 topic / ntfyToken /
 * phoneToken 三项，其它字段原样保留；文件不存在时按目录建好再写。
 */
export function writeCredentialsPatch(path, patch, deps = {}) {
  const read = deps.readFile || readFileSync
  const copy = deps.copyFile || copyFileSync
  const exists = deps.exists || existsSync
  const mkdir = deps.mkdir || mkdirSync
  const write = deps.write || writeFileSync
  const rename = deps.rename || renameSync
  const stamp = deps.stamp || (() => new Date().toISOString().replace(/[:.]/g, '-'))
  const dirOf = (p) => String(p).split(/[\\/]/).slice(0, -1).join('/')
  let current = {}
  const existed = exists(path)
  if (existed) {
    copy(path, path + '.bak-' + stamp())
    try { current = JSON.parse(read(path, 'utf8')) || {} } catch { current = {} }
  } else {
    try { mkdir(dirOf(path), { recursive: true }) } catch { /* 目录已存在 */ }
  }
  const next = { ...current, v: current.v || '1' }
  for (const [key, value] of Object.entries(patch || {})) {
    if (typeof value === 'string' && value !== '') next[key] = value
  }
  const tmp = path + '.tmp-' + stamp()
  write(tmp, JSON.stringify(next, null, 2) + '\n')
  rename(tmp, path)
  return { path, created: !existed, keys: Object.keys(patch || {}) }
}

/**
 * 面板镜像的**进程级**暂存（2026-10-17 实测出来的坑）：浏览器经 settings RPC 写 volatile 字段
 * 会被持久化进 profile 的 cordis.patch.yml（实测文件里出现 provisionName/provisionAction/
 * provisionSeq 三行），补丁一变宿主就热重启本插件 fiber，内存里的 volatile 镜像当场清零 ——
 * 用户看到的是「结果闪一下自己就没了」。fiber 重启不换进程 ⇒ 把最后一次结果挂在 globalThis 上，
 * 新 fiber 一装载就回灌，面板不再自己变空。绝不写文件（镜像是运行态，不该进用户的补丁）。
 */
export const PANEL_STORE_KEY = '__DSHPUSH_PANEL__'

export function panelStore() {
  const g = globalThis
  if (!g[PANEL_STORE_KEY]) g[PANEL_STORE_KEY] = {}
  return g[PANEL_STORE_KEY]
}

/** 每个 profile 只有一个「当前 fiber」：旧 fiber 跑完要把结果转交给新 fiber。 */
const PANEL_ACTIVE = new Map()

/** Bridges the Web pass panel to the relay provisioning service. */
export class PassProvisioner {
  constructor(ctx, config, resolved, log, deps = {}) {
    this.ctx = ctx
    this.config = config
    this.resolved = resolved
    this.log = log
    this.fetchImpl = deps.fetchImpl || globalThis.fetch
    this.writeCreds = deps.writeCredentialsPatch || writeCredentialsPatch
    this.credentialsPath = deps.credentialsPath || ''
    this.busy = false
    this.scheduled = false
    /** 已经处理过的请求号；同一个 seq 绝不重复发号（重复点按由页面换新 seq）。 */
    this.lastSeq = ''
  }

  read(key) { return volatileValue(this.config[key], '') }

  /** 暂存按 profile 分键（同一台机器可能跑多个 profile）。 */
  storeKey() {
    return String(this.resolved.host || '') + '|' + String(this.credentialsPath || '')
  }

  /** 把最后一次结果回灌进当前 fiber 的 volatile 镜像（fiber 刚重启时面板不该是空的）。 */
  applyStore() {
    const saved = panelStore()[this.storeKey()]
    if (!saved) return
    this.write('provisionResult', String(saved.result || ''))
    this.write('provisionList', String(saved.list || ''))
    this.write('provisionDone', String(saved.done || ''))
  }

  /** 存住本次结果；若已有更新的 fiber 接管（补丁写入引发的重启），转交给它回灌。 */
  saveStore() {
    const snapshot = {
      result: String(this.read('provisionResult') || ''),
      list: String(this.read('provisionList') || ''),
      done: String(this.read('provisionDone') || ''),
    }
    panelStore()[this.storeKey()] = snapshot
    const active = PANEL_ACTIVE.get(this.storeKey())
    if (active && active !== this) {
      active.config.provisionResult = undefined
      active.applyStore()
      this.log('通行证结果已转交给重启后的 fiber（补丁写入会热重启本插件）')
    }
  }

  write(key, value) { setVolatileValue(this.config, key, value) }

  /** 开机就把建议名字推给页面预填（用户可改）。 */
  publishDefault() {
    const suggested = provisionNameSuggest(this.resolved)
    if (this.read('provisionDefault') !== suggested) this.write('provisionDefault', suggested)
  }

  /** volatile-update 发生在 settings RPC 的事务里 ⇒ 挪到下一个宏任务再跑（同 AskUserModeSwitch）。 */
  schedule() {
    if (this.scheduled) return
    this.scheduled = true
    setTimeout(() => {
      this.scheduled = false
      void this.run()
    }, 0)
  }

  async list() {
    const out = await provisionCall({
      base: this.resolved.provisionBase, token: this.resolved.provisionToken,
      path: 'list', fetchImpl: this.fetchImpl,
    })
    if (!out.ok) return { ok: false, error: out.error }
    const passes = Array.isArray(out.data.passes) ? out.data.passes : []
    return { ok: true, passes }
  }

  /** One panel round-trip: issue / revoke / refresh, then mirror everything back. */
  async run() {
    const seq = String(this.read('provisionSeq') || '')
    const action = String(this.read('provisionAction') || '')
    if (this.busy || seq === '' || seq === this.lastSeq) return
    if (action !== 'issue' && action !== 'revoke' && action !== 'refresh') return
    this.lastSeq = seq
    this.busy = true
    const name = String(this.read('provisionName') || '').trim() || provisionNameSuggest(this.resolved)
    try {
      if (action === 'issue') {
        const out = await provisionCall({
          base: this.resolved.provisionBase, token: this.resolved.provisionToken,
          path: 'issue', body: { name }, fetchImpl: this.fetchImpl,
        })
        if (!out.ok) {
          this.write('provisionResult', '发号失败：' + out.error)
          this.log('通行证发号失败：' + out.error)
        } else {
          const data = out.data || {}
          const text = passText({
            relayBase: this.resolved.relayBase, topic: data.topic, readToken: data.readToken,
          })
          this.write('provisionResult', text)
          this.log('通行证已签发：topic=' + data.topic + '，通行证文本已回写页面')
          if (this.credentialsPath) {
            try {
              // 别名一起写：loader 里 ntfyToken 排在 writetoken 之前（credentials.mjs:77），
              // 新值一定赢；但只写新键会让文件里留着旧 writeToken 骗读文件的人，所以两边同步。
              const saved = this.writeCreds(this.credentialsPath, {
                topic: data.topic,
                ntfyToken: data.writeToken, writeToken: data.writeToken,
                phoneToken: data.readToken, readToken: data.readToken,
              })
              this.log('已写回凭据文件 ' + saved.path + '（重启本插件后按新 topic 发布）')
            } catch (error) {
              this.log('凭据文件写入失败：' + String(error && error.message ? error.message : error))
            }
          }
        }
      } else if (action === 'revoke') {
        const out = await provisionCall({
          base: this.resolved.provisionBase, token: this.resolved.provisionToken,
          path: 'revoke', body: { name }, fetchImpl: this.fetchImpl,
        })
        this.write('provisionResult', out.ok ? ('已吊销：' + name) : ('吊销失败：' + out.error))
        this.log(out.ok ? ('通行证已吊销：' + name) : ('通行证吊销失败：' + out.error))
      }
      const listed = await this.list()
      // 载荷瘦身：面板只要 name 与 topic/permission，users 列表对渲染没用却会把镜像撑大。
      const slim = listed.ok
        ? listed.passes.slice(0, 40).map((row) => ({
            name: row.name,
            topics: (row.topics || []).map((t) => ({ topic: t.topic, permission: t.permission })),
          }))
        : []
      this.log('通行证列表：' + (listed.ok ? String(slim.length) + ' 条' : ('读取失败 ' + listed.error)))
      this.write('provisionList', listed.ok ? JSON.stringify(slim) : ('__err__' + listed.error))
    } catch (error) {
      const message = String(error && error.message ? error.message : error)
      this.write('provisionResult', '发号异常：' + message)
      this.log('通行证发号异常：' + message)
    } finally {
      this.busy = false
      this.write('provisionDone', seq)
      this.saveStore()
    }
  }

  /** Wire the trigger: any volatile write under provision* (except our own mirrors). */
  start() {
    this.publishDefault()
    // 认领「当前 fiber」并把上一次的结果回灌：浏览器写 volatile 会改补丁文件 ⇒ 本插件 fiber
    // 会被热重启 ⇒ 不这么做的话面板结果只显示一瞬间就自己清空（2026-10-17 真机实测）。
    PANEL_ACTIVE.set(this.storeKey(), this)
    this.applyStore()
    const mine = ['provisionAction', 'provisionName', 'provisionSeq']
    this.ctx.on('loader/volatile-update', (paths) => {
      const touched = Array.isArray(paths) && paths.some((path) =>
        Array.isArray(path) && mine.includes(path[0]))
      if (touched) this.schedule()
    })
  }
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
  // 手机作答模式开关（v0.2.1）：显式 timed → 延后出 HMR 事务 → 备份 → configEditor 热改
  // tool-ask-user；未表态/legacy 完全惰性，永不降级，每进程最多成功写一次。
  new AskUserModeSwitch(ctx, config, (message) => host.log(message)).start()
  // 通行证发号面板（v0.3.0）：网页写 volatile 的 provisionAction/Name/Seq → 这里调中继的
  // dsh-provd → 把通行证文本与列表镜像回 volatile 字段；发号成功顺手把 topic + 两只 token
  // 写回插件自己的凭据文件（先备份）。重启本插件 fiber 后按新 topic 发布。
  new PassProvisioner(ctx, config, resolved, (message) => host.log(message), {
    credentialsPath: file.path,
  }).start()
}

export { PushHost, resolveConfig, CONFIG_KEYS }
