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
