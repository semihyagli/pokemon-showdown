'use strict';
/* global document, localStorage */

const $ = id => document.getElementById(id);

// Theme toggle: the initial theme is set pre-paint by an inline script in
// index.html (default dark). The button shows the icon of the mode it switches
// to, flips data-theme on <html>, and persists the choice in localStorage.
function applyThemeIcon() {
	$('theme-toggle').textContent = document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙';
}
$('theme-toggle').addEventListener('click', () => {
	const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
	document.documentElement.dataset.theme = next;
	localStorage.setItem('pokemon-search-theme', next);
	applyThemeIcon();
});
applyThemeIcon();

let lastResults = [];
let searched = false;
// Generation the current results were fetched for, so dex links stay correct
// even if the gen dropdown is changed before the next search.
let searchedGen = '9';

// Smogon Dex generation codes (e.g. gen 2 = "gs" for Gold/Silver), used to build
// per-Pokemon links like https://www.smogon.com/dex/gs/pokemon/charizard/. Smogon
// is not in the repo data, so this is hardcoded; unmapped (future) gens fall back
// to the latest known code.
const SMOGON_GEN_CODES = {
	1: 'rb', 2: 'gs', 3: 'rs', 4: 'dp', 5: 'bw', 6: 'xy', 7: 'sm', 8: 'ss', 9: 'sv',
};
const LATEST_SMOGON_CODE = SMOGON_GEN_CODES[Math.max(...Object.keys(SMOGON_GEN_CODES).map(Number))];
const smogonGenCode = gen => SMOGON_GEN_CODES[Number(gen)] || LATEST_SMOGON_CODE;
// Smogon slugs are the display name lowercased, apostrophes/periods dropped and
// remaining runs of non-alphanumerics turned into single hyphens (e.g.
// "Charizard-Mega-X" -> "charizard-mega-x", "Farfetch'd" -> "farfetchd").
const smogonSlug = name => name.toLowerCase().replace(/['.’:]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Click-to-sort: ascending comparator per column; clicking a header toggles
// direction. A secondary sort by dex number / name keeps ties stable.
// Effective stat total: a Pokemon is usually a physical OR special attacker, so
// only the larger of Atk/SpA is counted. This lightly penalizes mixed attackers.
function est(r) {
	const b = r.baseStats;
	return b.hp + b.def + b.spd + b.spe + Math.max(b.atk, b.spa);
}

// Color a base stat by tier: ≤60 is low (red, deeper the lower), 60–100 is average
// (yellow, leaning red near 60 and green near 100), >100 is high (green), and
// extreme values converge to blue. Implemented as a gradient over [value,[r,g,b]]
// stops with linear interpolation between the two surrounding stops. The text color
// flips to dark on light (yellow/green) fills so the number stays readable in both
// themes.
const STAT_STOPS = [
	[0, [120, 0, 0]],
	[60, [200, 45, 40]],
	[80, [230, 200, 50]],
	[100, [70, 190, 70]],
	[150, [40, 170, 95]],
	[200, [50, 110, 225]],
];
const lerp = (a, b, t) => Math.round(a + (b - a) * t);
function statColor(v) {
	const stops = STAT_STOPS;
	const x = Math.max(stops[0][0], Math.min(v, stops[stops.length - 1][0]));
	let rgb = stops[stops.length - 1][1];
	for (let i = 1; i < stops.length; i++) {
		if (x <= stops[i][0]) {
			const [lo, c0] = stops[i - 1];
			const [hi, c1] = stops[i];
			const t = (x - lo) / (hi - lo);
			rgb = [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
			break;
		}
	}
	const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
	return { bg: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`, fg: lum > 0.6 ? '#111' : '#fff' };
}

const SORT_KEYS = {
	num: (a, b) => a.num - b.num,
	name: (a, b) => a.name.localeCompare(b.name),
	types: (a, b) => a.types[0].localeCompare(b.types[0]) || (a.types[1] || '').localeCompare(b.types[1] || ''),
	hp: (a, b) => a.baseStats.hp - b.baseStats.hp,
	atk: (a, b) => a.baseStats.atk - b.baseStats.atk,
	def: (a, b) => a.baseStats.def - b.baseStats.def,
	spa: (a, b) => a.baseStats.spa - b.baseStats.spa,
	spd: (a, b) => a.baseStats.spd - b.baseStats.spd,
	spe: (a, b) => a.baseStats.spe - b.baseStats.spe,
	est: (a, b) => est(a) - est(b),
	speL50: (a, b) => a.speRange.max - b.speRange.max,
};
let sortKey = 'num';
let sortDir = 1;

function updateSortIndicators() {
	for (const th of document.querySelectorAll('th.sortable')) {
		const active = th.dataset.sort === sortKey;
		th.classList.toggle('sorted', active);
		th.querySelector('.arrow').textContent = active ? (sortDir === 1 ? '↑' : '↓') : '';
	}
}

function sortBy(key) {
	if (key === sortKey) {
		sortDir = -sortDir;
	} else {
		sortKey = key;
		sortDir = 1;
	}
	render();
}

// Click-to-filter on speed columns: each active column hides rows that are red
// (out of the faster/slower range) in that column. Reset on every new search.
const speedFilters = new Set();

function updateSpeedFilterIndicators() {
	for (const th of document.querySelectorAll('th.speed-col')) {
		const active = speedFilters.has(Number(th.dataset.col));
		th.classList.toggle('filtering', active);
		th.querySelector('.fil').textContent = active ? '✓' : '';
	}
}

function toggleSpeedFilter(col) {
	if (speedFilters.has(col)) speedFilters.delete(col);
	else speedFilters.add(col);
	render();
}

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

const pinned = new Map();
let speciesOptions = [];
let abilityOptions = [];
let moveOptions = [];
let genLabels = [];
let genMap = {};
let formatLabels = [];
let formatMap = {};

function isSubseq(q, s) {
	let i = 0;
	for (const ch of s) {
		if (ch === q[i]) i++;
		if (i === q.length) return true;
	}
	return i === q.length;
}

// Rank a single token against an option id: 0 = prefix, 1 = substring, 2 = fuzzy
// subsequence (e.g. "drco" -> "Draco Meteor"), -1 = no match.
function tokenRank(token, o) {
	const idx = o.indexOf(token);
	if (idx === 0) return 0;
	if (idx > 0) return 1;
	if (isSubseq(token, o)) return 2;
	return -1;
}

// Rank options for a query: prefix match first, then substring, then fuzzy
// subsequence. The query is split on whitespace/hyphens into tokens that must all
// match (e.g. "tyranitar mega" / "ttar mega" -> "Tyranitar-Mega"), so a base name
// plus a forme suffix narrows instead of flooding. Names/queries compared as IDs.
function fuzzyMatch(query, options, limit = 100000) {
	const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
	if (!tokens.length) return [];
	const scored = [];
	for (const opt of options) {
		const o = opt.toLowerCase().replace(/[^a-z0-9]/g, '');
		let rank = 0;
		let ok = true;
		for (const token of tokens) {
			const r = tokenRank(token, o);
			if (r === -1) { ok = false; break; }
			rank += r;
		}
		if (ok) scored.push([rank, opt]);
	}
	scored.sort((a, b) => a[0] - b[0] || a[1].length - b[1].length || a[1].localeCompare(b[1]));
	return scored.slice(0, limit).map(s => s[1]);
}

// Turn a text input into a type-ahead combobox over getOptions().
function setupAutocomplete(input, getOptions, onSelect) {
	const list = document.createElement('ul');
	list.className = 'ac-list';
	list.hidden = true;
	input.insertAdjacentElement('afterend', list);
	let matches = [];
	let active = -1;

	const close = () => { list.hidden = true; active = -1; };
	const choose = val => {
		input.value = val;
		close();
		if (onSelect) onSelect(val);
	};
	const show = () => {
		matches = fuzzyMatch(input.value, getOptions());
		list.innerHTML = '';
		if (!matches.length) { close(); return; }
		matches.forEach((m, i) => {
			const li = document.createElement('li');
			li.textContent = m;
			if (i === active) li.className = 'active';
			li.addEventListener('mousedown', e => { e.preventDefault(); choose(m); });
			list.appendChild(li);
		});
		list.hidden = false;
	};
	const highlight = () => {
		[...list.children].forEach((li, i) => li.classList.toggle('active', i === active));
		if (active >= 0) list.children[active].scrollIntoView({ block: 'nearest' });
	};

	input.addEventListener('input', () => { active = -1; show(); });
	input.addEventListener('focus', () => { if (input.value) show(); });
	input.addEventListener('blur', () => setTimeout(close, 120));
	input.addEventListener('keydown', e => {
		if (list.hidden) return;
		if (e.key === 'ArrowDown') {
			active = Math.min(active + 1, matches.length - 1);
			e.preventDefault();
		} else if (e.key === 'ArrowUp') {
			active = Math.max(active - 1, 0);
			e.preventDefault();
		} else if (e.key === 'Enter' && active >= 0) {
			choose(matches[active]);
			e.preventDefault();
		} else if (e.key === 'Escape') {
			close();
			return;
		} else {
			return;
		}
		highlight();
	});
}

// When the gen/format changes, a typed value can become invalid for the new pool
// (e.g. the move "Light of Ruin" doesn't exist in Gen 8, or an ability is removed).
// The engine silently ignores unknown move/ability ids, which would widen a search
// to the whole dex, so drop any field value that is no longer a valid option. Values
// still valid in the new pool (a species present in every gen, etc.) are kept, so
// switching gens doesn't wipe a usable filter.
function pruneInvalidInputs() {
	const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
	const validate = (input, options) => {
		if (!input.value) return;
		const want = norm(input.value);
		if (!options.some(o => norm(o) === want)) input.value = '';
	};
	validate($('species'), speciesOptions);
	validate($('resiststab'), speciesOptions);
	validate($('superstab'), speciesOptions);
	validate($('ability'), abilityOptions);
	for (const inp of document.querySelectorAll('.move')) validate(inp, moveOptions);
}

async function loadMeta() {
	const gen = genMap[$('gen').value] || '9';
	const format = formatMap[$('format').value] || '';
	const url = `/api/meta?gen=${encodeURIComponent(gen)}` + (format ? `&format=${encodeURIComponent(format)}` : '');
	const meta = await (await fetch(url)).json();

	const firstLoad = genLabels.length === 0;
	genLabels = meta.generations.map(g => `Gen ${g}`);
	formatLabels = meta.formats.map(f => f.name);
	// eslint-disable-next-line require-atomic-updates
	genMap = Object.fromEntries(meta.generations.map(g => [`Gen ${g}`, String(g)]));
	// eslint-disable-next-line require-atomic-updates
	formatMap = Object.fromEntries(meta.formats.map(f => [f.name, f.id]));
	if (firstLoad) $('gen').value = `Gen ${Math.max(...meta.generations)}`;
	speciesOptions = meta.species;
	abilityOptions = meta.abilities;
	moveOptions = meta.moves;
	fillSelect($('type1'), meta.types);
	fillSelect($('type2'), meta.types);
	if (!firstLoad) pruneInvalidInputs();
}

// Speed is handled entirely client-side: each result carries its level-50 speed
// range, from which we derive the Scarf (×1.5), Tailwind (×2), and Scarf+Tailwind
// (×3) ranges. The "faster than" / "slower than" targets color each speed cell
// green when that column's range can satisfy them (max > faster, min < slower).
// Clicking a speed column header filters out its red (out-of-range) rows.
// Re-rendering from the stored results updates the controls instantly.
function render() {
	if (!searched) return;
	const faster = Number($('faster').value) || 0;
	const slower = Number($('slower').value) || 0;
	const hasTarget = faster > 0 || slower > 0;
	const floor = document.querySelector('input[name=floor]:checked').value;
	const table = $('results');
	const tbody = table.querySelector('tbody');
	tbody.innerHTML = '';

	const cmp = SORT_KEYS[sortKey];
	const sorted = [...lastResults].sort((a, b) => cmp(a, b) * sortDir || a.num - b.num || a.name.localeCompare(b.name));
	let shown = 0;
	const ordered = [...pinned.values(), ...sorted.filter(r => !pinned.has(r.id))];
	for (const r of ordered) {
		const isPinned = pinned.has(r.id);
		const floorSpe = floor === '31iv' ? r.speRange.min31iv : r.speRange.min0iv;
		const baseMax = r.speRange.max;
		// Speed @ L50 ranges: base, Choice Scarf (×1.5), Tailwind (×2), Scarf+Tailwind (×3).
		const speedRanges = [
			[floorSpe, baseMax],
			[Math.floor(floorSpe * 1.5), Math.floor(baseMax * 1.5)],
			[floorSpe * 2, baseMax * 2],
			[floorSpe * 3, baseMax * 3],
		];
		const speedCells = speedRanges.map(([lo, hi]) => {
			let match = hasTarget;
			if (faster > 0) match = match && hi > faster;
			if (slower > 0) match = match && lo < slower;
			return { html: `<td class="${hasTarget ? (match ? 'in-range' : 'out-range') : ''}">${lo}–${hi}</td>`, red: hasTarget && !match };
		});
		if (!isPinned && [...speedFilters].some(col => speedCells[col].red)) continue;
		const tr = document.createElement('tr');
		if (isPinned) tr.className = 'pinned-row';
		const b = r.baseStats;
		const statCells = [b.hp, b.atk, b.def, b.spa, b.spd, b.spe].map(v => {
			const { bg, fg } = statColor(v);
			return `<td class="num-col stat-cell" style="background:${bg};color:${fg}">${v}</td>`;
		}).join('');
		const stats = statCells + `<td class="num-col">${est(r)}</td>`;
		tr.innerHTML = `<td class="pin-cell" data-id="${r.id}" title="pin/unpin reference">${pinned.has(r.id) ? '★' : '☆'}</td><td><a href="https://pokemondb.net/pokedex/${r.num}/moves/${searchedGen}" target="_blank" rel="noopener" title="View moves on PokemonDB">${r.num}</a></td><td><a href="https://www.smogon.com/dex/${smogonGenCode(searchedGen)}/pokemon/${smogonSlug(r.name)}/" target="_blank" rel="noopener" title="View on Smogon Dex">${r.name}</a></td><td>${r.types.join(' / ')}</td><td>${r.abilities.join(', ')}</td>${stats}${speedCells.map(c => c.html).join('')}`;
		tbody.appendChild(tr);
		if (!isPinned) shown++;
	}

	table.hidden = shown === 0 && pinned.size === 0;
	$('status').textContent = (shown ? `${shown} match${shown === 1 ? '' : 'es'}` : 'No matches') + (pinned.size ? ` · ${pinned.size} pinned` : '');
	updateSortIndicators();
	updateSpeedFilterIndicators();
}

async function runSearch(e) {
	e.preventDefault();
	const params = new URLSearchParams();
	searchedGen = genMap[$('gen').value] || '9';
	params.set('gen', searchedGen);
	const fmt = formatMap[$('format').value];
	if (fmt) params.set('format', fmt);
	if ($('species').value) params.set('species', $('species').value);
	if ($('resiststab').value) {
		params.set('resiststab', $('resiststab').value);
		if ($('resiststab-neutral').checked) params.set('resiststabmode', 'resistneutral');
	}
	if ($('superstab').value) {
		params.set('superstab', $('superstab').value);
		if ($('superstab-neutral').checked) params.set('superstabmode', 'seneutral');
	}
	if ($('ability').value) params.set('ability', $('ability').value);
	const moves = [...document.querySelectorAll('.move')].map(s => s.value).filter(Boolean);
	if (moves.length) params.set('moves', moves.join(','));
	const types = [$('type1').value, $('type2').value].filter(Boolean);
	if (types.length) params.set('types', types.join(','));
	if ($('exclude-unevolved').checked) params.set('excludeunevolved', '1');
	for (const chip of document.querySelectorAll('#category-chips .chip')) {
		if (chip.dataset.state !== 'any') params.set(chip.dataset.cat, chip.dataset.state);
	}

	$('status').textContent = 'Searching…';
	const body = await (await fetch(`/api/search?${params}`)).json();
	lastResults = body.results;
	searched = true;
	speedFilters.clear();
	render();
}

// Category chips cycle any -> only -> exclude -> any on click. State lives in the
// data-state attribute (read at search time); CSS keys color/prefix off it.
const CHIP_STATES = ['any', 'only', 'exclude'];
$('category-chips').addEventListener('click', e => {
	const chip = e.target.closest('.chip');
	if (!chip) return;
	chip.dataset.state = CHIP_STATES[(CHIP_STATES.indexOf(chip.dataset.state) + 1) % CHIP_STATES.length];
});

// Reset every search option back to its default while keeping pinned Pokémon on
// the list. The previous result set is dropped (lastResults = []), so render()
// shows only the pinned rows; gen returns to the latest, format to any.
function resetOptions() {
	for (const id of ['species', 'ability', 'resiststab', 'superstab', 'faster', 'slower']) $(id).value = '';
	for (const inp of document.querySelectorAll('.move')) inp.value = '';
	$('resiststab-neutral').checked = false;
	$('superstab-neutral').checked = false;
	$('type1').value = '';
	$('type2').value = '';
	document.querySelector('input[name=floor][value="0iv"]').checked = true;
	$('exclude-unevolved').checked = true;
	for (const chip of document.querySelectorAll('#category-chips .chip')) chip.dataset.state = 'any';
	speedFilters.clear();
	sortKey = 'num';
	sortDir = 1;
	const latestGen = Math.max(...Object.values(genMap).map(Number));
	if (Number.isFinite(latestGen)) $('gen').value = `Gen ${latestGen}`;
	$('format').value = '';
	lastResults = [];
	loadMeta();
	render();
}
$('reset').addEventListener('click', resetOptions);

setupAutocomplete($('gen'), () => genLabels, () => loadMeta());
setupAutocomplete($('format'), () => formatLabels, () => loadMeta());
$('search-form').addEventListener('submit', runSearch);
$('faster').addEventListener('input', render);
$('slower').addEventListener('input', render);
for (const radio of document.querySelectorAll('input[name=floor]')) radio.addEventListener('change', render);
for (const th of document.querySelectorAll('th.speed-col')) th.addEventListener('click', () => toggleSpeedFilter(Number(th.dataset.col)));
for (const th of document.querySelectorAll('th.sortable')) th.addEventListener('click', () => sortBy(th.dataset.sort));
$('results').addEventListener('click', e => {
	const cell = e.target.closest('.pin-cell');
	if (!cell) return;
	const id = cell.dataset.id;
	if (pinned.has(id)) {
		pinned.delete(id);
	} else {
		const info = lastResults.find(r => r.id === id);
		if (info) pinned.set(id, info);
	}
	render();
});
setupAutocomplete($('species'), () => speciesOptions);
setupAutocomplete($('resiststab'), () => speciesOptions);
setupAutocomplete($('superstab'), () => speciesOptions);
setupAutocomplete($('ability'), () => abilityOptions);
for (const inp of document.querySelectorAll('.move')) setupAutocomplete(inp, () => moveOptions);
loadMeta();
