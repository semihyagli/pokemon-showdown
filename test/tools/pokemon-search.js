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

	describe('buildIndex(9)', () => {
		const index = engine.buildIndex(9);

		it('indexes a stable species with correct info', () => {
			const lando = index.species.get('landorustherian');
			assert(lando, 'Landorus-Therian should be present');
			assert.equal(lando.name, 'Landorus-Therian');
			assert.deepEqual(lando.types, ['Ground', 'Flying']);
			assert(lando.abilities.includes('Intimidate'));
			assert.equal(lando.baseSpe, 91);
			assert.deepEqual(lando.speRange, engine.speedRange(91));
		});

		it('maps abilities to species (reverse index)', () => {
			assert(index.abilityToSpecies.get('intimidate').has('landorustherian'));
		});

		it('maps gen-9-learnable moves to species', () => {
			assert(index.moveToSpecies.get('thunderbolt').has('pikachu'));
			assert(index.moveToSpecies.get('earthquake').has('landorustherian'));
		});

		it('excludes non-standard fakemon (CAP) from the pool', () => {
			for (const info of index.species.values()) {
				assert.notEqual(info.name, 'Syclant'); // a CAP species
			}
		});
	});
});
