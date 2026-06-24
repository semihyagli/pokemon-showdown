# Pokémon Search UI — Design

Date: 2026-06-24
Status: Approved design, pending implementation plan

## Context

We want a small, local tool for finding Pokémon that match a combination of
criteria (ability, moves they can learn, typing, and a target Speed at level
50), scoped to a chosen generation and optionally a format. The original idea
sketch lives in `zzz_test.ts` at the repo root: it imports the simulator `Dex`,
builds reverse indexes (`ability → species`, `move → species`), and computes
level-50 stat ranges per species.

The tool's code should live in this repo, but the UI must be **launchable
separately and locally** — independent of the main Pokémon Showdown server.

## Goals

- A browser UI to search/select:
  - Generation, and optionally a Format, to scope the search.
  - An Ability.
  - Up to 4 moves the Pokémon must be able to learn.
  - A typing of 1 or 2 types.
  - A target Speed at level 50, checked against each Pokémon's possible range.
- Standalone: start it with one command; no dependency on the PS server.
- No new npm dependencies; reuse the repo's `Dex`.

## Non-goals (YAGNI)

- Full tournament legality (TeamValidator: ability+moves+type legal *together*
  for a set). Format support is a candidate-pool filter only.
- Persistence, accounts, deployment, styling polish beyond clean and usable.
- Editing data; this is read-only search.

## Architecture

A new self-contained directory `tools/pokemon-search/`, kept out of `sim/` and
`server/` so it is clearly a standalone dev tool.

```
tools/pokemon-search/
  run.js        # plain-CJS launcher: ensures dist is built, then starts server
  server.ts     # minimal Node built-in http server: serves page + JSON API
  engine.ts     # pure search logic over Dex (no HTTP) — unit tested
  index.html    # the form + results UI
  app.js        # frontend logic: fetch meta, run search, render results
  style.css     # minimal styling
```

Runtime / build model — important: Pokémon Showdown does **not** run its
TypeScript directly. Its source files use extensionless relative imports
(e.g. `./dex-data`), which Node's ESM loader rejects; the project compiles all
`.ts`/`.tsx` to `dist/` with `node build` (esbuild) and runs from there — the
`pokemon-showdown` launcher itself auto-runs `node build` when `dist/` is
absent. The tool follows the same model:

- `engine.ts` and `server.ts` are TypeScript and import `Dex` the way the rest
  of the repo does (`import { Dex } from '../../sim/dex'`). `node build`
  compiles them into `dist/tools/pokemon-search/`, where that relative import
  resolves to the compiled `dist/sim/dex.js`. (The build globs every `.ts`
  under the repo except `node_modules`/`logs`/`databases`, so `tools/` is
  included automatically — no build-config change needed.)
- `run.js` is plain CommonJS (needs no compilation). It mirrors the
  `pokemon-showdown` launcher: ensure `dist/` is built (run `node build` if
  needed), then `require('../../dist/tools/pokemon-search/server.js')` and start
  it. This is the command the user actually runs.
- The frontend assets (`index.html`, `app.js`, `style.css`) are served straight
  from the **source** `tools/pokemon-search/` directory (the server resolves
  that path relative to the repo root), so they are not compiled and editing the
  UI needs no rebuild — only `engine.ts`/`server.ts` changes do.
- HTTP: Node's built-in `http` module. No new dependencies. Frontend is vanilla
  HTML/CSS/JS — no framework.

Launch:

```
node tools/pokemon-search/run.js          # builds if needed, then serves http://localhost:8080
```

Port overridable via `PORT` env var or a `--port` arg.

## Components

### engine.ts (pure logic — this is `zzz_test.ts` refactored)

Responsibilities and approximate signatures:

- `calcLevel50Stat(base, { iv, ev, nature }): number`
  - HP:    `floor((2*base + iv + floor(ev/4)) * 0.5) + 60`
  - Other: `floor((floor((2*base + iv + floor(ev/4)) * 0.5) + 5) * nature)`
- `buildIndex(gen: number): GenIndex` — iterate `Dex.forGen(gen).species.all()`
  once and produce:
  - `abilityToSpecies: Map<string, Set<speciesId>>` (slots 0/1/Hidden)
  - `moveToSpecies: Map<string, Set<speciesId>>` — a move counts only if its
    learnset sources include the selected generation (same gen check as the
    sketch: a source string whose leading gen number equals `gen`).
  - `species: Map<speciesId, SpeciesInfo>` where `SpeciesInfo` =
    `{ name, types: string[], abilities: string[], baseSpe, speRange: { min0iv, min31iv, max } }`
  - Speed bounds: `max` = 252 EV / 31 IV / +nature (×1.1); `min0iv` = 0 EV /
    0 IV / −nature (×0.9); `min31iv` = 0 EV / 31 IV / −nature (×0.9). Both
    floors precomputed so the UI toggle is instant.
  - Cached per `gen`.
- `formatPool(gen, formatId): Set<speciesId>` — species permitted by the
  format. Reuse the format's RuleTable (`dex.formats.getRuleTable(format)`) to
  determine the allowed pool; finalize the exact check (banlist + tier) during
  implementation. Fallback if no clean API: filter by `species.tier`
  (`formats-data`) against the format's allowed tiers plus its explicit
  `banlist`. When a format is chosen, the generation is taken from the format's
  mod.
- `search(index, criteria): SpeciesInfo[]` — AND-filter (see semantics), sorted
  by base Speed descending.

### server.ts (thin HTTP layer)

- `GET /` and static assets → serve `index.html`, `app.js`, `style.css`.
- `GET /api/meta?gen=9[&format=ID]` → option lists for the dropdowns:
  `{ generations, formats, abilities, moves, types }` for the requested gen.
  `generations` is derived dynamically from `Dex.gen` (`1..current`) and
  `formats` from `Dex.formats.all()`, so a newly-added generation or format
  appears automatically with no code change (see "Staying current" below).
- `GET /api/search?gen=9&format=ID&ability=...&moves=a,b,c,d&types=Ground,Flying&speed=120&floor=0iv`
  → `{ count, results: SpeciesInfo[] }`.
- Lazy-builds and caches the per-gen index on first request for that gen.

### Frontend (index.html / app.js / style.css)

Layout (per approved mockup): Generation + Format selects; Ability select; four
move selects (2×2, each defaulting to "— any —"); Type 1 + Type 2 selects (Type
2 includes "— none —"); a Speed number field with a 0 IV / 31 IV radio toggle; a
Search button; a results table with columns Pokémon, Types, Base Spe, Spe range
@ L50, and a "fits target?" check. On load and whenever gen/format changes, fetch
`/api/meta` to repopulate selects; on Search, fetch `/api/search` and render.

## Search semantics

All filters are AND-ed; each is optional and applied only when set.

- Moves: the Pokémon must be able to learn **all** chosen moves (set
  intersection of `moveToSpecies`), restricted to the selected generation's
  learnset sources.
- Types: choose 1 or 2. The Pokémon must have **all** chosen types
  (order-independent). One type → mono or dual containing it; two types → has
  both.
- Ability: must have the ability in any slot (0/1/Hidden).
- Speed: the entered integer must satisfy `min <= speed <= max`, where `min` is
  `min0iv` or `min31iv` per the UI toggle and `max` is the 252/31/+nature value.
- Empty filter set returns the whole (gen or format) pool. Results sorted by base
  Speed descending.

## Error handling

- Unknown/invalid `gen` or `format` → HTTP 400 with a JSON `{ error }` message.
- Unparseable `speed`, or an unknown move/ability/type value → that single
  filter is ignored (not a hard error); the rest of the query still runs.
- No matches → 200 with `count: 0`; the UI shows an empty-state message.

## Testing

- Mocha tests in `test/tools/pokemon-search.js` (matches the repo's
  `test/tools/` convention), exercising `engine.ts` directly:
  - `calcLevel50Stat` against known values (e.g. a known base-speed Pokémon's
    max and min0iv/min31iv Speed at level 50).
  - Reverse-index correctness: a Pokémon with a known ability/move appears under
    it; one without does not.
  - AND-intersection across multiple criteria returns only species satisfying
    all of them.
  - Type matching: mono-type query vs dual-type query behave per semantics.
  - Speed-range membership at both floors (boundary values inclusive).
- A light smoke test of `search()` end-to-end via the engine (HTTP layer left to
  manual verification).
- Manual: `node tools/pokemon-search/run.js`, open the browser, run a query
  matching the mockup example and confirm results + the speed check.

## Staying current with upstream updates

The tool reads game data through the live `Dex`, not from a hand-maintained
copy. So upstream data changes flow in with almost no maintenance — with one
caveat about the build step:

- Routine data updates (new species, moves, abilities, items, learnset edits,
  and tier/banlist changes — the bulk of upstream commits) require **no code
  changes**. They are picked up automatically on the next launch.
- Caveat — a `git pull` alone is not enough; the simulator runs from compiled
  `dist/`, so the new data only takes effect after a rebuild (`node build`,
  which is incremental and fast). `run.js` runs the build for you, so the
  practical workflow stays: `git pull` → `node tools/pokemon-search/run.js`.
- New generations and new formats also need no code change, because the gen list
  comes from `Dex.gen` and formats from `Dex.formats.all()` (see `/api/meta`).
- What a pull would *not* fix automatically (rare, needs a small `engine.ts`
  edit): a breaking change to the Dex API surface the tool depends on — e.g.
  renaming `Dex.forGen`, changing the shape of `getLearnsetData`, or changing
  the learnset source-string format (e.g. `"9L1"`). These are uncommon but
  possible across major refactors.

In short: routine content/tier updates → pull + rebuild (handled by `run.js`) is
enough; structural Dex API changes → occasional small fixes.

## Launch / usage summary

```
node tools/pokemon-search/run.js           # builds if needed, then serves http://localhost:8080
PORT=9000 node tools/pokemon-search/run.js
```
