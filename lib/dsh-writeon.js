//#region src/host/http.ts
/** Trusted-request guard: the socket must be loopback and the Origin (when
* present) must match the request's own host — same policy other host plugins use. */
function trustedRequest(req) {
	const remote = req.socket.remoteAddress;
	if (!(remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1")) return false;
	const origin = req.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === (req.headers.host ?? "");
	} catch {
		return false;
	}
}
function json(res, status, body) {
	const data = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(data)
	});
	res.end(data);
}
function readJson(req, limit = 1 << 20) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (c) => {
			size += c.length;
			if (size > limit) {
				req.destroy();
				reject(/* @__PURE__ */ new Error("body too large"));
				return;
			}
			chunks.push(c);
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch (e) {
				reject(e instanceof Error ? e : /* @__PURE__ */ new Error("bad json"));
			}
		});
		req.on("error", reject);
	});
}
//#endregion
//#region src/dsh-writeon.ts
/**
* dsh-writeon — Write On host plugin.
* Registers two same-origin routes under the DSH web server:
*   GET  /api/writeon/models  → the deployment's live model catalog
*   POST /api/writeon/ai      → a one-shot llm.stream call (text in, text out)
* No session state is touched: every call is identity-free and the request
* body carries everything the model sees (contract: ../domain/contract.ts).
*/
const name = "dsh-writeon";
const inject = [
	"llm",
	"webServer",
	"sessionController"
];
function apply(ctx) {
	const llm = ctx.llm;
	const webServer = ctx.webServer;
	const sessionController = ctx.sessionController;
	const getModels = async (req, res) => {
		if (!trustedRequest(req)) return json(res, 403, {
			ok: false,
			reason: "untrusted"
		});
		try {
			const catalog = await sessionController.modelCatalog();
			json(res, 200, {
				groups: catalog.groups,
				default: catalog.default ?? null
			});
		} catch (e) {
			json(res, 500, {
				ok: false,
				reason: e instanceof Error ? e.message : "catalog failed"
			});
		}
	};
	const postAi = async (req, res) => {
		if (!trustedRequest(req)) return json(res, 403, {
			ok: false,
			reason: "untrusted"
		});
		let body;
		try {
			body = await readJson(req);
		} catch {
			return json(res, 400, {
				ok: false,
				reason: "bad-json"
			});
		}
		if (typeof body.requestId !== "string" || typeof body.provider !== "string" || typeof body.model !== "string" || typeof body.user !== "string") return json(res, 400, {
			ok: false,
			reason: "missing-fields"
		});
		const abort = new AbortController();
		res.on("close", () => abort.abort());
		try {
			let text = "";
			const blockTexts = /* @__PURE__ */ new Map();
			let finishKind = "unknown";
			let usage;
			for await (const chunk of llm.stream({
				provider: body.provider,
				model: body.model,
				messages: [{
					role: "user",
					content: [{
						type: "text",
						text: body.user
					}]
				}],
				system: body.system,
				temperature: body.temperature,
				maxTokens: body.maxTokens ?? 4096,
				signal: abort.signal
			})) if (chunk.type === "text-delta" && typeof chunk.index === "number" && typeof chunk.text === "string") text += chunk.text;
			else if (chunk.type === "block-end" && chunk.block !== void 0 && chunk.block.type === "text" && typeof chunk.block.text === "string") blockTexts.set(chunk.index ?? 0, chunk.block.text);
			else if (chunk.type === "usage" && chunk.usage !== void 0) usage = chunk.usage;
			else if (chunk.type === "finish" && chunk.reason !== void 0) finishKind = chunk.reason.kind;
			if (blockTexts.size > 0) text = [...blockTexts.keys()].sort((a, b) => a - b).map((i) => blockTexts.get(i)).join("");
			json(res, 200, {
				ok: finishKind === "stop" || finishKind === "end_turn" || finishKind === "length" || text.length > 0,
				requestId: body.requestId,
				text,
				reason: finishKind,
				usage
			});
		} catch (e) {
			if (abort.signal.aborted || res.destroyed) return;
			json(res, 200, {
				ok: false,
				requestId: body.requestId,
				reason: e instanceof Error ? e.message : "stream failed"
			});
		}
	};
	ctx.effect(() => webServer.register({
		kind: "exact",
		path: "/api/writeon/models",
		handler: getModels
	}));
	ctx.effect(() => webServer.register({
		kind: "exact",
		path: "/api/writeon/ai",
		handler: postAi
	}));
}
//#endregion
export { apply, inject, name };
