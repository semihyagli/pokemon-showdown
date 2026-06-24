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

	describe('search', () => {
		it('ANDs ability + dual typing', () => {
			const results = engine.search({ gen: 9, ability: 'Intimidate', types: ['Ground', 'Flying'] });
			const ids = results.map(r => r.id);
			assert(ids.includes('landorustherian'));
		});

		it('requires ALL listed moves (intersection)', () => {
			const results = engine.search({ gen: 9, moves: ['earthquake', 'uturn'], types: ['Ground', 'Flying'] });
			assert(results.some(r => r.id === 'landorustherian'));
		});

		it('treats one type as "has that type" (mono or dual)', () => {
			const results = engine.search({ gen: 9, types: ['Flying'] });
			assert(results.some(r => r.id === 'landorustherian'));
		});

		it('filters by level-50 speed range inclusive of bounds', () => {
			const lando = engine.buildIndex(9).species.get('landorustherian');
			const atMax = engine.search({ gen: 9, ability: 'Intimidate', speed: lando.speRange.max, floor: '0iv' });
			assert(atMax.some(r => r.id === 'landorustherian'));
			const tooFast = engine.search({ gen: 9, ability: 'Intimidate', speed: lando.speRange.max + 1, floor: '0iv' });
			assert(!tooFast.some(r => r.id === 'landorustherian'));
		});

		it('uses the 31iv floor (higher) when floor is 31iv', () => {
			const lando = engine.buildIndex(9).species.get('landorustherian');
			const atFloor = engine.search({ gen: 9, ability: 'Intimidate', speed: lando.speRange.min31iv, floor: '31iv' });
			assert(atFloor.some(r => r.id === 'landorustherian'));
			const belowFloor = engine.search({ gen: 9, ability: 'Intimidate', speed: lando.speRange.min0iv, floor: '31iv' });
			assert(!belowFloor.some(r => r.id === 'landorustherian'));
		});

		it('sorts results by national dex number ascending', () => {
			const results = engine.search({ gen: 9, types: ['Dragon'] });
			for (let i = 1; i < results.length; i++) {
				assert(results[i - 1].num <= results[i].num);
			}
		});

		it('applies a format pool (Ubers banned from OU)', () => {
			const ou = engine.search({ gen: 9, formatId: 'gen9ou', types: ['Psychic'] });
			assert(!ou.some(r => r.id === 'mewtwo'), 'Mewtwo (Uber) must be excluded from OU');
		});
	});

	describe('getMeta', () => {
		const meta = engine.getMeta(9);
		it('lists generations 1..current dynamically', () => {
			assert.deepEqual(meta.generations, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
		});
		it('lists abilities, moves, and types present in the gen', () => {
			assert(meta.abilities.includes('Intimidate'));
			assert(meta.moves.includes('Earthquake'));
			assert(meta.types.includes('Ground'));
			assert(!meta.types.includes('Stellar')); // not a defensive species type
		});
		it('includes playable formats', () => {
			assert(meta.formats.some(f => f.id === 'gen9ou'));
		});
	});

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
			assert(body.abilities.includes('Intimidate'));
		});

		it('serves /api/search', async () => {
			const res = await fetch(`${base}/api/search?gen=9&ability=Intimidate&types=Ground,Flying`);
			const body = await res.json();
			assert(body.count >= 1);
			assert(body.results.some(r => r.id === 'landorustherian'));
		});

		it('returns 400 for an invalid generation', async () => {
			const res = await fetch(`${base}/api/search?gen=99`);
			assert.equal(res.status, 400);
		});
	});
});
