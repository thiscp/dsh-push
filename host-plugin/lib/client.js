// dsh-push-host 的浏览器半（v0.2.2）：设置页「手机作答模式」开关 + 按推送链接的 hash 切到来源会话。
// 手写模块，格式照抄现成编译产物（window.__ModuleLoader__.load，见
// dsh-client-ui-settings-subagent/lib/client.js）；宿主 client-modules 经
// package.json 的 dsh.client{platform:"web"} + exports "./client" 挂载它。
// 写入通道：settings RPC 只能写 volatile 字段，所以这里只写 push-host 自己的
// askUserMode；宿主延后到 HMR 事务外备份并 configEditor.edit 改 tool-ask-user 的
// mode/timeout（那两个字段不是 volatile，客户端写不了）。
// v0.2.1：展示读宿主的实际态镜像 askUserActual（不拿期望态当展示值）；开关只升不降
// （0.2.0 的 P0 把生产 timed 反向降级成 legacy），已是 timed 时按钮禁用。
window.__ModuleLoader__.load({
	id: "dsh-push-host",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		// 诊断（v0.2.2）：开机瞬间 URL 里到底有没有 hash、切会话走到哪一步，一页之内就能看出来，
		// 不用去猜「是没跑还是没点到」。控制台里读 window.__DSHPUSH_CLIENT__ 即可。
		const DIAG = { v: "0.2.2", hash: "", tries: 0, opened: false, rowSeen: false, clicks: 0, done: false };
		try {
			DIAG.hash = String(location.hash || "");
		} catch {
			// 读不到就当没有：诊断本身绝不能把插件搞崩。
		}
		try {
			window.__DSHPUSH_CLIENT__ = DIAG;
		} catch {
			// window 不可写时丢掉诊断即可。
		}

		/** 本行读写的 settings 命名空间 = push-host 的 profile entry id。 */
		const NS = "push-host";

		/** 浏览器侧所需服务（client fiber inject）。 */
		const inject = ["slots", "configForms"];

		/**
		* 挂载设置行：宿主在提供 `push-host` 命名空间（= 插件已装载）时才出现。
		* @param ctx - 浏览器插件上下文。
		*/
		function apply(ctx) {
			const scope = ctx.configForms.get(NS);
			let disposed = false;
			const listeners = new Set();
			const notify = () => {
				for (const listener of listeners) listener();
			};
			const unsubscribe = scope.subscribe(() => {
				if (!disposed) notify();
			});
			ctx.effect(() => () => {
				disposed = true;
				unsubscribe();
			}, "dsh-push-host: ask-user form subscription");
			ctx.effect(() => ctx.configForms.whileServed([NS], () => ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "push-host-ask-user-mode",
				order: 120,
				label: "手机作答模式",
			}, () => AskUserModeRow(scope, listeners, notify)))), "dsh-push-host: ask-user mode row");
			// v0.2.2：把推送链接 hash 里的来源会话切到主视图（与设置行互不相干，各自独立生效）。
			revealFromHash(ctx);
		}

		/**
		* 设置行本体：settings.general.item 的列只叠行，标签、状态、写入全是行自己的。
		* @param scope - 绑定了 `push-host` 的配置表单。
		* @param listeners - 订阅回调集合（宿主配置文档变化时唤醒）。
		* @param notify - 唤醒全部订阅者。
		*/
		function AskUserModeRow(scope, listeners, notify) {
			const [snapshot, setSnapshot] = react.useState(() => scope.getSnapshot());
			const [busy, setBusy] = react.useState(false);
			react.useEffect(() => {
				const update = () => setSnapshot(scope.getSnapshot());
				listeners.add(update);
				update();
				return () => {
					listeners.delete(update);
				};
			}, []);
			const ready = snapshot.status === "ready";
			const value = snapshot.value ?? {};
			// 展示读宿主的实际态镜像；镜像还没回写（''）时暂按期望态兜底。
			const timed = value.askUserActual === "timed" || (value.askUserActual !== "legacy" && value.askUserMode === "timed");
			const status = typeof value.askUserStatus === "string" ? value.askUserStatus : "";
			const writable = ready && snapshot.writable === true && !busy && !timed;
			const setMode = (next) => {
				if (!writable) return;
				setBusy(true);
				Promise.resolve()
					.then(() => scope.mutate([{
						op: "set",
						path: ["askUserMode"],
						value: next
					}], snapshot.revision))
					.catch(() => {})
					.then(() => {
						setBusy(false);
						notify();
					});
			};
			return react.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6, padding: "8px 0" } },
				react.createElement("div", { style: { fontWeight: 600 } }, "手机作答模式"),
				react.createElement("div", { style: { fontSize: 13, opacity: 0.75 } }, timed
					? "已开启：ask_user_question 走 timed——提问会推送到手机，超时后手机答案仍可续答。"
					: "未开启：ask_user_question 走 legacy——只有 DSH 网页能作答。"),
				react.createElement("div", { style: { fontSize: 12, opacity: 0.55 } },
					"启用即时热生效、无需重启宿主；新会话立即生效，已开老会话保持旧行为（工具变体钉在会话创建时）。启用前自动备份 cordis.patch.yml。本开关只升不降：要回到 legacy 请手动改 profile 的 cordis.patch.yml。"),
				status !== ""
					? react.createElement("div", { style: { fontSize: 12, color: "#c0392b" } },
						"上次切换失败：" + status + "（若提示 overridden by a home patch，请先移除 home 层或命令行对 tool-ask-user 的同 id 覆盖）")
					: null,
				react.createElement("div", {}, react.createElement("button", {
					type: "button",
					disabled: !writable,
					onClick: () => setMode("timed"),
					style: { padding: "6px 14px", borderRadius: 8, border: "1px solid currentColor", opacity: writable ? 1 : 0.5 },
				}, busy ? "启用中…" : timed ? "已开启（本开关不降级）" : "启用（切到 timed）")));
		}

		/**
		 * v0.2.2：推送里的 `#web` 链接把来源会话放在 **URL hash 片段**（`…#session-<uuid>`，服务端
		 * `lib/index.js:webUrl()` 拼），这里把它兑现成「主视图切到那个会话」——用户「进入网页后能直接
		 * 进入推送通知的那个对话吗」。用片段而不是查询参数是实测决定的：`?token=` 入口会 `303 →
		 * Location: ./` 把查询串丢掉，而浏览器跳转会保留 fragment；网页端也没有路由，别处不读 URL。
		 *
		 * 选择器全部语义化，不依赖哈希类名：当前会话 `[data-conversation-session="<id>"]`、侧栏行
		 * `[data-row-key="session:<id>"]`、展开侧栏 `button[aria-label="Open sidebar"]`。目标不在列表
		 * 里（会话未加载/分组收起）就静默放弃，等于本功能之前的行为，MUST NOT 影响页面其它部分。
		 * @param ctx - 浏览器插件上下文（用它的 effect 挂清理，HMR 不留定时器）。
		 */
		/**
		 * v0.2.2：推送里的 `#web` 链接把来源会话放在 **URL hash 片段**（`…#session-<uuid>`，服务端
		 * `lib/index.js:webUrl()` 拼），这里把它兑现成「主视图切到那个会话」。
		 *
		 * 用片段而不是查询参数，两条实测理由（VM1 的 DSH Web，2026-10-17）：`?token=` 入口回的是
		 * `303 → Location: ./`，查询串在这一步被丢掉，而 fragment 跨跳转保留（实测早期 location.hash 仍在）；
		 * 网页客户端没有路由，路径与查询串都没人读。
		 *
		 * 抓手全是语义化选择器（不依赖哈希类名）：当前会话 `[data-conversation-session=…]`、
		 * 侧栏行 `[data-row-key=session:<id>]`（实测点它就能切主视图）、侧栏容器 `[data-slot=sidebar]`。
		 *
		 * 侧栏指纹（实测）：收起时 0 个会话行、按钮标签是 Open sidebar；展开时按钮变 Collapse sidebar，
		 * 且列表**截断**（还有 Show N more sessions 按钮、工作区分组可能 aria-expanded=false）。
		 * 所以每一拍按当前状态决定动作，而不是只点一次就完事：插件 apply 跑得很早，那一下点击可能被
		 * 尚未挂好 handler 的界面吞掉（实测踩过：只点一次 ⇒ rowSeen 始终 false）。按标签判断方向也保证
		 * 重复点击安全——侧栏已开时 Open sidebar 这个按钮就不存在了，不会反过来把它关掉。
		 *
		 * 目标找不到（会话未加载、分组没展开）就静默放弃，最多 20s，等于本功能之前的行为。
		 * @param ctx - 浏览器插件上下文（用它的 effect 挂清理，HMR 不留定时器）。
		 */
		function revealFromHash(ctx) {
			const target = String(location.hash || "").replace(/^#/, "").trim();
			if (!/^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target)) return;
			DIAG.hash = String(location.hash || "");
			let timer = 0;
			let tries = 0;
			let done = false;
			let moreClicked = false;
			const groupsTried = new Set();
			const stop = () => {
				if (timer !== 0) {
					clearInterval(timer);
					timer = 0;
				}
			};
			// 到位后把 hash 抹掉：否则用户之后手动切走、刷新又被拽回来。
			const clearHash = () => {
				try {
					history.replaceState(null, "", location.pathname + location.search);
				} catch {
					// 某些 webview 限制 replaceState：抹不掉只是刷新会再切一次，不影响本次跳转。
				}
			};
			const step = () => {
				if (done) {
					stop();
					return;
				}
				tries += 1;
				DIAG.tries = tries;
				try {
					if (document.querySelector('[data-conversation-session="' + target + '"]')) {
						done = true;
						DIAG.done = true;
						stop();
						clearHash();
						return;
					}
					if (tries > 40) {
						stop();
						return;
					}
					const row = document.querySelector('[data-row-key="session:' + target + '"]');
					if (row !== null) {
						DIAG.rowSeen = true;
						DIAG.clicks += 1;
						row.click();
						return;
					}
					// 行还没出现：先把侧栏展开。按标签选按钮 ⇒ 已展开时这个按钮不存在，重复点也安全。
					const toggle = document.querySelector('button[aria-label="Open sidebar"]');
					if (toggle !== null) {
						DIAG.opened = true;
						toggle.click();
						return;
					}
					// 侧栏已开但列表截断：把被折叠的会话放出来（只点一次，避免来回折叠）。
					if (!moreClicked) {
						const more = [].slice.call(document.querySelectorAll('button,[role="button"]')).filter((b) => /show\s*\d+\s*more|更多/i.test(String(b.textContent)))[0];
						if (more !== undefined) {
							moreClicked = true;
							more.click();
							return;
						}
					}
					// 还可能是工作区分组收着：逐个展开（每个只试一次）。
					const collapsed = [].slice.call(document.querySelectorAll('[data-row-key^="workspace:"]'))
						.filter((g) => g.getAttribute("aria-expanded") === "false");
					for (const group of collapsed) {
						const key = group.getAttribute("data-row-key") || "";
						if (groupsTried.has(key)) continue;
						groupsTried.add(key);
						group.click();
						return;
					}
				} catch {
					// 任何一次尝试出错都不算失败：继续下一拍，超时自然停。
				}
			};
			timer = setInterval(step, 500);
			step();
			ctx.effect(() => stop, "dsh-push-host: reveal session from hash");
		}

		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
