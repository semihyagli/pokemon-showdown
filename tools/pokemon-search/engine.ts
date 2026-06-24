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
			baseSpe: sp.baseStats.spe,
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
	results.sort((a, b) => b.baseSpe - a.baseSpe || a.num - b.num);
	return results;
}
