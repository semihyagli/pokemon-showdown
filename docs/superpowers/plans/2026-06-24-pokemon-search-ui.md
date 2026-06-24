# Pokémon Search UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone, locally-launched browser tool to search Pokémon by generation/format, ability, learnable moves, typing, and a level-50 speed range.

**Architecture:** A self-contained `tools/pokemon-search/` directory. A pure TypeScript engine (`engine.ts`) reads the simulator `Dex` and answers queries; a thin Node built-in-`http` server (`server.ts`) exposes a JSON API and serves a static vanilla-JS frontend. Both `.ts` files compile into `dist/` via `node build` (the repo runs from `dist/`, not raw source); a plain-CommonJS `run.js` launcher rebuilds then boots the server.

**Tech Stack:** TypeScript (compiled by the existing esbuild `node build`), Node built-in `http`, vanilla HTML/CSS/JS, Mocha for tests. No new dependencies.

**Reference spec:** `docs/superpowers/specs/2026-06-24-pokemon-search-ui-design.md`

**Key facts established during research (do not re-derive):**
- The repo cannot run raw `.ts` (extensionless imports break Node's ESM loader). Everything compiles to `dist/`. `node build` is incremental. `test/main.js` runs `node build` before the suite.
- `Dex.forGen(gen)` gives gen-correct stats/types/abilities but `species.all()` returns ALL species regardless of gen — filter `species.gen <= gen` yourself.
- Species pool predicate used throughout: `sp.exists && sp.num > 0 && sp.gen <= gen && (sp.isNonstandard === null || sp.isNonstandard === 'Past')`.
- `dex.species.getFullLearnset(id)` returns an **array** of `{ learnset?: {moveId: string[]} }` objects (species + prevos) — merge their `.learnset` maps. A move is learnable in gen `g` if any source string satisfies `parseInt(src, 10) === g` (e.g. `'9M'`, `'9L65'`).
- Format gen = `Dex.forFormat(format).gen` (the format object's own `.gen` is `0`). Pool = species where `!Dex.formats.getRuleTable(format).isBannedSpecies(sp)` (handles tier-tag bans like `Uber`).
- Level-50 stat formula (from `zzz_test.ts`): HP = `floor((2*base+iv+floor(ev/4))*0.5)+60`; other = `floor((floor((2*base+iv+floor(ev/4))*0.5)+5)*nature)`. Sanity values for base 100 at L50: neutral 31IV/0EV spe = `120`, max 252EV/31IV/+ = `167`, min 0EV/0IV/− = `94`, min 0EV/31IV/− = `108`, HP 31IV/0EV = `175`.
- `Dex` and `toID` are exported from `sim/dex` (and `sim/index`). Tests `require` compiled output from `dist/` (convention: `test/tools/modlog/converter.js` does `require('../../../dist/tools/modlog/converter')`).

---

## File structure

| File | Responsibility |
|------|----------------|
| `tools/pokemon-search/engine.ts` | Pure search logic over `Dex`: stat math, per-gen index, search, format pool, meta. No HTTP. |
| `tools/pokemon-search/server.ts` | Thin `http` server: `/api/meta`, `/api/search`, static files. Exports `startServer(port?)`. |
| `tools/pokemon-search/run.js` | Plain-CJS launcher: `node build`, then `startServer()`. The command the user runs. |
| `tools/pokemon-search/index.html` | The form + results page. |
| `tools/pokemon-search/app.js` | Frontend logic: fetch meta, run search, render. |
| `tools/pokemon-search/style.css` | Minimal styling. |
| `test/tools/pokemon-search.js` | Mocha tests for `engine.ts` (+ one server smoke test). |

Build a fresh `dist/` whenever `.ts` changes: `npm run build`. Run the engine tests with `npm run build && npx mocha test/tools/pokemon-search.js`.

---

## Task 1: Engine scaffold + level-50 stat helpers

**Files:**
- Create: `tools/pokemon-search/engine.ts`
- Test: `test/tools/pokemon-search.js`

- [ ] **Step 1: Write the failing test**

Create `test/tools/pokemon-search.js`:

```js
'use strict';
const assert = require('assert').strict;
const engine = require('../../dist/tools/pokemon-search/engine');

describe('pokemon-search engine', () => {
	describe('calcLevel50Stat', () => {
		it('computes a neutral 31IV/0EV speed (base 100 -> 120)', () => {
			assert.equal(engine.calcLevel50Stat(100, 'spe', { iv: 31, ev: 0, nature: 1.0 }), 120);
		});
		it('computes HP (base 100, 31IV/0EV -> 175)', () => {
			assert.equal(engine.calcLevel50Stat(100, 'hp', { iv: 31, ev: 0 }), 175);
		});
	});

	describe('speedRange', () => {
		it('returns max/min0iv/min31iv for base 100', () => {
			assert.deepEqual(engine.speedRange(100), { min0iv: 94, min31iv: 108, max: 167 });
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx mocha test/tools/pokemon-search.js`
Expected: FAIL — `Cannot find module '../../dist/tools/pokemon-search/engine'` (file not created yet).

- [ ] **Step 3: Write minimal implementation**

Create `tools/pokemon-search/engine.ts`:

```ts
import { Dex, toID } from '../../sim/dex';

export type StatKey = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';

export interface SpeRange {
	min0iv: number;
	min31iv: number;
	max: number;
}

export function calcLevel50Stat(
	base: number, stat: StatKey, opts: { iv?: number, ev?: number, nature?: number } = {}
): number {
	const iv = opts.iv ?? 31;
	const ev = opts.ev ?? 0;
	const nature = opts.nature ?? 1.0;
	const halved = Math.floor((2 * base + iv + Math.floor(ev / 4)) * 0.5);
	if (stat === 'hp') return halved + 60;
	return Math.floor((halved + 5) * nature);
}

export function speedRange(baseSpe: number): SpeRange {
	return {
		max: calcLevel50Stat(baseSpe, 'spe', { iv: 31, ev: 252, nature: 1.1 }),
		min0iv: calcLevel50Stat(baseSpe, 'spe', { iv: 0, ev: 0, nature: 0.9 }),
		min31iv: calcLevel50Stat(baseSpe, 'spe', { iv: 31, ev: 0, nature: 0.9 }),
	};
}
```

(`Dex`/`toID` are imported now because Tasks 2–4 use them; that is intentional, not dead code.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && npx mocha test/tools/pokemon-search.js`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add tools/pokemon-search/engine.ts test/tools/pokemon-search.js
git commit -m "Pokemon Search UI: Add engine stat helpers"
```

---

## Task 2: Per-generation index (reverse maps + species info)

**Files:**
- Modify: `tools/pokemon-search/engine.ts`
- Test: `test/tools/pokemon-search.js`

- [ ] **Step 1: Write the failing test**

Append inside the top-level `describe('pokemon-search engine', ...)` in `test/tools/pokemon-search.js`:

```js
	describe('buildIndex(9)', () => {
		const index = engine.buildIndex(9);

		it('indexes a stable species with correct info', () => {
			const lando = index.species.get('landorustherian');
			assert.ok(lando, 'Landorus-Therian should be present');
			assert.equal(lando.name, 'Landorus-Therian');
			assert.deepEqual(lando.types, ['Ground', 'Flying']);
			assert.ok(lando.abilities.includes('Intimidate'));
			assert.equal(lando.baseSpe, 91);
			assert.deepEqual(lando.speRange, engine.speedRange(91));
		});

		it('maps abilities to species (reverse index)', () => {
			assert.ok(index.abilityToSpecies.get('intimidate').has('landorustherian'));
		});

		it('maps gen-9-learnable moves to species', () => {
			assert.ok(index.moveToSpecies.get('thunderbolt').has('pikachu'));
			assert.ok(index.moveToSpecies.get('earthquake').has('landorustherian'));
		});

		it('excludes non-standard fakemon (CAP) from the pool', () => {
			for (const info of index.species.values()) {
				assert.notEqual(info.name, 'Syclant'); // a CAP species
			}
		});
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx mocha test/tools/pokemon-search.js`
Expected: FAIL — `engine.buildIndex is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `tools/pokemon-search/engine.ts`:

```ts
export interface SpeciesInfo {
	id: string;
	name: string;
	num: number;
	types: string[];
	abilities: string[];
	baseSpe: number;
	speRange: SpeRange;
}

export interface GenIndex {
	gen: number;
	abilityToSpecies: Map<string, Set<string>>;
	moveToSpecies: Map<string, Set<string>>;
	species: Map<string, SpeciesInfo>;
}

const indexCache = new Map<number, GenIndex>();

function inGenPool(sp: { exists: boolean, num: number, gen: number, isNonstandard: string | null }, gen: number): boolean {
	return sp.exists && sp.num > 0 && sp.gen <= gen &&
		(sp.isNonstandard === null || sp.isNonstandard === 'Past');
}

export function buildIndex(gen: number): GenIndex {
	const cached = indexCache.get(gen);
	if (cached) return cached;

	const dex = Dex.forGen(gen);
	const abilityToSpecies = new Map<string, Set<string>>();
	const moveToSpecies = new Map<string, Set<string>>();
	const species = new Map<string, SpeciesInfo>();

	for (const sp of dex.species.all()) {
		if (!inGenPool(sp, gen)) continue;

		const abilityNames: string[] = [];
		for (const abilityName of Object.values(sp.abilities)) {
			if (!abilityName) continue;
			abilityNames.push(abilityName);
			const aid = toID(abilityName);
			let set = abilityToSpecies.get(aid);
			if (!set) abilityToSpecies.set(aid, (set = new Set()));
			set.add(sp.id);
		}

		species.set(sp.id, {
			id: sp.id,
			name: sp.name,
			num: sp.num,
			types: sp.types.slice(),
			abilities: abilityNames,
			baseSpe: sp.baseStats.spe,
			speRange: speedRange(sp.baseStats.spe),
		});

		let learnsets;
		try {
			learnsets = dex.species.getFullLearnset(sp.id);
		} catch {
			learnsets = [];
		}
		const seen = new Set<string>();
		for (const entry of learnsets) {
			const lset = entry.learnset;
			if (!lset) continue;
			for (const moveId of Object.keys(lset)) {
				if (seen.has(moveId)) continue;
				const learnable = lset[moveId].some(src => parseInt(src, 10) === gen);
				if (!learnable) continue;
				seen.add(moveId);
				let set = moveToSpecies.get(moveId);
				if (!set) moveToSpecies.set(moveId, (set = new Set()));
				set.add(sp.id);
			}
		}
	}

	const index: GenIndex = { gen, abilityToSpecies, moveToSpecies, species };
	indexCache.set(gen, index);
	return index;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && npx mocha test/tools/pokemon-search.js`
Expected: PASS (all `buildIndex(9)` tests green). Note: building the gen-9 index iterates ~1300 species and may take 1–3 seconds.

- [ ] **Step 5: Commit**

```bash
git add tools/pokemon-search/engine.ts test/tools/pokemon-search.js
git commit -m "Pokemon Search UI: Build per-generation search index"
```

---

## Task 3: Search (AND filters) + format pool

**Files:**
- Modify: `tools/pokemon-search/engine.ts`
- Test: `test/tools/pokemon-search.js`

- [ ] **Step 1: Write the failing test**

Append inside the top-level describe in `test/tools/pokemon-search.js`:

```js
	describe('search', () => {
		it('ANDs ability + dual typing', () => {
			const results = engine.search({ gen: 9, ability: 'Intimidate', types: ['Ground', 'Flying'] });
			const ids = results.map(r => r.id);
			assert.ok(ids.includes('landorustherian'));
		});

		it('requires ALL listed moves (intersection)', () => {
			const results = engine.search({ gen: 9, moves: ['earthquake', 'uturn'], types: ['Ground', 'Flying'] });
			assert.ok(results.some(r => r.id === 'landorustherian'));
		});

		it('treats one type as "has that type" (mono or dual)', () => {
			const results = engine.search({ gen: 9, types: ['Flying'] });
			assert.ok(results.some(r => r.id === 'landorustherian'));
		});

		it('filters by level-50 speed range inclusive of bounds', () => {
			const lando = engine.buildIndex(9).species.get('landorustherian');
			const atMax = engine.search({ gen: 9, ability: 'Intimidate', speed: lando.speRange.max, floor: '0iv' });
			assert.ok(atMax.some(r => r.id === 'landorustherian'));
			const tooFast = engine.search({ gen: 9, ability: 'Intimidate', speed: lando.speRange.max + 1, floor: '0iv' });
			assert.ok(!tooFast.some(r => r.id === 'landorustherian'));
		});

		it('sorts results by base speed descending', () => {
			const results = engine.search({ gen: 9, types: ['Dragon'] });
			for (let i = 1; i < results.length; i++) {
				assert.ok(results[i - 1].baseSpe >= results[i].baseSpe);
			}
		});

		it('applies a format pool (Ubers banned from OU)', () => {
			const ou = engine.search({ gen: 9, formatId: 'gen9ou', types: ['Psychic'] });
			assert.ok(!ou.some(r => r.id === 'mewtwo'), 'Mewtwo (Uber) must be excluded from OU');
		});
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx mocha test/tools/pokemon-search.js`
Expected: FAIL — `engine.search is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `tools/pokemon-search/engine.ts`:

```ts
export interface SearchCriteria {
	gen: number;
	formatId?: string;
	ability?: string;
	moves?: string[];
	types?: string[];
	speed?: number;
	floor?: '0iv' | '31iv';
}

export function formatPool(formatId: string): { gen: number, allowed: Set<string> } | null {
	const format = Dex.formats.get(formatId);
	if (!format.exists) return null;
	const fdex = Dex.forFormat(format);
	const gen = fdex.gen;
	const ruleTable = Dex.formats.getRuleTable(format);
	const index = buildIndex(gen);
	const allowed = new Set<string>();
	for (const id of index.species.keys()) {
		if (!ruleTable.isBannedSpecies(fdex.species.get(id))) allowed.add(id);
	}
	return { gen, allowed };
}

function intersect(a: Set<string>, b: Set<string>): Set<string> {
	const out = new Set<string>();
	for (const x of a) {
		if (b.has(x)) out.add(x);
	}
	return out;
}

export function search(criteria: SearchCriteria): SpeciesInfo[] {
	let gen = criteria.gen;
	let pool: Set<string> | null = null;
	if (criteria.formatId) {
		const fp = formatPool(criteria.formatId);
		if (!fp) throw new Error(`Unknown format: ${criteria.formatId}`);
		gen = fp.gen;
		pool = fp.allowed;
	}

	const index = buildIndex(gen);
	let candidates = new Set(index.species.keys());
	if (pool) candidates = intersect(candidates, pool);

	// Unknown ability/move ids are skipped (ignored), not treated as "zero matches",
	// per the spec. Dropdown-sourced values always exist in the index, so this only
	// affects hand-typed/URL-hacked values.
	if (criteria.ability) {
		const set = index.abilityToSpecies.get(toID(criteria.ability));
		if (set) candidates = intersect(candidates, set);
	}
	if (criteria.moves) {
		for (const move of criteria.moves) {
			const set = index.moveToSpecies.get(toID(move));
			if (set) candidates = intersect(candidates, set);
		}
	}

	const wantedTypes = (criteria.types ?? []).map(t => t.toLowerCase()).filter(Boolean);
	const hasSpeed = criteria.speed !== undefined && !Number.isNaN(criteria.speed);

	const results: SpeciesInfo[] = [];
	for (const id of candidates) {
		const info = index.species.get(id)!;
		if (wantedTypes.length) {
			const have = info.types.map(t => t.toLowerCase());
			if (!wantedTypes.every(t => have.includes(t))) continue;
		}
		if (hasSpeed) {
			const floor = criteria.floor === '31iv' ? info.speRange.min31iv : info.speRange.min0iv;
			if (criteria.speed! < floor || criteria.speed! > info.speRange.max) continue;
		}
		results.push(info);
	}
	results.sort((a, b) => b.baseSpe - a.baseSpe || a.num - b.num);
	return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && npx mocha test/tools/pokemon-search.js`
Expected: PASS (all `search` tests green).

- [ ] **Step 5: Commit**

```bash
git add tools/pokemon-search/engine.ts test/tools/pokemon-search.js
git commit -m "Pokemon Search UI: Add multi-criteria search and format pool"
```

---

## Task 4: Meta (dropdown option lists)

**Files:**
- Modify: `tools/pokemon-search/engine.ts`
- Test: `test/tools/pokemon-search.js`

- [ ] **Step 1: Write the failing test**

Append inside the top-level describe in `test/tools/pokemon-search.js`:

```js
	describe('getMeta', () => {
		const meta = engine.getMeta(9);
		it('lists generations 1..current dynamically', () => {
			assert.deepEqual(meta.generations, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
		});
		it('lists abilities, moves, and types present in the gen', () => {
			assert.ok(meta.abilities.includes('Intimidate'));
			assert.ok(meta.moves.includes('Earthquake'));
			assert.ok(meta.types.includes('Ground'));
			assert.ok(!meta.types.includes('Stellar')); // not a defensive species type
		});
		it('includes playable formats', () => {
			assert.ok(meta.formats.some(f => f.id === 'gen9ou'));
		});
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx mocha test/tools/pokemon-search.js`
Expected: FAIL — `engine.getMeta is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `tools/pokemon-search/engine.ts`:

```ts
export interface Meta {
	generations: number[];
	formats: { id: string, name: string }[];
	abilities: string[];
	moves: string[];
	types: string[];
}

export function getMeta(gen: number, formatId?: string): Meta {
	let effectiveGen = gen;
	if (formatId) {
		const fp = formatPool(formatId);
		if (fp) effectiveGen = fp.gen;
	}
	const index = buildIndex(effectiveGen);
	const dex = Dex.forGen(effectiveGen);

	const abilitySet = new Set<string>();
	const typeSet = new Set<string>();
	for (const info of index.species.values()) {
		for (const ability of info.abilities) abilitySet.add(ability);
		for (const type of info.types) typeSet.add(type);
	}
	const moves: string[] = [];
	for (const moveId of index.moveToSpecies.keys()) moves.push(dex.moves.get(moveId).name);

	const generations: number[] = [];
	for (let g = 1; g <= Dex.gen; g++) generations.push(g);

	const formats: { id: string, name: string }[] = [];
	for (const format of Dex.formats.all()) {
		if (format.effectType === 'Format') formats.push({ id: format.id, name: format.name });
	}

	return {
		generations,
		formats,
		abilities: [...abilitySet].sort(),
		moves: moves.sort(),
		types: [...typeSet].sort(),
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && npx mocha test/tools/pokemon-search.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/pokemon-search/engine.ts test/tools/pokemon-search.js
git commit -m "Pokemon Search UI: Add meta endpoint data"
```

---

## Task 5: HTTP server + smoke test

**Files:**
- Create: `tools/pokemon-search/server.ts`
- Test: `test/tools/pokemon-search.js`

- [ ] **Step 1: Write the failing test**

Append inside the top-level describe in `test/tools/pokemon-search.js`:

```js
	describe('http server', () => {
		const { startServer } = require('../../dist/tools/pokemon-search/server');
		let server, base;
		before(done => {
			server = startServer(0);
			server.listen(0, () => {
				base = `http://localhost:${server.address().port}`;
				done();
			});
		});
		after(() => server.close());

		it('serves /api/meta', async () => {
			const res = await fetch(`${base}/api/meta?gen=9`);
			const body = await res.json();
			assert.ok(body.abilities.includes('Intimidate'));
		});

		it('serves /api/search', async () => {
			const res = await fetch(`${base}/api/search?gen=9&ability=Intimidate&types=Ground,Flying`);
			const body = await res.json();
			assert.ok(body.count >= 1);
			assert.ok(body.results.some(r => r.id === 'landorustherian'));
		});

		it('returns 400 for an invalid generation', async () => {
			const res = await fetch(`${base}/api/search?gen=99`);
			assert.equal(res.status, 400);
		});
	});
```

Note: `startServer(port)` auto-listens only when `port` is truthy. The test passes `0` (falsy), so it gets back a non-listening `http.Server` and binds it itself with `server.listen(0, …)` on an ephemeral port. The real launcher calls `startServer(8080)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx mocha test/tools/pokemon-search.js`
Expected: FAIL — `Cannot find module '../../dist/tools/pokemon-search/server'`.

- [ ] **Step 3: Write minimal implementation**

Create `tools/pokemon-search/server.ts`:

```ts
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { Dex } from '../../sim/dex';
import { getMeta, search } from './engine';
import type { SearchCriteria } from './engine';

const STATIC_DIR = path.resolve(__dirname, '../../../tools/pokemon-search');
const STATIC_FILES: { [k: string]: string } = {
	'/': 'index.html',
	'/index.html': 'index.html',
	'/app.js': 'app.js',
	'/style.css': 'style.css',
};
const CONTENT_TYPES: { [k: string]: string } = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
};

function parseGen(raw: string | null): number {
	const gen = Number(raw);
	if (!Number.isInteger(gen) || gen < 1 || gen > Dex.gen) {
		throw new Error(`Invalid generation: ${raw}`);
	}
	return gen;
}

function handleMeta(params: URLSearchParams) {
	const gen = parseGen(params.get('gen'));
	const formatId = params.get('format') || undefined;
	return getMeta(gen, formatId);
}

function handleSearch(params: URLSearchParams) {
	const gen = parseGen(params.get('gen'));
	const moves = (params.get('moves') ?? '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 4);
	const types = (params.get('types') ?? '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 2);
	const speedRaw = params.get('speed');
	const speed = speedRaw !== null && speedRaw !== '' ? Number(speedRaw) : undefined;
	const criteria: SearchCriteria = {
		gen,
		formatId: params.get('format') || undefined,
		ability: params.get('ability') || undefined,
		moves: moves.length ? moves : undefined,
		types: types.length ? types : undefined,
		speed: speed !== undefined && !Number.isNaN(speed) ? speed : undefined,
		floor: params.get('floor') === '31iv' ? '31iv' : '0iv',
	};
	const results = search(criteria);
	return { count: results.length, results };
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
	res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
	res.end(JSON.stringify(body));
}

export function startServer(port = 8080): http.Server {
	const server = http.createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://localhost');
		try {
			if (url.pathname === '/api/meta') return sendJson(res, 200, handleMeta(url.searchParams));
			if (url.pathname === '/api/search') return sendJson(res, 200, handleSearch(url.searchParams));
			const file = STATIC_FILES[url.pathname];
			if (file) {
				const full = path.join(STATIC_DIR, file);
				res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(full)] ?? 'text/plain' });
				return res.end(fs.readFileSync(full));
			}
			res.writeHead(404, { 'Content-Type': 'text/plain' });
			res.end('Not found');
		} catch (err) {
			sendJson(res, 400, { error: (err as Error).message });
		}
	});
	if (port) {
		server.listen(port, () => console.log(`Pokémon search UI: http://localhost:${port}`));
	}
	return server;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && npx mocha test/tools/pokemon-search.js`
Expected: PASS (server tests green).

- [ ] **Step 5: Commit**

```bash
git add tools/pokemon-search/server.ts test/tools/pokemon-search.js
git commit -m "Pokemon Search UI: Add HTTP server and smoke tests"
```

---

## Task 6: Launcher (`run.js`)

**Files:**
- Create: `tools/pokemon-search/run.js`

No automated test (it shells out to the build); verified manually in Task 8.

- [ ] **Step 1: Write the launcher**

Create `tools/pokemon-search/run.js`:

```js
'use strict';

const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');

// Pokémon Showdown runs from compiled dist/, so ensure it is built (incremental,
// so this is fast after the first run). Mirrors the ./pokemon-showdown launcher.
execSync('node build', { cwd: ROOT, stdio: 'inherit' });

const { startServer } = require(path.join(ROOT, 'dist/tools/pokemon-search/server.js'));
const port = Number(process.env.PORT) || 8080;
startServer(port);
```

- [ ] **Step 2: Verify it boots**

Run: `node tools/pokemon-search/run.js`
Expected: builds, then prints `Pokémon search UI: http://localhost:8080`. Stop it with Ctrl-C.

- [ ] **Step 3: Commit**

```bash
git add tools/pokemon-search/run.js
git commit -m "Pokemon Search UI: Add build-and-serve launcher"
```

---

## Task 7: Frontend (form + results)

**Files:**
- Create: `tools/pokemon-search/index.html`
- Create: `tools/pokemon-search/style.css`
- Create: `tools/pokemon-search/app.js`

Verified manually (Task 8). Frontend edits need no rebuild — they are served from source.

- [ ] **Step 1: Create `tools/pokemon-search/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Pokémon Search</title>
	<link rel="stylesheet" href="/style.css">
</head>
<body>
	<main>
		<h1>Pokémon search</h1>
		<form id="search-form">
			<div class="row">
				<label>Generation
					<select id="gen" name="gen"></select>
				</label>
				<label>Format (optional)
					<select id="format" name="format"><option value="">— none —</option></select>
				</label>
			</div>
			<label>Ability
				<select id="ability" name="ability"><option value="">— any —</option></select>
			</label>
			<fieldset>
				<legend>Moves (up to 4 — must learn all)</legend>
				<div class="row">
					<select class="move" data-slot="0"><option value="">— any —</option></select>
					<select class="move" data-slot="1"><option value="">— any —</option></select>
				</div>
				<div class="row">
					<select class="move" data-slot="2"><option value="">— any —</option></select>
					<select class="move" data-slot="3"><option value="">— any —</option></select>
				</div>
			</fieldset>
			<div class="row">
				<label>Type 1
					<select id="type1"><option value="">— any —</option></select>
				</label>
				<label>Type 2
					<select id="type2"><option value="">— none —</option></select>
				</label>
			</div>
			<div class="row">
				<label>Speed @ Lv 50
					<input type="number" id="speed" min="1" max="1000" placeholder="e.g. 120">
				</label>
				<label>Min-IV floor
					<span class="floor">
						<label><input type="radio" name="floor" value="0iv" checked> 0 IV</label>
						<label><input type="radio" name="floor" value="31iv"> 31 IV</label>
					</span>
				</label>
			</div>
			<button type="submit">Search</button>
		</form>
		<p id="status"></p>
		<table id="results" hidden>
			<thead>
				<tr><th>Pokémon</th><th>Types</th><th>Base Spe</th><th>Spe range L50</th><th id="fit-col">Fits?</th></tr>
			</thead>
			<tbody></tbody>
		</table>
	</main>
	<script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `tools/pokemon-search/style.css`**

```css
:root { font-family: system-ui, sans-serif; }
body { margin: 0; background: #f5f6f8; color: #1c1d20; }
main { max-width: 760px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 22px; font-weight: 600; }
form { background: #fff; border: 1px solid #e2e4e8; border-radius: 12px; padding: 16px; display: grid; gap: 12px; }
label { display: grid; gap: 4px; font-size: 13px; color: #5a5d63; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
fieldset { border: 1px solid #e2e4e8; border-radius: 8px; padding: 12px; margin: 0; display: grid; gap: 12px; }
legend { font-size: 13px; color: #5a5d63; }
select, input[type=number] { width: 100%; box-sizing: border-box; height: 34px; padding: 0 8px; border: 1px solid #cfd2d8; border-radius: 8px; font-size: 14px; background: #fff; }
.floor { display: flex; gap: 16px; align-items: center; height: 34px; }
.floor label { flex-direction: row; align-items: center; gap: 6px; }
button { height: 38px; border: 1px solid #2f6feb; background: #2f6feb; color: #fff; border-radius: 8px; font-size: 15px; cursor: pointer; }
button:hover { background: #275ec9; }
#status { color: #5a5d63; font-size: 14px; }
table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e4e8; border-radius: 12px; overflow: hidden; }
th, td { text-align: left; padding: 8px 10px; font-size: 13px; border-top: 1px solid #eef0f3; }
thead th { border-top: none; color: #5a5d63; }
.yes { color: #1a7f37; } .no { color: #99a0a8; }
```

- [ ] **Step 3: Create `tools/pokemon-search/app.js`**

```js
'use strict';

const $ = id => document.getElementById(id);

function fillSelect(select, values, { keepFirst = true, mapValue = v => v, mapLabel = v => v } = {}) {
	const first = keepFirst && select.options.length ? select.options[0] : null;
	select.innerHTML = '';
	if (first) select.appendChild(first);
	for (const v of values) {
		const opt = document.createElement('option');
		opt.value = mapValue(v);
		opt.textContent = mapLabel(v);
		select.appendChild(opt);
	}
}

async function loadMeta() {
	const gen = $('gen').value || '9';
	const format = $('format').value;
	const url = `/api/meta?gen=${encodeURIComponent(gen)}` + (format ? `&format=${encodeURIComponent(format)}` : '');
	const meta = await (await fetch(url)).json();

	if (!$('gen').options.length) {
		fillSelect($('gen'), meta.generations, { keepFirst: false, mapLabel: g => `Gen ${g}` });
		$('gen').value = String(Math.max(...meta.generations));
	}
	fillSelect($('format'), meta.formats, { mapValue: f => f.id, mapLabel: f => f.name });
	$('format').value = format;
	fillSelect($('ability'), meta.abilities);
	for (const sel of document.querySelectorAll('.move')) fillSelect(sel, meta.moves);
	fillSelect($('type1'), meta.types);
	fillSelect($('type2'), meta.types);
}

function renderResults(body, targetSpeed) {
	const table = $('results');
	const tbody = table.querySelector('tbody');
	tbody.innerHTML = '';
	$('fit-col').textContent = targetSpeed ? `${targetSpeed}?` : 'Spe';
	for (const r of body.results) {
		const tr = document.createElement('tr');
		const range = `${r.speRange.min0iv}–${r.speRange.max}`;
		let fit = '';
		if (targetSpeed) {
			const floor = document.querySelector('input[name=floor]:checked').value === '31iv' ? r.speRange.min31iv : r.speRange.min0iv;
			const ok = targetSpeed >= floor && targetSpeed <= r.speRange.max;
			fit = `<span class="${ok ? 'yes' : 'no'}">${ok ? 'yes' : 'no'}</span>`;
		}
		tr.innerHTML = `<td>${r.name}</td><td>${r.types.join(' / ')}</td><td>${r.baseSpe}</td><td>${range}</td><td>${fit}</td>`;
		tbody.appendChild(tr);
	}
	table.hidden = body.results.length === 0;
	$('status').textContent = body.count ? `${body.count} match${body.count === 1 ? '' : 'es'}` : 'No matches';
}

async function runSearch(e) {
	e.preventDefault();
	const params = new URLSearchParams();
	params.set('gen', $('gen').value);
	if ($('format').value) params.set('format', $('format').value);
	if ($('ability').value) params.set('ability', $('ability').value);
	const moves = [...document.querySelectorAll('.move')].map(s => s.value).filter(Boolean);
	if (moves.length) params.set('moves', moves.join(','));
	const types = [$('type1').value, $('type2').value].filter(Boolean);
	if (types.length) params.set('types', types.join(','));
	const speed = $('speed').value;
	if (speed) params.set('speed', speed);
	params.set('floor', document.querySelector('input[name=floor]:checked').value);

	$('status').textContent = 'Searching…';
	const body = await (await fetch(`/api/search?${params}`)).json();
	renderResults(body, speed ? Number(speed) : null);
}

$('gen').addEventListener('change', loadMeta);
$('format').addEventListener('change', loadMeta);
$('search-form').addEventListener('submit', runSearch);
loadMeta();
```

- [ ] **Step 4: Commit**

```bash
git add tools/pokemon-search/index.html tools/pokemon-search/style.css tools/pokemon-search/app.js
git commit -m "Pokemon Search UI: Add frontend page"
```

---

## Task 8: Full verification + lint

**Files:** none (verification only).

- [ ] **Step 1: Lint and auto-fix the new files**

Run: `npm run fix`
Expected: no remaining errors for `tools/pokemon-search/**` or `test/tools/pokemon-search.js`. Manually resolve anything `--fix` cannot (e.g. unused vars).

- [ ] **Step 2: Typecheck**

Run: `npm run tsc`
Expected: no errors.

- [ ] **Step 3: Run the tool's tests against a fresh build**

Run: `npm run build && npx mocha test/tools/pokemon-search.js`
Expected: all tests pass.

- [ ] **Step 4: Manual end-to-end check**

Run: `node tools/pokemon-search/run.js`, open `http://localhost:8080`. Select Gen 9, Ability = Intimidate, Type 1 = Ground, Type 2 = Flying, Speed = 120, floor = 0 IV; click Search. Confirm Landorus-Therian appears with a `Ground / Flying` typing and a `yes` in the fit column. Pick format `[Gen 9] OU` and confirm the pool narrows. Stop with Ctrl-C.

- [ ] **Step 5: Final commit (if lint/tsc made changes)**

```bash
git add -A tools/pokemon-search test/tools/pokemon-search.js
git commit -m "Pokemon Search UI: Lint and finalize"
```

---

## Notes for the implementer

- Do not delete `zzz_test.ts` — it is the user's scratch sketch. The engine supersedes it, but leave removal to the user.
- Keep the engine free of any `server/` imports (it only imports from `sim/`).
- If a future generation is added upstream, nothing here needs editing: gens come from `Dex.gen`, formats from `Dex.formats.all()`.
- `npm run build` before running the mocha file — the test loads compiled `dist/`, and a single-file mocha run does not trigger `test/main.js`'s auto-build.
- Type filtering is structural (matched directly against `species.types`), so an invalid/unknown type yields no matches rather than being ignored. This only matters for hand-crafted URLs; the dropdown only offers real types.
