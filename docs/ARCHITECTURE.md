# Architecture

dsh-writeon is a normal DSH plugin: an ESM host entry that registers effects on the
plugin context, plus a CJS browser bundle (`./client`) that the host injects into the
web page. It never patches DSH core and never ships its own host shell.

```
DSH host (web profile)
├─ navigation / workspace / lifecycle          ← slots.inject, ctx.layout, ctx.locale
├─ model providers (llm.stream, modelCatalog)  ← host-side cordis services
├─ HTTP routes                                 ← ctx.http on the webserver plugin
└─ dsh-writeon
   ├─ src/dsh-writeon.ts      host entry: effects, panel injection, /api/writeon/ai route
   ├─ src/host/http.ts        AI proxy: stream GenerateOptions → SSE chunks
   ├─ src/client/             React page + controller + storage (browser bundle)
   ├─ src/editor/             ProseMirror schema, model, commands, undo plugin
   └─ src/domain/             pure document/contract layer — no DOM, no cordis
```

## Layer boundaries

- **`src/domain/`** — pure TypeScript. Segmentation into leaves/spans, entities
  (documents, variant groups, options, ghosts, overflow items, runs, proposals),
  anchor maths (UTF-16 offsets + quote), AI contract validation, serialization,
  stats. Everything here is unit-testable without a browser or a host.
- **`src/editor/`** — ProseMirror adapter. `schema.ts` defines variant start/end
  marker atoms (rendered as ZWSP placeholders so candidate rotations are single
  transactions); `model.ts` maps domain entities ↔ PM marks/nodes; `plugin.ts`
  groups typing into undoable steps (700 ms window); `commands.ts` is the only
  writer of the document.
- **`src/client/`** — `index.tsx` mounts the React page into the injected slot;
  `controller.ts` holds all state (documents, groups, ghosts, overflow, runs,
  aiBusy) and calls the editor adapter + `/api/writeon/ai`; `storage.ts` is the
  IndexedDB layer (versioned schema, migration, conflict detection, export/import);
  `ai-provider.ts` talks SSE to the host route; `i18n.ts` registers the plugin's
  locale namespace (zh/en) inside `ctx.effect`.
- **`src/dsh-writeon.ts` + `src/host/http.ts`** — the only host-touching code.
  Effects: `slots.inject('sidebar.panellist', …)` for the Write On entry,
  `slots.inject('main', …)` for the page, `ctx.locale.register`, and an HTTP
  route that forwards validated GenerateOptions to `ctx.llm.stream` and streams
  chunks back as SSE. On disable, every disposer runs — no listeners leak.

## Data model (IndexedDB `writeon` store)

- **documents** — ordered leaves (paragraph blocks), title, cursor, timestamps.
- **groups** — variant groups: `{ leafId, range{from,to}, optionIds[], activeId }`.
  Options are referenced by stable `optionId`, never by index, so rotation and
  dedup can't re-point the active choice.
- **ghosts** — manual dim marks `{ leafId, range }` rendered at opacity 0.12.
- **overflow** — stashed fragments `{ text, entitiesSnapshot }`; insert copies
  with fresh IDs so two copies never alias.
- **runs** — Lab/trim sessions `{ mode, goal|level, baseline, proposals[] }`;
  proposals carry leaf-scoped anchors; a run is `active` only for its mode.
- **meta** — schema version; `migrations[]` apply on open.

Autosave debounces into IndexedDB and only flips the Saved badge after the write
commits. Export serializes the whole project JSON; import validates version and
rebuilds every entity. A second window on the same store gets a conflict notice
instead of silently overwriting.

## AI path

```
WriteOnPage → controller.callModel(mode, goal|level)
  → ai-provider.ts  POST /api/writeon/ai  { prompt, options }
  → host/http.ts    validate + llm.stream(GenerateOptions)
  → SSE chunks      text-delta → assembled JSON
  → contract-validate.ts  (anchors resolved; unique-quote repair; strict reject)
  → proposals on the run → review UI
```

Request IDs mark in-flight calls; an edit to the affected leaf marks the run
stale, and late/duplicate responses resolve to no-ops. Validation rejects:
unknown leaf IDs, out-of-range offsets, quote mismatches that can't be uniquely
relocated, split surrogate pairs/graphemes, and any non-delete proposal outside
`fix-punctuation`.

## Three dimming models

| Model | Opacity | Owner |
| --- | --- | --- |
| Manual Ghost | 0.12 | `ghosts` store, Revive restores |
| Trim-review cut candidate | 0.18 | active `trim` run proposals |
| Focus/context dim | 0.40 | reading-context chrome |

They share no state; deleting one can never clear another.

## Testing layers

- `tests/unit/` — domain + editor logic (67 vitest cases).
- `tests/e2e/deterministic.spec.ts` — 19 Playwright journeys inside the real
  `dsh web` page with the labelled `writeon-test` provider (`?woprovider=test`).
- `tests/e2e/real-model.spec.ts` — 4 journeys that exercise the real GLM
  provider through the same UI (catalog → alternatives → lab → trim).
- `scripts/run-e2e.mjs` — boots a fresh `dsh web` host (fresh one-time token),
  runs the suite, writes `verification/<run-id>/`.
