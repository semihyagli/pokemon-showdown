import { Dex, toID } from '../../sim/dex';
import type { Learnset } from '../../sim/dex-species';

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

export interface SpeciesInfo {
	id: string;
	name: string;
	num: number;
	types: string[];
	abilities: string[];
	baseStats: Record<StatKey, number>;
	speRange: SpeRange;
}

export interface GenIndex {
	gen: number;
	abilityToSpecies: Map<string, Set<string>>;
	moveToSpecies: Map<string, Set<string>>;
	species: Map<string, SpeciesInfo>;
}

const indexCache = new Map<number, GenIndex>();

function inGenPool(
	sp: { exists: boolean, num: number, gen: number, isNonstandard: string | null }, gen: number
): boolean {
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
			baseStats: { ...sp.baseStats },
			speRange: speedRange(sp.baseStats.spe),
		});

		let learnsets: (Learnset & { learnset: NonNullable<Learnset['learnset']> })[];
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
				const learnable = lset[moveId].some(src => parseInt(src) === gen);
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

export type ResistStabMode = 'resist' | 'resistneutral';
export type SuperStabMode = 'se' | 'seneutral';

export interface SearchCriteria {
	gen: number;
	formatId?: string;
	species?: string;
	ability?: string;
	moves?: string[];
	types?: string[];
	speed?: number;
	floor?: '0iv' | '31iv';
	resistStab?: string;
	resistStabMode?: ResistStabMode;
	superStab?: string;
	superStabMode?: SuperStabMode;
}

// A candidate "defends" against the source's STAB if, for *every* one of the
// source's types (its STAB types), the candidate's full type combination is not
// hit super-effectively. Immunity and resistance both count as defending; in
// `resistneutral` mode a neutral (1x) matchup counts too, but a single
// super-effective STAB type disqualifies the candidate (so dual-typed defenders
// must hold up against both STAB types at once).
function defendsStab(
	dex: ReturnType<typeof Dex.forGen>, stabTypes: string[], candidateTypes: string[], allowNeutral: boolean
): boolean {
	for (const atkType of stabTypes) {
		// Immunity (e.g. Flying vs Ground) zeroes the whole combination regardless
		// of the other type, so it must be checked first — getEffectiveness sums
		// per-type modifiers and on its own can't tell immunity from neutral.
		if (!dex.getImmunity(atkType, candidateTypes)) continue;
		const mod = dex.getEffectiveness(atkType, candidateTypes); // >0 weak, 0 neutral, <0 resist
		if (mod < 0) continue;
		if (mod === 0 && allowNeutral) continue;
		return false;
	}
	return true;
}

// "Super Effective STAB against <threat>": does the candidate have at least one
// STAB type (one of its own types) that hits the threat's typing super-effectively?
// This finds *counters* to the threat — Pokemon that can click a STAB move for
// extra damage on it. With allowNeutral, a STAB type that lands at least neutrally
// also counts. Aggregation is OR: one good STAB type is enough. Note the candidate
// is the attacker here and the named Pokemon is the defender — the opposite roles
// from defendsStab.
function hasSuperEffectiveStab(
	dex: ReturnType<typeof Dex.forGen>, threatTypes: string[], candidateTypes: string[], allowNeutral: boolean
): boolean {
	for (const stabType of candidateTypes) {
		// If this STAB type is immune against the threat (e.g. Normal vs a Ghost
		// threat) it deals 0, so it can never be the counter's offensive answer.
		if (!dex.getImmunity(stabType, threatTypes)) continue;
		const mod = dex.getEffectiveness(stabType, threatTypes); // >0 super-effective, 0 neutral, <0 resisted
		if (mod > 0) return true;
		if (mod === 0 && allowNeutral) return true;
	}
	return false;
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

	if (criteria.species) candidates = intersect(candidates, new Set([toID(criteria.species)]));

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

	// "Resists STAB from <Pokemon>": keep only candidates whose typing resists (or,
	// in resistneutral mode, isn't weak to) every STAB type of the named Pokemon.
	// Types are read gen-correctly via forGen; an unknown name is ignored, matching
	// the ability/move behavior above.
	if (criteria.resistStab) {
		const srcDex = Dex.forGen(gen);
		const src = srcDex.species.get(criteria.resistStab);
		if (src.exists && src.types.length) {
			const allowNeutral = criteria.resistStabMode === 'resistneutral';
			const filtered = new Set<string>();
			for (const id of candidates) {
				const info = index.species.get(id);
				if (info && defendsStab(srcDex, src.types, info.types, allowNeutral)) filtered.add(id);
			}
			candidates = filtered;
		}
	}

	// "Super Effective STAB against <Pokemon>": keep candidates whose own STAB hits
	// the named Pokemon (the threat) super-effectively (or, in seneutral mode, at
	// least neutrally) with at least one of their types — i.e. offensive counters.
	if (criteria.superStab) {
		const srcDex = Dex.forGen(gen);
		const threat = srcDex.species.get(criteria.superStab);
		if (threat.exists && threat.types.length) {
			const allowNeutral = criteria.superStabMode === 'seneutral';
			const filtered = new Set<string>();
			for (const id of candidates) {
				const info = index.species.get(id);
				if (info && hasSuperEffectiveStab(srcDex, threat.types, info.types, allowNeutral)) filtered.add(id);
			}
			candidates = filtered;
		}
	}

	const wantedTypes = (criteria.types ?? []).map(t => t.toLowerCase()).filter(Boolean);

	const results: SpeciesInfo[] = [];
	for (const id of candidates) {
		const info = index.species.get(id);
		if (!info) continue;
		if (wantedTypes.length) {
			const have = info.types.map(t => t.toLowerCase());
			if (!wantedTypes.every(t => have.includes(t))) continue;
		}
		if (criteria.speed !== undefined && !Number.isNaN(criteria.speed)) {
			const floor = criteria.floor === '31iv' ? info.speRange.min31iv : info.speRange.min0iv;
			if (criteria.speed < floor || criteria.speed > info.speRange.max) continue;
		}
		results.push(info);
	}
	results.sort((a, b) => a.num - b.num || a.name.localeCompare(b.name));
	return results;
}

export interface Meta {
	generations: number[];
	formats: { id: string, name: string }[];
	species: string[];
	abilities: string[];
	moves: string[];
	types: string[];
}

export function getMeta(gen: number, formatId?: string): Meta {
	let effectiveGen = gen;
	let pool: Set<string> | null = null;
	if (formatId) {
		const fp = formatPool(formatId);
		if (fp) {
			effectiveGen = fp.gen;
			pool = fp.allowed;
		}
	}
	const index = buildIndex(effectiveGen);
	const dex = Dex.forGen(effectiveGen);

	const abilitySet = new Set<string>();
	const typeSet = new Set<string>();
	const species: string[] = [];
	for (const info of index.species.values()) {
		if (pool && !pool.has(info.id)) continue;
		species.push(info.name);
		for (const ability of info.abilities) abilitySet.add(ability);
		for (const type of info.types) typeSet.add(type);
	}
	const moves: string[] = [];
	for (const moveId of index.moveToSpecies.keys()) moves.push(dex.moves.get(moveId).name);

	// `Dex.gen` is the latest generation (e.g. 9). It is 0 until data has loaded,
	// but `buildIndex` above always triggers a load first, so it is populated here.
	const generations: number[] = [];
	for (let g = 1; g <= Dex.gen; g++) generations.push(g);

	const formats: { id: string, name: string }[] = [];
	for (const format of Dex.formats.all()) {
		if (format.effectType === 'Format') formats.push({ id: format.id, name: format.name });
	}

	return {
		generations,
		formats,
		species: species.sort(),
		abilities: [...abilitySet].sort(),
		moves: moves.sort(),
		types: [...typeSet].sort(),
	};
}
