# dsh-writeon

**Write On** — an in-place writing-workshop plugin for DeepSeek Harness (DSH).
A single-author workbench for iterating over short posts, long threads, and articles:
keep alternative candidates, read them in place, dim uncertain fragments, park spare
material beside the page, then let the author decide the final cut. AI is an optional
suggestion layer — never an auto-rewriter.

Built as a real, installable DSH plugin: it registers a **写作 / Write On** entry in the
host sidebar, mounts its own panel inside the DSH workspace, calls the host's configured
model providers through `ctx.llm.stream`, and persists projects locally in IndexedDB.

---

## Install & run (real host)

```sh
# 1. a DSH host app, pinned to an rc build the plugin supports
mkdir dsh-host && cd dsh-host
npm i @deepseek-ai/dsh@0.2.0-rc.2

# 2. link this plugin repo into the host profile
npx dsh plugin --profile web add link:/path/to/dsh-writeon

# 3. launch the web host
npx dsh web
```

Open the printed token URL, click **Write On** in the left sidebar.

Model calls reuse the host's configured providers (e.g. `zai-coding-cn` via
`ZHIPU_API_KEY` in `cordis.patch.yml`). With no provider configured, manual writing,
variants, Ghost, Overflow, persistence and export keep working — AI entries report
"no model configured" instead of failing silently.

Peer range: `@deepseek-ai/dsh-* >=0.2.0-rc.1 <0.2.1` (rc releases only).

## What it does

| Surface | Behavior |
| --- | --- |
| Editor | ProseMirror document, CJK/IME-safe input, autosave, grouped undo |
| Candidates | Word / sentence / paragraph alternatives that rotate **in place**; the original is immutable and always restorable; options carry stable IDs; editing an option forks it |
| Nesting | Variants may fully contain other variants; a partially-crossing selection asks to expand or cancel |
| a / an | Replacing a candidate re-links the English article in the same transaction, so one undo restores both |
| Three dim models | Manual Ghost (0.12), trim-review candidates (0.18), focus-context dimming (0.40) — independent, never confused |
| Overflow | Stash cuts a fragment atomically into a side shelf; insert copies it back with fresh IDs; drag-in supported |
| Lab | Six diagnostic goals — five mark-only, `fix-punctuation` applies accepted fixes |
| Trim | Original + 10/20/30/50 % on one baseline; delete-only proposals with full anchor validation |
| Review | Keep / Walk through / Make the cuts (atomic) / Done / Original restore; stale-on-edit; late and duplicate responses are safe |
| Persistence | IndexedDB projects, autosave with Saved badge, JSON export/import, multi-window conflict notice, versioned migration |
| Tools | Word stats, hide-controls, Save/Open, guarded X handoff, LinkedIn easter egg |
| Shortcuts | Ctrl+Shift+A manual alt · Ctrl+Shift+G AI alt · Ctrl+/ ghost · Ctrl+Shift+X stash — all scoped to writing focus |

## AI contract

Every model response is validated before it can touch the document:

- leaf-scoped spans only (UTF-16 offsets + exact quote verification);
- cross-leaf suggestions arrive as multiple ordered spans bound to one proposal;
- anchors that drift are repaired only when the quote is unique; ambiguous or
  mismatched quotes are rejected — the original text is never at risk;
- late, stale, duplicate or out-of-range responses never delete or mutate text.

Deterministic tests use the clearly-labelled `writeon-test` provider
(`?woprovider=test`) — a separate layer from the real-provider tests that call
GLM through the host's `/api/writeon/ai` route.

## Develop

```sh
npm i
npm run build         # tsc + tsdown → lib/ (committed)
npm run typecheck
npm test              # 67 unit tests (vitest)
node scripts/run-e2e.mjs            # full Playwright suite vs a real `dsh web` host
node scripts/run-e2e.mjs --grep "real model"   # real GLM calls only
```

Each E2E run writes `verification/<run-id>/` — `manifest.json`, host URL,
Playwright logs, and screenshots.

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — module layout, DSH integration points, data model
- [`docs/REQUIREMENTS_MATRIX.md`](docs/REQUIREMENTS_MATRIX.md) — every P0/P1 spec requirement and E01–E30 acceptance case mapped to implementation, test and evidence
- [`verification/`](verification/) — recorded host runs (manifests, logs, screenshots)
