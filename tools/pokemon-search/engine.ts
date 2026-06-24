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
