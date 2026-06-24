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
