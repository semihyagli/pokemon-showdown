'use strict';
/* global document */

const $ = id => document.getElementById(id);

let lastResults = [];
let searched = false;

// Click-to-sort: ascending comparator per column; clicking a header toggles
// direction. A secondary sort by dex number / name keeps ties stable.
// Effective stat total: a Pokemon is usually a physical OR special attacker, so
// only the larger of Atk/SpA is counted. This lightly penalizes mixed attackers.
function est(r) {
	const b = r.baseStats;
	return b.hp + b.def + b.spd + b.spe + Math.max(b.atk, b.spa);
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
		const stats = [b.hp, b.atk, b.def, b.spa, b.spd, b.spe, est(r)].map(v => `<td class="num-col">${v}</td>`).join('');
		tr.innerHTML = `<td class="pin-cell" data-id="${r.id}" title="pin/unpin reference">${pinned.has(r.id) ? '★' : '☆'}</td><td>${r.num}</td><td>${r.name}</td><td>${r.types.join(' / ')}</td><td>${r.abilities.join(', ')}</td>${stats}${speedCells.map(c => c.html).join('')}`;
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
	params.set('gen', genMap[$('gen').value] || '9');
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

	$('status').textContent = 'Searching…';
	const body = await (await fetch(`/api/search?${params}`)).json();
	lastResults = body.results;
	searched = true;
	speedFilters.clear();
	render();
}

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
