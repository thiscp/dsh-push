// dsh-push-host 的浏览器半（v0.2.1）：设置页「手机作答模式」开关。
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

		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
