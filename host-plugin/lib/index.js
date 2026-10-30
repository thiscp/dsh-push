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
import { RemoteAccess, newRemoteSecret, remoteMessage } from './remote.js'
import { pairPayload, pairQrMatrix, PAIR_WEB_MAX } from './pairqr.mjs'
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
  // 远程访问（v0.4.0）：默认关闭，关着的时候整条链路是惰性的（不装 cloudflared 也不报错）。
  // remoteSecret 就是用户手里那条 30 天链接里的口令；remotePort=0 表示让系统随便挑个空闲端口。
  // remoteEnabled 不是 schema 键：它是凭据文件里的「上次开关状态」（'on'/'off'），
  // 因为布尔开关的 schema 默认值 false 会反压凭据文件里的 true（见 CREDENTIAL_CONFIG_KEYS 注释）。
  remoteAccess: false,
  remoteSecret: '',
  remoteBin: '',
  remotePort: 0,
  remoteEnabled: '',
  // 手机链接走哪条路（v0.5.0）：'' = tailnet。空串是刻意的——非空默认值会反压凭据文件里的 tunnel。
  linkMode: '',
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
  provisionAction: z.union(['', 'issue', 'revoke', 'refresh', 'enroll']).default('').volatile(),
  provisionSeq: z.string().default('').volatile(),
  /** 最近一次操作的结果文本（'' = 无）：成功时是通行证原文，失败时是给人看的中文原因。 */
  provisionResult: z.string().default('').volatile(),
  /** 已发通行证列表的 JSON 文本（宿主写，页面渲染成可吊销的列表）。 */
  provisionList: z.string().default('').volatile(),
  /** 宿主建议的默认名字（本机名清洗过），页面预填、用户可改。 */
  provisionDefault: z.string().default('').volatile(),
  /** 宿主处理完的请求号回写。 */
  provisionDone: z.string().default('').volatile(),
  /**
   * 本机凭据是否已生效（'1' / '0'，v0.7.0 一键开通用）。
   *
   * 全新用户装完插件时 relay/topic/token 全空，这时「发通行证」按钮只会回「缺少发号密钥」——
   * 对一个只想把手机连上的用户毫无意义。页面据此改显「一键开通」，宿主在启动时回写一次。
   */
  provisionReady: z.string().default('').volatile(),

  // ── 远程访问（v0.4.0）────────────────────────────────────────────────────────────
  /** 总开关：只有 true 才起网关 + 隧道。 */
  remoteAccess: z.boolean().default(false).volatile(),
  /** 长期口令（30 天链接里的 `?k=`）。空着且打开开关 = 让宿主自动生成一串。 */
  remoteSecret: z.string().default('').volatile(),
  /** cloudflared 可执行文件；空 = 先找 `~/.dsh/bin/cloudflared[.exe]`，再找 PATH。 */
  remoteBin: z.string().default('').volatile(),
  /** 网关端口；0 = 挑空闲端口（推荐，避免与他人自跑的 cloudflared 抢端口）。 */
  remotePort: z.number().step(1).min(0).max(65535).default(0).volatile(),
  /** 当前公网地址（宿主写，设置行展示 + 复制；隧道重启换了域名会更新）。 */
  remoteUrl: z.string().default('').volatile(),
  /** 最近一次错误（'' = 正常），设置行直接显示给人看。 */
  remoteStatus: z.string().default('').volatile(),
  /** 一句人话状态：未开启 / 正在连接 / 已就绪。 */
  remotePhase: z.string().default('').volatile(),
  /** 上一次「推送链接到手机」的结果（'' = 没点过）。 */
  remotePushResult: z.string().default('').volatile(),
  /** 请求号：设置行按一次「重新连接」写一个新值，宿主据此重启隧道。 */
  remoteSeq: z.string().default('').volatile(),
  /** 动作：'' = 无；push = 把当前链接推到手机；reconnect = 重起隧道；rotate = 换口令。 */
  remoteAction: z.union(['', 'push', 'reconnect', 'rotate']).default('').volatile(),
  /** 宿主处理完的请求号回写（设置行据此清 busy）。 */
  remoteDone: z.string().default('').volatile(),
  /**
   * 手机推送里那条链接走哪条路（v0.5.0，用户 m16379「用户可以自行选择是使用公网隧道还是
   * tailscale」）：`tailnet` = 沿用 webBase/web.log 的原地址（默认，老用户行为完全不变）；
   * `tunnel` = 用公网隧道地址（没装 Tailscale 也能打开）。
   * 默认值是 **`''`（不是 `'tailnet'`）**：resolvePluginConfig 的 explicit 只丢掉
   * ''/undefined/null，非空默认值会把凭据文件里的 `tunnel` 反压回去（与 remoteEnabled 同一个坑）；
   * 空串在代码里一律按 tailnet 处理（见 RemoteAccessor.readMode）。
   */
  linkMode: z.union(['', 'tailnet', 'tunnel']).default('').volatile(),

  // ── 扫码配对（v0.6.0，用户 m17555）──────────────────────────────────────────────
  /**
   * 请求号：设置行按一次「生成二维码」写一个新值，宿主据此重算点阵。
   * 不把二维码本体（几百字符的 base64）当常驻字段：只在点了才写，点完留着也不占地方。
   */
  pairSeq: z.string().default('').volatile(),
  /** 点阵尺寸（每边模块数，0 = 还没生成）。 */
  pairCount: z.number().step(1).min(0).max(200).default(0).volatile(),
  /** 点阵本体：行优先位图的 base64（深色=1）。浏览器半自己用 canvas 画。 */
  pairBits: z.string().default('').volatile(),
  /** 载荷原文（`dshpush://v1?...`）：让用户能看见、能手动复制（App 也吃这个串）。 */
  pairText: z.string().default('').volatile(),
  /** 生成失败时给人看的原因（'' = 正常）。 */
  pairStatus: z.string().default('').volatile(),
  /** 宿主处理完的请求号回写（设置行据此清 busy）。 */
  pairDone: z.string().default('').volatile(),
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
    /** Poll interval armed exactly once, whether by start() or by rearm() after enrollment. */
    this.pollArmed = false
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
    this.pollArmed = true
    this.log(
      'relay ready host=' + this.config.host +
      ' topic=' + this.config.topic +
      ' poll=' + String(this.config.pollIntervalMs) + 'ms' +
      (this.config.claimForeground === true ? ' claimForeground=on' : ''),
    )
  }

  /**
   * Swap in freshly provisioned credentials **without** waiting for a fiber restart (v0.7.0).
   *
   * Why this exists: a brand-new install has no `host` / `hostToken`, so `start()` took the
   *「relay disabled」early return and never registered the poll interval. After 一键开通 the
   * credentials land in `this.config`, but the poll was never armed — the user would have had to
   * restart the whole DSH host before the first push could arrive. Re-arming here makes the very
   * first notification of a brand-new user work immediately.
   *
   * Safe to call repeatedly: the interval is armed exactly once (`this.pollArmed`), and the relay
   * client is rebuilt because it caches host/hostToken/topic in its constructor.
   */
  rearm(patch = {}) {
    Object.assign(this.config, patch)
    this.relay = new RelayClient({
      relayBase: this.config.relayBase,
      host: this.config.host,
      hostToken: this.config.hostToken,
      regToken: this.config.regToken,
      ntfyToken: this.config.ntfyToken,
      topic: this.config.topic,
    })
    if (!this.enabled) {
      this.log('relay still disabled after rearm (host/hostToken empty): push/answer off')
      return false
    }
    if (this.pollArmed) {
      this.log('relay re-armed host=' + this.config.host + ' topic=' + this.config.topic)
      return true
    }
    this.pollArmed = true
    this.ctx.interval(() => {
      void this.pollOnce()
    }, this.config.pollIntervalMs)
    this.log(
      'relay armed by enrollment host=' + this.config.host +
      ' topic=' + this.config.topic +
      ' poll=' + String(this.config.pollIntervalMs) + 'ms',
    )
    return true
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
    // Same inactive-context rule as the mode switch: the interval is disposed with the fiber,
    // but a tick already in flight can outlive it and `ctx.userQuestions` would then throw.
    if (!fiberIsActive(this.ctx)) return
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
    // `ctx.userQuestions.answer` below is a service read: on a fiber that is being replaced it
    // throws instead of returning, and the throw escapes as an unhandled rejection. Bail out so
    // the relay keeps the answer queued for the replacement fiber's next tick.
    if (!fiberIsActive(this.ctx)) throw new Error('fiber inactive; keeping the answer queued')
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
  for (const [key, rawValue] of Object.entries(config)) {
    // 2026-10-28 fix: a `.volatile()` field arrives here as a cosmokit ref OBJECT, so it is neither
    // '' nor undefined/null and used to count as "explicitly configured"; `String(ref)` then became
    // "[object Object]" (15 chars) and overrode the real value from the credentials file. remoteSecret
    // is validated by length >= 16, so the plugin regenerated the passphrase on every boot and the
    // 30-day link pushed the day before died. Unwrap the ref before deciding.
    const value = (rawValue !== null && typeof rawValue === 'object' && typeof rawValue.get === 'function')
      ? volatileValue(rawValue, '')
      : rawValue
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
  // v0.4.0 远程访问：口令与 cloudflared 路径可以写进凭据文件（用户级、与其余凭据同生死）。
  // 开关单独用 `remoteEnabled: 'on'` 表达，**不复用 schema 里的 `remoteAccess` 布尔**：那个键的
  // schema 默认值是 `false`，而 resolvePluginConfig 的 explicit 只丢掉 ''/undefined/null（false 是
  // 显式值），所以凭据文件里的 true 会被默认 false 反压回去；`remoteEnabled` 不是 DEFAULTS 的键，
  // resolveConfig 会原样带过来，RemoteAccessor 拿它判断「上次是开着还是关着」。
  'remoteSecret',
  'remoteBin',
  'remoteEnabled',
  'linkMode',
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

/**
 * True when this plugin's own fiber is still alive enough to touch its services.
 *
 * A cordis plugin fiber clears `fiber.store` (and nulls it out) while it is unloaded —
 * HMR / replacement / a market-driven restart — but `fiber.inject` stays intact, so the
 * context proxy THROWS `cannot get required service "..." in inactive context` instead of
 * handing back `undefined`. Guarding with `if (!ctx.configEditor)` therefore cannot see the
 * difference: the access itself is what throws. Reading one cheap `ctx` member is itself the
 * test, because it goes through the same proxy (and `fiber.state` is a plain field, so it does
 * not). `ACTIVE` is 2; UNLOADING is 5 — anything but 2 means "do not touch services".
 */
export function fiberIsActive(ctx) {
  try {
    const fiber = ctx && ctx.fiber
    if (!fiber) return true // a bare test host without fibers: behave as before
    return fiber.state === 2
  } catch {
    return false
  }
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
      // A rejected promise with no handler is a fatal load failure in the host process
      // (installFailLoud -> unhandledRejection -> exit(1)). Never leave one unattached.
      Promise.resolve(this.sync()).catch(() => {})
    }, 0)
  }

  /** Compare desire vs live tool; rewrite tool-ask-user's config only to upgrade to timed. Idempotent. */
  async sync() {
    if (this.busy) return
    const ctx = this.ctx
    // The unload race is the real killer: scheduleSync() runs `setTimeout(0)`, so a fiber
    // replacement between the call and the callback leaves `this.ctx` pointing at a fiber
    // whose store is already gone. Test liveness FIRST (cheap, and it is the same proxy), and
    // still catch: an unhandled rejection here is a fatal load failure in the host process.
    if (!fiberIsActive(ctx)) return
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
    // A dead/inactive fiber makes `ctx.configEditor` THROW (not return undefined) — the old
    // `!ctx.configEditor` test never fired on that path, which is how a market restart killed
    // the whole host process. Also guards the two listeners below, which fire asynchronously.
    if (!fiberIsActive(ctx)) return
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
 * 自助开通（v0.7.0）：**不需要发号密钥**的一次调用。
 *
 * 这是整条产品路径的关键一环。此前 `/issue` 要求 `provisionToken`（我们自己的运营密钥），
 * 于是「别人装了插件」永远停在「缺少发号密钥」——用户 m19862 / m19916 要的是「装完插件+App，
 * 扫一下就通了」，那第一张通行证就只能由用户自己从服务端自助领取。
 *
 * 服务端 `/enroll` 是唯一免鉴权的动词（按 IP 限速 2/小时、6/天，全局 40/天、总量上限 500），
 * 一次性返回 topic + 只读/只写 token + relay 队列 hostToken，于是本机立刻能推能收。
 *
 * 与 `provisionCall` 分开写而不是加个 `auth:false` 开关：两者的错误文案和后果完全不同
 * （这里失败意味着用户彻底用不了，必须给出人能读懂的原因）。
 */
/**
 * v0.7.9：给任何一次网络动作套上**硬超时**。
 *
 * 工作台式机实测（用户 m21760「感觉是卡住了呢」）：面板停在「正在校验凭据…」不动。
 * 真因不是逻辑走错，而是 HTTP 请求根本不返回 —— 没有超时的 fetch 会把整条自助开通挂在
 * 半空，而用户看到的只是「一直转」。凡是「用户按了按钮在等」的路径，一律必须有上界。
 */
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error((label || '操作') + '超时（' + Math.round(ms / 1000) + ' 秒）'))
    }, ms)
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

export async function enrollCall({ base, name, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') return { ok: false, error: '这个 Node 运行时没有 fetch，无法开通' }
  let res
  let ctl = null
  let timer = null
  try {
    if (typeof AbortController === 'function') {
      ctl = new AbortController()
      timer = setTimeout(() => { try { ctl.abort() } catch { /* 已中止 */ } }, 15000)
    }
    res = await withTimeout(fetchImpl(provisionUrl(base, 'enroll'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(name ? { name } : {}),
      signal: ctl ? ctl.signal : undefined,
    }), 15000, '开通服务')
  } catch (error) {
    return { ok: false, error: '开通服务不可达：' + String(error && error.message ? error.message : error) }
  } finally {
    if (timer) clearTimeout(timer)
  }
  let text = ''
  try { text = String(await res.text()) } catch { text = '' }
  let data = null
  try { data = JSON.parse(text) } catch { data = null }
  if (res.status === 429) {
    const why = data && data.error ? data.error : '配额已满'
    // v0.7.1：服务端会回 retryAfter 秒数，提示里要说清多久后能再试，
    // 否则用户只看到「太频繁」，不知道是等一分钟还是等一天。
    const wait = data && Number(data.retryAfter) > 0 ? Number(data.retryAfter) : 0
    const human = wait >= 3600 ? Math.ceil(wait / 3600) + ' 小时' : wait >= 60 ? Math.ceil(wait / 60) + ' 分钟' : (wait > 0 ? wait + ' 秒' : '稍后')
    return { ok: false, error: '开通太频繁：同一网络' + human + '内已用满名额，请等' + human + '后再试' + (why ? '（' + why + '）' : '') }
  }
  if (!res.ok) {
    const why = data && data.error ? data.error : text.slice(0, 120)
    return { ok: false, error: '开通服务返回 ' + res.status + (why ? '：' + why : '') }
  }
  if (!data || !data.topic || !data.readToken || !data.writeToken) {
    return { ok: false, error: '开通服务返回不完整（缺 topic / token）' }
  }
  return { ok: true, data }
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
    /** 一键开通成功后回调宿主「热重配 + 起轮询」（v0.7.0）。 */
    this.onEnrolled = deps.onEnrolled || null
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
    this.publishReady()
  }

  /**
   * 回写「本机是否已经有可用凭据」（v0.7.0）。
   *
   * 判据取 `this.resolved`（= 凭据文件 + profile + env 合成后的生效值），不看 volatile：
   * 页面要回答的是「这台机器现在能不能推」，而不是「上次谁点过按钮」。
   * topic 与 host 缺任一就不能推（RelayClient 会把 Authorization 写成空的 Bearer）。
   */
  publishReady() {
    const r = this.resolved || {}
    const ready = String(r.host || '') !== '' && String(r.hostToken || '') !== '' &&
      String(r.topic || '') !== '' && String(r.ntfyToken || '') !== ''
    const next = ready ? '1' : '0'
    if (this.read('provisionReady') !== next) this.write('provisionReady', next)
    return ready
  }

  /** volatile-update 发生在 settings RPC 的事务里 ⇒ 挪到下一个宏任务再跑（同 AskUserModeSwitch）。 */
  schedule() {
    if (this.scheduled) return
    this.scheduled = true
    setTimeout(() => {
      this.scheduled = false
      // Same rule as AskUserModeSwitch: never leave an unhandled rejection behind (the host
      // turns one into a fatal load failure and the whole process exits).
      Promise.resolve(this.run()).catch(() => {})
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
    // v0.7.6：`provisionSeq` 会被持久化进 cordis.patch.yml，而 `lastSeq` 只在内存里 ⇒
    // 每次宿主重启都会把「上一次的 enroll」再执行一遍（实测：VM1 重启后 topic 从 `dsh`
    // 变成新的 `dsh-local`，等于每次重启都白烧一次 /enroll 配额并换掉推送主题）。
    // 用持久化的 `provisionDone` 做幂等闸：这个请求号已经处理完就永不再跑。
    if (String(this.read('provisionDone') || '') === seq) return
    if (action !== 'issue' && action !== 'revoke' && action !== 'refresh' && action !== 'enroll') return
    this.lastSeq = seq
    this.busy = true
    const name = String(this.read('provisionName') || '').trim() || provisionNameSuggest(this.resolved)
    try {
      if (action === 'enroll') {
        // 一键开通（v0.7.0）：全新用户没有发号密钥，走免鉴权的 /enroll 领第一张通行证。
        // 成功即写凭据文件并把新值注入内存 + 重新起轮询，用户不必重启宿主就能收到第一条推送。
        const out = await enrollCall({
          base: this.resolved.provisionBase, name, fetchImpl: this.fetchImpl,
        })
        if (!out.ok) {
          this.write('provisionResult', '开通失败：' + out.error)
          this.log('自助开通失败：' + out.error)
        } else {
          const data = out.data || {}
          const text = passText({
            relayBase: data.relayBase || this.resolved.relayBase,
            topic: data.topic, readToken: data.readToken,
          })
          this.write('provisionResult', text)
          this.log('自助开通成功：topic=' + data.topic + '，通行证文本已回写页面')
          const patch = {
            host: data.host || data.topic,
            topic: data.topic,
            ntfyToken: data.writeToken,
            phoneToken: data.readToken,
          }
          if (data.hostToken) patch.hostToken = data.hostToken
          if (data.relayBase) patch.relayBase = data.relayBase
          if (data.answerBase) patch.answerBase = data.answerBase
          if (this.credentialsPath) {
            try {
              // 别名一起写（理由同 issue 分支）：credentials.mjs 里 ntfyToken 排在 writetoken
              // 之前，新值一定赢；但只写新键会把旧值留在文件里骗下一个读文件的人。
              const saved = this.writeCreds(this.credentialsPath, {
                host: patch.host,
                topic: patch.topic,
                ntfyToken: patch.ntfyToken, writeToken: patch.ntfyToken,
                phoneToken: patch.phoneToken, readToken: patch.phoneToken,
                ...(patch.hostToken ? { hostToken: patch.hostToken } : {}),
                ...(patch.relayBase ? { relayBase: patch.relayBase } : {}),
                ...(patch.answerBase ? { answerBase: patch.answerBase } : {}),
              })
              this.log('已写回凭据文件 ' + saved.path)
            } catch (error) {
              this.log('凭据文件写入失败：' + String(error && error.message ? error.message : error))
            }
          }
          // 内存态立刻生效：resolved 是各组件共享的那个对象，push 链路读的就是它。
          Object.assign(this.resolved, patch)
          this.publishReady()
          if (this.onEnrolled) {
            try { this.onEnrolled(patch) } catch (error) {
              this.log('开通后启用推送失败：' + String(error && error.message ? error.message : error))
            }
          }
        }
      } else if (action === 'issue') {
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
      // 处理完立刻清掉动作，避免补丁文件里留着一个「待执行」的 enroll 被误读。
      try { this.write('provisionAction', '') } catch { /* 清不掉也不致命，done 闸会兜住 */ }
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

/**
 * 远程访问（v0.4.0）的宿主侧壳：把 `RemoteAccess`（lib/remote.js）挂到插件生命周期上，
 * 并把运行态镜像回 `remote*` 那几个 volatile 字段给网页设置行看。
 *
 * 三条设计约束（都是踩过的坑换来的）：
 *
 * 1. **口令存凭据文件，不存 volatile**。浏览器写 volatile 会被持久化进 profile 的
 *    `cordis.patch.yml`（0.3.0 的通行证面板实测过），把长期口令写进用户的补丁文件既难看
 *    又难撤。所以 `remoteSecret` 只做「显示/输入」通道，真正的落盘走
 *    `writeCredentialsPatch(remoteSecret / remoteAccess)`，下次开机由 `resolvePluginConfig`
 *    从凭据文件读回来。
 * 2. **改 volatile 会热重启本插件 fiber** ⇒ 任何持久化都不能在同一次 `run()` 里做完就指望
 *    内存还活着。做法与 PassProvisioner 相同：结果挂到进程级 store，新 fiber 启动时回灌。
 * 3. **失败绝不致命**：起不来隧道只是 `remoteStatus` 有值，推送/作答链路完全不受影响。
 *    宿主会把未处理的 rejection 当致命加载错误并退出进程，所以所有入口都吞掉异常。
 */
export class RemoteAccessor {
  constructor(ctx, config, resolved, host, log, deps = {}) {
    this.ctx = ctx
    this.config = config
    this.resolved = resolved
    this.host = host
    this.log = log
    this.writeCreds = deps.writeCredentialsPatch || writeCredentialsPatch
    this.credentialsPath = deps.credentialsPath || ''
    this.engine = null
    this.busy = false
    this.scheduled = false
    this.lastSeq = ''
    /** 上一次推给手机的地址，避免隧道抖动时反复推送。 */
    this.pushedUrl = ''
    /** 正在把凭据文件里的开关状态回写进 volatile（此时的 volatile-update 不是用户操作）。 */
    this.mirroring = false
    /** 引擎工厂（自测注入；生产就是 new RemoteAccess）。 */
    this.makeEngine = typeof deps.makeEngine === 'function' ? deps.makeEngine : (options) => new RemoteAccess(options)
    /** 「隧道迟迟没有地址」的兜底看门狗。 */
    this.watchTimer = null
  }

  read(key) { return volatileValue(this.config[key], '') }

  /**
   * 读一个「既可能在 volatile 里（本次会话刚改）、也可能只在凭据文件里」的配置。
   *
   * 2026-10-28 修的缺陷：`read()` 只看 `this.config[key]`，而 `Config` schema 的默认值是空串，
   * 凭据文件里的值落在 `this.resolved` 上 ⇒ 只读 config 就等于永远读不到存盘的口令，**每次开机
   * 都会重新生成一串新口令**，昨天推给手机的 30 天链接当天就失效。凡是持久化的键都必须走这里。
   */
  readAny(key) {
    const live = this.read(key)
    if (live !== '' && live !== undefined && live !== null && live !== false) return live
    const saved = this.resolved ? this.resolved[key] : undefined
    return saved === undefined || saved === null ? '' : saved
  }

  write(key, value) { setVolatileValue(this.config, key, value) }

  storeKey() {
    return 'remote|' + String(this.resolved.host || '') + '|' + String(this.credentialsPath || '')
  }

  /** 把最近状态回灌进当前 fiber（fiber 刚被热重启时设置行不该是空的）。 */
  applyStore() {
    const saved = remoteStore()[this.storeKey()]
    if (!saved) return
    this.write('remoteUrl', String(saved.url || ''))
    this.write('remoteStatus', String(saved.status || ''))
    this.write('remotePhase', String(saved.phase || ''))
    this.write('remotePushResult', String(saved.pushResult || ''))
    this.write('remoteDone', String(saved.done || ''))
  }

  saveStore() {
    remoteStore()[this.storeKey()] = {
      url: String(this.read('remoteUrl') || ''),
      status: String(this.read('remoteStatus') || ''),
      phase: String(this.read('remotePhase') || ''),
      pushResult: String(this.read('remotePushResult') || ''),
      done: String(this.read('remoteDone') || ''),
    }
  }

  /** 停掉本实例的网关与隧道（v0.7.12：被新实例接管时调用，也供设置行「关闭远程访问」复用）。 */
  disposeEngine(reason) {
    if (this.watchTimer) {
      clearTimeout(this.watchTimer)
      this.watchTimer = null
    }
    const engine = this.engine
    this.engine = null
    if (!engine) return
    try { engine.dispose() } catch { /* 已经停了 */ }
    this.log('远程访问：已停掉本实例的网关与隧道（' + String(reason || '') + '）')
  }

  /**
   * 把值写进 volatile，但**不让自己的 volatile-update 监听把它当成用户操作**（否则会再跑一遍
   * persistEnabled/up，无限自激）。设置行读的是 volatile，开机时必须回灌一次，否则口令框是空的、
   * 复制链接也复制不出东西。
   */
  mirror(key, value) {
    if (this.read(key) === value) return
    this.mirroring = true
    try { this.write(key, value) } finally { this.mirroring = false }
  }

  /** 口令：配置里的（凭据文件/补丁）优先，都没有就生成一串并存盘。 */
  ensureSecret() {
    const given = String(this.readAny('remoteSecret') || '').trim()
    if (given.length >= 16) return given
    const generated = newRemoteSecret()
    this.write('remoteSecret', generated)
    this.persist({ remoteSecret: generated })
    this.log('已生成远程访问口令（32 字节随机；存进凭据文件，不在补丁里）')
    return generated
  }

  /** 落盘（凭据文件）；用于口令与开关，避免它们进 cordis.patch.yml。 */
  persist(patch) {    if (!this.credentialsPath) return
    try {
      const saved = this.writeCreds(this.credentialsPath, patch)
      this.log('远程访问设置已写回凭据文件 ' + saved.path)
    } catch (error) {
      this.log('写凭据文件失败：' + String(error?.message ?? error))
    }
  }

  /**
   * 手机链接走哪条路（v0.5.0，用户 m16379）：`tunnel` = 公网隧道，`tailnet` = 原来的地址。
   * 空串按 tailnet 处理 —— 这样老用户升级后行为一模一样（他们根本没写过这个键）。
   */
  readMode() {
    const raw = String(this.readAny('linkMode') || this.resolved?.linkMode || '').trim()
    // 空串（从没选过）按 tunnel 处理 —— 这个功能本身就是隧道；v0.4.x 用户升级后行为不变。
    return raw === 'tailnet' ? 'tailnet' : 'tunnel'
  }

  /** 模式落盘（凭据文件；偏好放这里就能跟随这台机器，而 volatile 重启会丢）。 */
  persistMode(mode) {
    this.persist({ linkMode: mode === 'tunnel' ? 'tunnel' : 'tailnet' })
  }

  /** 起引擎（幂等）。@returns {Promise<void>} */
  async up() {
    // tailnet 模式不需要隧道：不下载 cloudflared、不起网关，只把「用你自己的地址」这件事说清楚。
    // 这条分支是「不能影响到已装 Tailscale 的用户」的硬保证（m16379）。
    if (this.readMode() === 'tailnet') {
      if (this.engine) {
        try { this.engine.dispose() } catch { /* 已经停了 */ }
        this.engine = null
      }
      this.write('remotePhase', '已就绪（使用 Tailscale / 你自己的地址）')
      this.write('remoteStatus', '')
      this.write('remoteUrl', '')
      this.saveStore()
      return
    }
    const secret = this.ensureSecret()
    this.mirror('remoteSecret', secret)
    // v0.7.11（用户 m128886「远程访问一直卡住」）：隧道层的失败以前只进日志、不进设置行，
    // 于是 cloudflared 起不来时用户看到的是「隧道建立中…」永远转下去。
    // v0.7.12：这三个回调抽出来单放，因为继承来的引擎里它们还指着**旧实例**的 config
    // （旧 fiber 已经死了，写进去等于扔进黑洞）——必须每次 up() 重新接线。
    const callbacks = {
      onUrl: (url) => this.onUrl(url),
      onError: (message) => {
        const text = String(message || '').trim()
        if (text === '') return
        this.write('remotePhase', '隧道未建立')
        this.write('remoteStatus', text)
        this.saveStore()
      },
      onPhase: (phase) => {
        this.write('remotePhase', String(phase))
        this.saveStore()
      },
    }
    if (!this.engine) {
      this.engine = this.makeEngine({
        log: this.log,
        secret,
        binPath: String(this.readAny('remoteBin') || ''),
        webLog: this.resolved.webLog,
        port: Number(this.readAny('remotePort') || 0) || 0,
        ...callbacks,
      })
    } else {
      this.engine.setSecret(secret)
      this.engine.onUrl = callbacks.onUrl
      this.engine.onError = callbacks.onError
      this.engine.onPhase = callbacks.onPhase
      // 继承来的引擎可能已经拿到地址了：立刻回灌，别让设置行空着再去等一次。
      if (String(this.engine.url || '') !== '') this.onUrl(this.engine.url)
    }
    this.log('远程访问：开始拉隧道（up）')
    this.write('remotePhase', '正在连接…')
    this.write('remoteStatus', '')
    // v0.7.12：看门狗**先挂上**再 await。0.7.11 挂在 start() 之后，而 start() 内部的
    // fetch / 下载没有超时，一旦卡住连兜底文案都轮不到（2026-10-30 笔电实测就停在这句上）。
    this.watchUrl(75000)
    try {
      const state = await this.engine.start()
      this.log('远程访问：start() 返回 running=' + String(state.running) +
        ' url=' + JSON.stringify(state.url || '') + ' error=' + JSON.stringify(state.error || ''))
      if (state.running === false) {
        this.write('remotePhase', '未运行')
        this.write('remoteStatus', state.error || '启动失败')
        return
      }
      // v0.7.11：网关起来了但**隧道没起来**（找不到 cloudflared、下载失败、spawn 失败）时
      // 以前被当成「还在建立」，`state.error` 被无声丢弃 —— 这是 m128886「一直卡住」的另一半。
      if (state.error) {
        this.write('remotePhase', '隧道未建立')
        this.write('remoteStatus', String(state.error))
        this.saveStore()
        return
      }
      // 地址可能比 server.listen 晚几秒才拿到（等 cloudflared），先给个中间态。
      if (!state.url) {
        this.write('remotePhase', '隧道建立中…')
        this.watchUrl(75000)
      }
    } catch (error) {
      this.write('remotePhase', '未运行')
      this.write('remoteStatus', '启动失败：' + String(error?.message ?? error))
      this.log('远程访问启动失败：' + String(error?.message ?? error))
    }
  }

  /**
   * 兜底看门狗（v0.7.11）：75 秒还拿不到公网地址就给一句人话。
   * 隧道层的失败现在由 engine 的 onError 实时上报，这里只处理「三者都没说话」的静默卡死。
   */
  watchUrl(ms) {
    if (this.watchTimer) clearTimeout(this.watchTimer)
    this.watchTimer = setTimeout(() => {
      this.watchTimer = null
      try {
        if (String(this.read('remoteUrl') || '') !== '') return
        if (String(this.read('remoteStatus') || '').trim() !== '') return
        this.write('remotePhase', '隧道未建立')
        this.write('remoteStatus', '隧道 ' + String(Math.round(ms / 1000)) + ' 秒还没建起来（cloudflared 没有任何回应）。' +
          '点「重建隧道」再试；这台机器要能访问 api.trycloudflare.com')
        this.saveStore()
      } catch { /* fiber 已经走了 */ }
    }, ms)
    if (typeof this.watchTimer.unref === 'function') this.watchTimer.unref()
  }

  /** 引擎拿到公网地址（或换了地址）时：镜像 + 首次/变更时推手机。 */
  onUrl(url) {
    this.write('remoteUrl', url)
    this.write('remotePhase', '隧道建立中…')
    this.write('remoteStatus', '')
    this.saveStore()
    const secret = String(this.readAny('remoteSecret') || '')
    if (this.pushedUrl === url) return
    this.pushedUrl = url
    // 先等 Cloudflare 边缘真的挂上再推（否则用户点开是 530 报错页，实测 3~8 秒）。
    Promise.resolve()
      .then(() => this.engine?.waitPublic?.())
      .then((ok) => {
        this.write('remotePhase', ok === false ? '已就绪（边缘可能还要几秒）' : '已就绪')
        this.saveStore()
        return this.pushLink(secret)
      })
      .catch(() => {})
  }

  /** 把 30 天链接经 ntfy 送到手机（复用 RelayClient，不新增通道）。 */
  async pushLink(secret) {
    // tailnet 模式下没有隧道地址：通知里那条 #web 链接本身就是用户可达的入口，
    // 不需要再推一条。这里返回一句人话，免得设置行显示「还没有可用地址」让人困惑。
    if (this.readMode() === 'tailnet') {
      this.write('remotePushResult', '当前用 Tailscale / 自定义地址：通知里的链接就能直接打开，无需单独推送')
      this.saveStore()
      return { ok: false, error: 'tailnet 模式不需要推送隧道链接' }
    }
    const url = String(this.read('remoteUrl') || '')
    if (!url || !secret) return { ok: false, error: '还没有可用地址' }
    if (!this.host || this.host.enabled !== true) return { ok: false, error: '推送通道未配置（先配通行证）' }
    const link = remoteMessage(url, secret)
    try {
      const result = await this.host.relay.push({
        title: 'DSH 远程访问地址',
        body: '手机/异地浏览器打开这个链接即可（30 天免登录）：\n' + link,
        priority: 3,
        tags: ['globe_with_meridians'],
      })
      const ok = result?.status === 200
      this.write('remotePushResult', ok ? '已推送到手机' : ('推送失败：HTTP ' + String(result?.status)))
      this.log('远程链接推送 -> HTTP ' + String(result?.status))
      this.saveStore()
      return { ok }
    } catch (error) {
      this.write('remotePushResult', '推送异常：' + String(error?.message ?? error))
      this.saveStore()
      return { ok: false, error: String(error?.message ?? error) }
    }
  }

  /** volatile-update 发生在 settings RPC 事务里 ⇒ 挪到下一个宏任务（同 PassProvisioner）。 */
  schedule() {
    if (this.scheduled) return
    this.scheduled = true
    setTimeout(() => {
      this.scheduled = false
      Promise.resolve(this.run()).catch(() => {})
    }, 0)
  }

  /** 处理设置行的动作：push / reconnect / rotate。 */
  async run() {
    const seq = String(this.read('remoteSeq') || '')
    const action = String(this.read('remoteAction') || '')
    if (this.busy || seq === '' || seq === this.lastSeq) return
    if (action !== 'push' && action !== 'reconnect' && action !== 'rotate') return
    this.lastSeq = seq
    this.busy = true
    try {
      if (action === 'push') {
        await this.pushLink(String(this.readAny('remoteSecret') || ''))
      } else if (action === 'reconnect') {
        if (this.engine) this.engine.dispose()
        this.engine = null
        this.pushedUrl = ''
        await this.up()
      } else if (action === 'rotate') {
        const fresh = newRemoteSecret()
        this.write('remoteSecret', fresh)
        this.persist({ remoteSecret: fresh })
        if (this.engine) this.engine.setSecret(fresh)
        this.pushedUrl = ''
        this.write('remotePushResult', '')
        this.write('remoteStatus', '')
        this.log('远程访问口令已更换')
        await this.pushLink(fresh)
      }
    } catch (error) {
      this.write('remoteStatus', String(error?.message ?? error))
    } finally {
      this.write('remoteDone', seq)
      this.busy = false
      this.saveStore()
    }
  }

  /** 开关的权威值：volatile（本次会话刚点过）优先，否则看凭据文件里的 `remoteEnabled`。 */
  isEnabled() {
    if (this.read('remoteAccess') === true) return true
    return String(this.resolved?.remoteEnabled || '') === 'on'
  }

  /** 开关落盘（凭据文件；`off` 而不是删键——writeCredentialsPatch 只并非空字符串）。 */
  persistEnabled(on) {
    this.persist({ remoteEnabled: on ? 'on' : 'off' })
  }

  start() {
    // v0.7.12：**新实例接管旧实例的网关与隧道**。
    // 每次浏览器写 volatile（连不上就点「重建隧道」= remoteSeq/remoteAction 落进 cordis.patch.yml）
    // 都会热重启本插件 fiber，于是新建一个 RemoteAccessor + RemoteAccess；旧实例的 http server
    // 与 cloudflared 子进程没有人 dispose —— 2026-10-30 笔电实测积累了 5 个网关端口
    // （1462/7327/7328/8693/8714）和 4 个 cloudflared。它们抢着往设置行写 phase，界面就会一会儿
    // 「正在连接…」一会儿「隧道建立中…」，而真正拿到的地址挂在已经没人看的旧实例上。
    const previous = REMOTE_ACTIVE.get(this.storeKey())
    REMOTE_ACTIVE.set(this.storeKey(), this)
    if (previous && previous !== this) {
      // 优先**继承**旧实例的引擎：地址不变、用户手里的链接不用换，也不留僵尸进程。
      // 只有旧引擎已经停了才走「接管 + 销毁」这条兜底。
      if (previous.engine && previous.engine.disposed !== true) {
        this.engine = previous.engine
        previous.engine = null
        if (previous.watchTimer) {
          clearTimeout(previous.watchTimer)
          previous.watchTimer = null
        }
        this.log('远程访问：继承上一个实例的网关与隧道（公网地址保持不变）')
      } else {
        try { previous.disposeEngine('新实例接管') } catch { /* 旧 fiber 已经死了 */ }
      }
    }
    this.applyStore()
    const enabled = this.isEnabled()
    // 设置行的开关读的是 volatile 的 `remoteAccess`；开机时它总是默认 false，而真值在凭据文件里。
    // 不把真值写回去，界面就会显示「开启远程访问」而隧道其实正在跑（用户会以为开关坏了）。
    if (enabled && this.read('remoteAccess') !== true) {
      // 自己写自己监听：不设这个闸，下面那个 volatile-update 分支会把它当成「用户刚点开启」
      // 再跑一遍 persistEnabled + up()（会多写一次凭据文件、多启一次引擎）。
      this.mirroring = true
      try { this.write('remoteAccess', true) } finally { this.mirroring = false }
    }
    const mine = ['remoteSeq', 'remoteAction', 'remoteAccess', 'remoteSecret', 'linkMode']
    this.ctx.on('loader/volatile-update', (paths) => {
      if (this.mirroring) return
      const touched = Array.isArray(paths) && paths.some((path) =>
        Array.isArray(path) && mine.includes(path[0]))
      if (!touched) return
      // 开关/口令是「配置」类变化，不需要请求号；直接按新配置重启引擎。
      const switched = Array.isArray(paths) && paths.some((path) =>
        Array.isArray(path) && (path[0] === 'remoteAccess' || path[0] === 'remoteSecret' || path[0] === 'linkMode'))
      if (switched) {
        setTimeout(() => {
          const on = this.read('remoteAccess') === true
          this.persistEnabled(on)
          // 选了哪条路也要落盘：volatile 会随重启丢，而这个选择是用户偏好。
          this.persistMode(this.readMode())
          if (on) { Promise.resolve(this.up()).catch(() => {}) } else if (this.engine) {
            this.engine.dispose()
            this.engine = null
            this.write('remotePhase', '未开启')
            this.write('remoteUrl', '')
            this.saveStore()
          }
        }, 0)
        return
      }
      this.schedule()
    })
    if (!enabled) {
      this.write('remotePhase', '未开启')
      this.log('远程访问未开启（设置 → 常规 → 远程访问 里可打开）')
      return
    }
    // 本次 volatile 说开着、但凭据文件里还不是 on ⇒ 补齐。否则「第一次点开启」之后只要没
    // 走到 volatile-update 那条分支（例如开关值随 config 一起来），下次开机就又变回关着。
    if (this.read('remoteAccess') === true && String(this.resolved?.remoteEnabled || '') !== 'on') {
      this.persistEnabled(true)
    }
    Promise.resolve(this.up()).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// 扫码配对（v0.6.0）
//
// 网页设置行点「生成二维码」→ 浏览器写一个随机串进 volatile `pairSeq` → 这里算出配对载荷
//
//   dshpush://v1?base=&topic=&token=&web=&name=
//
// 再把「点阵」镜像回 volatile（pairCount / pairBits / pairText / pairStatus / pairDone），
// 设置行用 canvas 画出来。手机 App 扫这一张，就同时拿到推送通行证**和**网页入口，不用手抄。
//
// 三条设计约束（都是踩过的坑换来的）：
//
// 1. **只回点阵，不回 SVG / data URL**。volatile 写入会持久化进 profile 的 `cordis.patch.yml`
//    （0.3.0 的通行证面板实测过），几十 KB 的 data URL 会把用户的补丁文件撑起来；57×57 点阵的
//    行优先位图 base64 只有 544 字节。
// 2. **改 volatile 会热重启本插件 fiber** ⇒ 结果挂进程级 store，新 fiber 启动时回灌，否则设置行
//    里的二维码会闪一下就消失（与 PassProvisioner / RemoteAccessor 同款做法）。
// 3. **绝不阻塞推送**：任何异常只落到 `pairStatus`，不抛。
//
// 载荷里 `web` 是「这台机器手机可达的网页入口」：隧道模式 = 公网地址 + 口令，tailnet / 自定义
// 模式 = web.log 里那条本机地址。取不到就留空，App 会退化成分开填，绝不产出打不开的链接。
const PAIR_SEQ_RE = /^[A-Za-z0-9_-]{0,64}$/

/** 配对面板的进程级暂存（同 remoteStore 的理由：volatile 写入会热重启 fiber）。 */
export const PAIR_STORE_KEY = '__DSHPUSH_PAIR__'

export function pairStore() {
  const g = globalThis
  if (!g[PAIR_STORE_KEY]) g[PAIR_STORE_KEY] = {}
  return g[PAIR_STORE_KEY]
}

/** 认领「当前 fiber」的配对面板（只用来给热重启后的新 fiber 判活）。 */
const PAIR_ACTIVE = new Map()

export class PairBox {
  constructor(ctx, config, resolved, host, log, deps = {}) {
    this.ctx = ctx
    this.config = config
    this.resolved = resolved
    this.host = host
    this.log = log
    /** RemoteAccessor：隧道模式下从它那里取公网地址与口令。 */
    this.accessor = deps.accessor || null
    this.credentialsPath = deps.credentialsPath || ''
    this.lastSeq = ''
    this.busy = false
    this.scheduled = false
    this.mirroring = false
    /**
     * v0.7.6：二维码的意义就是「不用手工配」。没有凭据时点「生成二维码」就直接自动走一次
     * 免密钥 /enroll，这里记住已经为哪个请求号发起过开通，避免开通失败后被无限重试。
     */
    this.enrollTried = ''
    /**
     * v0.7.8：这一次「生成二维码」请求是否已经做过凭据预检。
     *
     * 0.7.6 的判据是「relay/topic/token 三个字段是不是空」——而工作台式机实测踩到了反例：
     * 整机装好后扫码，手机报「通行证被拒(403)」。那台机器字段一个都不缺，缺的是**凭据本身
     * 已经无效**（历史手工配的 topic/令牌）。⇒ 判据必须从「有没有配」升级成「配的能不能用」。
     */
    this.checkTried = ''
    this.preparing = false
    this.prepareError = ''
    /** v0.7.8：本次会话刚开通出来的凭据（优先于 volatile 里的历史值，见 cred()）。 */
    this.freshCreds = null
    /** v0.7.6：自助开通走这里发起，自测与宿主都可以注入（默认就是真的 /enroll）。 */
    this.enrollCall = deps.enrollCall || enrollCall
    this.writeCreds = deps.writeCredentialsPatch || writeCredentialsPatch
    /** v0.7.8：凭据预检可注入（自测用；默认真的向中继探一次）。 */
    this.verifyCredsFn = deps.verifyCreds || null
    /** v0.7.9：预检上界（自测可调小，避免用例等 10 秒）。 */
    this.verifyTimeoutMs = Number(deps.verifyTimeoutMs) > 0 ? Number(deps.verifyTimeoutMs) : 10000
  }

  /**
   * v0.7.8：读一个凭据键，**本次会话刚开通出来的值优先**。
   *
   * `readAny()` 的优先级是 volatile > resolved，而 volatile 会把值持久化进 profile 的
   * `cordis.patch.yml`。旧版通行证面板（0.3.0）写进去的 `topic` 就留在这类文件里，
   * 于是即使刚刚 /enroll 出一套新凭据，`readAny('topic')` 仍会返回那个历史 topic，
   * 二维码里就会出现「新令牌 + 旧 topic」这种必然 403 的混合载荷。
   * 这里让刚开通的值最优先，等于把「历史遗留」按这一次会话压掉。
   */
  cred(key) {
    const fresh = this.freshCreds && this.freshCreds[key]
    if (fresh !== undefined && fresh !== null && fresh !== '') return String(fresh)
    return String(this.readAny(key) || '')
  }

  /**
   * v0.7.8：凭据能不能真的用——直接拿手机只读令牌向中继订一次。
   *
   * 用 `?poll=1&since=1h` 而不是订阅流：一次请求就结束，不会占住连接。
   * 有效凭据返回 200（哪怕这一个小时没有消息），topic 不存在或令牌不对返回 401/403。
   * 任何异常一律当「无效」——预检的目的就是宁可多开一次号，也不要放一张扫了没用的码出去。
   */
  async verifyCreds() {
    const base = this.cred('relayBase').replace(/\/+$/, '')
    const topic = this.cred('topic')
    const token = this.cred('phoneToken')
    if (!base || !topic || !token) return false
    const url = base + '/' + encodeURIComponent(topic) + '/json?poll=1&since=1h'
    let ctl = null
    let timer = null
    try {
      if (typeof AbortController === 'function') {
        ctl = new AbortController()
        timer = setTimeout(() => { try { ctl.abort() } catch { /* 已中止 */ } }, 8000)
      }
      const res = await fetch(url, {
        headers: { Authorization: 'Bearer ' + token },
        signal: ctl ? ctl.signal : undefined,
      })
      if (res.ok) return 'ok'
      // v0.7.9：区分「明确被拒」与「问不出来」。401/403 是确定无效（换凭据）；其余状态码
      // 与任何异常都只能说「没核实成功」——两者都要重新开通，但**文案必须不一样**，
      // 否则用户永远分不清「凭据坏了」和「这台机器连不上中继」。
      if (res.status === 401 || res.status === 403) {
        this.log('凭据预检被拒：HTTP ' + res.status + '（topic ' + topic + '，将重新开通）')
        return 'bad'
      }
      this.log('凭据预检没拿到结论：HTTP ' + res.status + '（topic ' + topic + '）')
      return 'unknown'
    } catch (error) {
      this.log('凭据预检异常：' + String(error && error.message ? error.message : error))
      return 'unknown'
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /**
   * v0.7.8：一个请求号只预检一次；预检不过就当场免密钥自助开通，然后重算二维码。
   *
   * `checkTried` 在**进来第一件事**就置位（不是成功才置），否则开通失败会让 refresh()
   * 反复触发预检 → 反复 /enroll，把中继的按 IP 日配额烧光。
   */
  async prepare(key) {
    this.checkTried = key
    this.prepareError = ''
    try {
      // 预检也要有上界：注入的/真实的探活一旦不返回，整条开通就挂在半空（同 m21760）。
      const verdict = await withTimeout(
        Promise.resolve(this.verifyCredsFn ? this.verifyCredsFn() : this.verifyCreds()),
        this.verifyTimeoutMs,
        '凭据预检',
      )
      if (verdict === true || verdict === 'ok') return
      // 'bad' = 明确被拒；'unknown' = 没问到结论。两种都不能拿现有凭据出码：
      // 前者必然 403，后者可能必然 403，而二维码是「一锤子交付」，不能赌。
      this.enrolling = true
      await this.autoEnroll(key)
    } catch (error) {
      this.prepareError = '凭据校验异常：' + String(error && error.message ? error.message : error)
      this.log(this.prepareError)
      this.enrolling = false
    } finally {
      this.preparing = false
      this.enrolling = false
      // v0.7.9：直调 refresh()，不走 schedule()。schedule() 里那句 fiberIsActive 守卫会把
      // 「预检期间经历过热重启」这种情况下的收尾静默丢掉 —— 而收尾就是用户等的那张码。
      try { this.refresh() } catch { this.schedule() }
    }
  }

  read(key) { return volatileValue(this.config[key], '') }

  /** 与 RemoteAccessor.readAny 同义：volatile 优先，其次凭据文件解析出来的 resolved。 */
  readAny(key) {
    const live = this.read(key)
    if (live !== '' && live !== undefined && live !== null && live !== false) return live
    const saved = this.resolved ? this.resolved[key] : undefined
    return saved === undefined || saved === null ? '' : saved
  }

  write(key, value) { setVolatileValue(this.config, key, value) }

  storeKey() {
    return 'pair|' + String(this.resolved?.host || '') + '|' + String(this.credentialsPath || '')
  }

  mirror(key, value) {
    if (this.read(key) === value) return
    this.mirroring = true
    try { this.write(key, value) } finally { this.mirroring = false }
  }

  applyStore() {
    const saved = pairStore()[this.storeKey()]
    if (!saved) return
    this.mirror('pairCount', Number(saved.count) || 0)
    this.mirror('pairBits', String(saved.bits || ''))
    this.mirror('pairText', String(saved.text || ''))
    this.mirror('pairStatus', String(saved.status || ''))
    this.mirror('pairDone', String(saved.done || ''))
  }

  /**
   * 把一次计算结果同时挂到进程级 store（供热重启后的新 fiber 回灌）与 volatile（供页面读）。
   *
   * v0.7.3：**先 store 后 volatile**。写 volatile 会让本插件 fiber 热重启，而 applyStore 只认
   * store；顺序反了，重启刚好落在 mirror 中间，新 fiber 的 store 还是空的 ⇒ 二维码白算一场，
   * 页面什么都不显示（用户报的「点完等很久也没出二维码」就是这个）。
   */
  remember(result) {
    try {
      pairStore()[this.storeKey()] = result
    } catch { /* store 挂了不影响下面的 volatile 写入 */ }
  }

  /**
   * 手机可达的网页入口。
   *
   * 隧道模式必须带上口令（`?k=`），否则手机上打开只有 401；tailnet / 自定义地址走 web.log
   * 里那条本机地址（手机在同一 tailnet 里可直接访问）。
   */
  webEntry() {
    try {
      if (this.accessor && typeof this.accessor.read === 'function') {
        const mode = String(this.accessor.readAny ? this.accessor.readAny('linkMode') : '').trim()
        const url = String(this.accessor.read('remoteUrl') || '').replace(/\/+$/, '')
        const secret = String(this.accessor.readAny ? this.accessor.readAny('remoteSecret') : '' || '')
        if (mode !== 'tailnet' && url && secret) return url + '/?k=' + encodeURIComponent(secret)
      }
    } catch { /* 取不到就走下面的本机地址 */ }
    try {
      return this.host.webUrl('')
    } catch {
      return ''
    }
  }

  /**
   * v0.7.6：免密钥自助开通（点「生成配对二维码」时没有凭据就自动走这里）。
   *
   * 复用 v0.7.0 一键开通那套 `/enroll` 语义，但不经过 volatile 请求号——那条路径要经过
   * PassProvisioner 的轮询，而这里已经在 PairBox 的异步回调里，直接调更短也更好排错。
   * 全程**不在 await 期间写 volatile**（写 volatile 会让本插件 fiber 热重启，把这次开通腰斩），
   * 所以顺序是：先联网 → 写凭据文件 → 同步内存 resolved → 最后才镜像状态并重算二维码。
   */
  async autoEnroll(key) {
    this.enrollTried = key
    this.enrolling = true
    try {
      const name = provisionNameSuggest(this.resolved)
      const out = await this.enrollCall({ base: this.resolved.provisionBase, name })
      if (!out.ok) {
        this.log('生成二维码时自助开通失败：' + out.error)
        // v0.7.8：把原因留给 prepare()/refresh() —— 否则随后的重算会用一句笼统的
        // 「自助开通未成功」盖掉真正的原因（中继日配额用尽 / 中继离线 / 服务已满都长一样）。
        this.prepareError = '自助开通失败：' + out.error
        this.enrolling = false
        try {
          this.remember({ count: 0, bits: '', text: '', status: '自助开通失败：' + out.error, done: '' })
          this.mirror('pairStatus', '自助开通失败：' + out.error)
        } catch { /* 连写都失败就只剩日志 */ }
        return
      }
      const data = out.data || {}
      const patch = {
        host: data.host || data.topic,
        topic: data.topic,
        ntfyToken: data.writeToken,
        phoneToken: data.readToken,
      }
      if (data.hostToken) patch.hostToken = data.hostToken
      if (data.relayBase) patch.relayBase = data.relayBase
      if (data.answerBase) patch.answerBase = data.answerBase
      if (this.credentialsPath) {
        try {
          // 别名一起写（理由同 PassProvisioner）：文件里两只 token 的新旧必须一致，
          // 只写新键会把旧值留在文件里骗下一个读文件的人。
          const saved = this.writeCreds(this.credentialsPath, {
            host: patch.host,
            topic: patch.topic,
            ntfyToken: patch.ntfyToken, writeToken: patch.ntfyToken,
            phoneToken: patch.phoneToken, readToken: patch.phoneToken,
            ...(patch.hostToken ? { hostToken: patch.hostToken } : {}),
            ...(patch.relayBase ? { relayBase: patch.relayBase } : {}),
            ...(patch.answerBase ? { answerBase: patch.answerBase } : {}),
          })
          this.log('自助开通成功，已写回凭据文件 ' + saved.path)
        } catch (error) {
          this.log('凭据文件写入失败：' + String(error && error.message ? error.message : error))
        }
      }
      // 内存态立刻生效：resolved 是各组件共享的那个对象，push 链路读的就是它。
      // v0.7.8：另外单独存一份 freshCreds —— readAny() 的 volatile 优先级更高，历史遗留的
      // topic/令牌会把它压住，二维码就会拼出「新令牌 + 旧 topic」这种必然 403 的载荷。
      this.freshCreds = patch
      this.prepareError = ''
      Object.assign(this.resolved, patch)
      try { this.host.rearm(patch) } catch (error) {
        this.log('开通后启用推送失败：' + String(error && error.message ? error.message : error))
      }
      this.enrolling = false
      // 最后才排下一次计算：此时凭据已经在内存里，refresh() 能真正出码。
      this.schedule()
    } catch (error) {
      this.enrolling = false
      this.prepareError = '自助开通异常：' + String(error && error.message ? error.message : error)
      this.log('生成二维码时自助开通异常：' + String(error && error.message ? error.message : error))
      try { this.mirror('pairStatus', '自助开通异常：' + String(error && error.message ? error.message : error)) } catch { /* 已记日志 */ }
    }
  }

  payload() {
    return pairPayload({
      relayBase: this.cred('relayBase'),
      topic: this.cred('topic'),
      readToken: this.cred('phoneToken'),
      web: this.webEntry(),
      name: String(this.resolved?.host || ''),
    })
  }

  /** 生成一次二维码并把点阵镜像回 volatile（同步、无 IO 之外的重活）。 */
  refresh() {
    if (this.busy) { this.scheduled = true; return }
    this.busy = true
    try {
      const payload = this.payload()
      const web = this.webEntry()
      // 空载荷（relayBase/topic/token 都没配）也会拼出 `dshpush://v1?`：扫出来是个「什么都没配」
      // 的方形，比不画更坏。所以这里按「能真正配对」判：topic 与手机只读令牌缺一不可。
      const topic = this.cred('topic')
      const token = this.cred('phoneToken')
      const seqNow = String(this.read('pairSeq') || '').trim()
      const keyNow = seqNow === '' ? 'auto' : seqNow
      const fail = (why) => {
        // 失败也要落 store：applyStore 只从 store 回灌，否则热重启后页面的提示会消失，
        // 用户看到的是「点了没反应」而不是「为什么没成」。
        this.remember({ count: 0, bits: '', text: '', status: why, done: '' })
        this.mirror('pairCount', 0)
        this.mirror('pairBits', '')
        this.mirror('pairText', '')
        this.mirror('pairStatus', why)
      }
      // v0.7.8：先预检再出码。0.7.6 只在「字段为空」时才走自助开通，于是工作台式机那种
      // 「字段都在、凭据已失效」的机器会拿到一张必然 403 的码。这里改成：每个请求号先探一次
      // 中继（见 verifyCreds），探不过就当场 /enroll 换一套新凭据，然后再算二维码。
      if (this.checkTried !== keyNow) {
        if (!this.preparing && !this.enrolling) {
          this.preparing = true
          // v0.7.9：**这里绝不能先 fail()/mirror() 再启动预检**。
          // 写 volatile 会让本插件 fiber 热重启（见 §7.4 那串踩坑记录），而这次预检正跑在
          // 即将被丢弃的那个实例上 ⇒ 它跑完调 schedule() 时 `fiberIsActive(旧 ctx)` 恒为 false，
          // 于是被静默丢弃。用户看到的就是面板永远停在「正在校验凭据…」（m21760 报障）。
          // 服务端那份「正在校验」的文案交给页面自己的按钮转圈表达，守卫只留最后一次写。
          void this.prepare(keyNow)
        }
        return
      }
      if (this.prepareError) {
        // 预检/开通这一步有真原因就直说，不要退回到「字段在不在」那种笼统判断。
        fail(this.prepareError)
        return
      }
      if (!payload || payload.length < 12 || topic === '' || token === '') {
        // v0.7.6：二维码存在的意义就是「不用手工配 relay/topic/readToken」。
        // 预检判定凭据不可用时，prepare() 已经当场走过一次 /enroll；走到这里还没凭据就是真没成。
        fail(this.prepareError || '自助开通未成功，请再点一次「生成配对二维码」重试')
        return
      }
      if (web.length > PAIR_WEB_MAX) {
        fail('网页入口过长（' + web.length + ' 字符，上限 ' + PAIR_WEB_MAX + '），已跳过')
        return
      }
      const matrix = pairQrMatrix(payload)
      const status = web
        ? '已生成：手机扫这一张就完成配对（推送通行证 + 网页入口都带上）'
        : '已生成：手机扫这一张可完成推送配对。注意：本机暂时取不到网页入口（web.log 里没有 token，或隧道还没起来），网页地址仍需手工填'
      const done = String(this.read('pairSeq') || '').trim() || String(Date.now())
      this.remember({ count: matrix.count, bits: matrix.bits, text: payload, status, done })
      this.mirror('pairCount', matrix.count)
      this.mirror('pairBits', matrix.bits)
      this.mirror('pairText', payload)
      this.mirror('pairStatus', status)
      this.mirror('pairDone', done)
      this.log('配对二维码已生成：载荷 ' + payload.length + ' 字节 / ' + matrix.count + ' 模块' + (web ? '' : '（无网页入口）'))
    } catch (error) {
      try { this.mirror('pairStatus', '生成失败：' + String(error?.message ?? error)) } catch { /* 连写都失败就只剩日志 */ }
      this.log('配对二维码生成失败：' + String(error?.message ?? error))
    } finally {
      this.busy = false
      if (this.scheduled) {
        this.scheduled = false
        Promise.resolve().then(() => { try { this.refresh() } catch { /* 上面已记 */ } })
      }
    }
  }

  /** volatile-update 发生在 settings RPC 的事务里 ⇒ 挪到下一个宏任务再跑（同 PassProvisioner）。 */
  schedule() {
    if (this.scheduled) return
    this.scheduled = true
    setTimeout(() => {
      this.scheduled = false
      if (!fiberIsActive(this.ctx)) return
      this.refresh()
    }, 0)
  }

  start() {
    // v0.7.4（用户 m20942 报障的真因）：**这里绝不能拿 fiberIsActive 做守卫**。
    // `apply()` 执行期间 fiber 处于 LOADING，不是 ACTIVE(2) ⇒ fiberIsActive 恒为 false ⇒
    // 直接早退、监听器一个都没注册、后面的冷启动补算也一起没跑。表现就是「点生成二维码，
    // 按钮转 12 秒自己恢复，二维码与提示都不出现」。
    // PassProvisioner / RemoteAccessor 没这个问题，正因为它们的守卫只放在事后的 schedule() 里。
    PAIR_ACTIVE.set(this.storeKey(), this)
    this.applyStore()
    // v0.7.4：**冷启动补算**。浏览器写 pairSeq 会落到 cordis.patch.yml ⇒ 本插件 fiber 热重启。
    // 触发那次 refresh() 的老 fiber 在重启中被打掉，它 mirror 出去的点阵写进了即将丢弃的旧
    // config 对象；新 fiber 的 applyStore() 读到的 store 还是空的，而那条 volatile-update 早已
    // 派发完毕 ⇒ 页面永远等不到 pairCount/pairBits，按钮转完什么都没发生（用户 m20942 报障）。
    // 所以新 fiber 必须自己对一次账：持久化的 pairSeq 和 store 里的 done 不一致就补跑一次。
    // 补跑后 done === seq，再重启也不会形成循环。
    const pending = String(this.read('pairSeq') || '').trim()
    if (pending !== '' && PAIR_SEQ_RE.test(pending)) {
      const saved = pairStore()[this.storeKey()]
      const finished = saved ? String(saved.done || '') : ''
      if (pending !== finished) {
        this.lastSeq = pending
        this.schedule()
      }
    }
    this.ctx.on('loader/volatile-update', (paths) => {
      const touched = Array.isArray(paths) && paths.some((path) =>
        Array.isArray(path) && path[0] === 'pairSeq')
      if (!touched) return
      const seq = String(this.read('pairSeq') || '').trim()
      if (seq === this.lastSeq) return
      if (!PAIR_SEQ_RE.test(seq)) return
      this.lastSeq = seq
      this.schedule()
    })
  }

  stop() {
    if (PAIR_ACTIVE.get(this.storeKey()) === this) PAIR_ACTIVE.delete(this.storeKey())
  }
}

/** 远程访问镜像的进程级暂存（同 panelStore 的理由：volatile 写入会热重启 fiber）。 */
export const REMOTE_STORE_KEY = '__DSHPUSH_REMOTE__'

export function remoteStore() {
  const g = globalThis
  if (!g[REMOTE_STORE_KEY]) g[REMOTE_STORE_KEY] = {}
  return g[REMOTE_STORE_KEY]
}

/**
 * 每个 profile 只有一个「当前」远程访问实例（v0.7.12）。
 *
 * 为什么必须记：volatile 写入会热重启本插件 fiber，新实例不知道旧实例还在跑着自己的
 * http server 和 cloudflared 子进程。不接管就只能在端口列表里看到一片僵尸网关。
 */
const REMOTE_ACTIVE = new Map()

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
  // PairBox 在下面才创建，这里先用闭包占位：一键开通成功后要顺手把二维码也算出来，
  // 用户点一次「一键开通」就能直接扫，不必再点「生成二维码」。
  let pairBox = null
  new PassProvisioner(ctx, config, resolved, (message) => host.log(message), {
    credentialsPath: file.path,
    // 一键开通后让推送链路当场生效：rearm 重建 RelayClient 并补上开机的轮询定时器。
    onEnrolled: (patch) => {
      host.rearm(patch)
      // v0.7.3：这里**不能**直接 refresh()。onEnrolled 跑在 settings RPC 的事务里，而 refresh()
      // 会立刻写 volatile（pairCount/pairBits/...）⇒ 事务中改 volatile 会触发本插件 fiber 热重启，
      // 那几次镜像写入跟着丢，用户看到的就是「开通成功了，但二维码一直不出来」。
      // 一律走 schedule()（挪到下一个宏任务），与 PassProvisioner 内部同一套规避。
      if (pairBox) { try { pairBox.schedule() } catch { /* schedule 自己兜底 */ } }
    },
  }).start()
  // 远程访问（v0.4.0）：默认关。开着就走「内层改写网关 + cloudflared 快速隧道」，
  // 把公网域名换成 30 天口令链接；隧道换了域名会自动重推给手机。
  const accessor = new RemoteAccessor(ctx, config, resolved, host, (message) => host.log(message), {
    credentialsPath: file.path,
  })
  accessor.start()
  // 扫码配对（v0.6.0）：网页点「生成二维码」→ volatile pairSeq 变 → 这里算出
  // `dshpush://v1?base=&topic=&token=&web=&name=` 的载荷与点阵，镜像回 volatile 给设置行画。
  // 隧道模式下网页入口从 accessor 现取（要带 `?k=` 口令），tailnet 模式取 web.log 里的地址。
  pairBox = new PairBox(ctx, config, resolved, host, (message) => host.log(message), {
    credentialsPath: file.path,
    accessor,
  })
  pairBox.start()
}

export { PushHost, resolveConfig, CONFIG_KEYS }
