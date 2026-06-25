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

// Speed is handled entirely client-side: each result carries its level-50 speed
// range, so the desired speed only colors the range cell (green in range, red
// out) and — when "only show matches" is checked — filters non-matching rows.
// Re-rendering from the stored results makes the speed/floor/checkbox controls
// update instantly without a new search.
function render() {
	if (!searched) return;
	const speed = Number($('speed').value) || 0;
	const floor = document.querySelector('input[name=floor]:checked').value;
	const onlyMatches = $('speed-filter').checked;
	const table = $('results');
	const tbody = table.querySelector('tbody');
	tbody.innerHTML = '';

	const cmp = SORT_KEYS[sortKey];
	const sorted = [...lastResults].sort((a, b) => cmp(a, b) * sortDir || a.num - b.num || a.name.localeCompare(b.name));
	let shown = 0;
	for (const r of sorted) {
		const floorSpe = floor === '31iv' ? r.speRange.min31iv : r.speRange.min0iv;
		const inRange = speed > 0 && speed >= floorSpe && speed <= r.speRange.max;
		if (onlyMatches && speed > 0 && !inRange) continue;
		const cls = speed > 0 ? (inRange ? 'in-range' : 'out-range') : '';
		const range = `${floorSpe}–${r.speRange.max}`;
		const tr = document.createElement('tr');
		const b = r.baseStats;
		const stats = [b.hp, b.atk, b.def, b.spa, b.spd, b.spe, est(r)].map(v => `<td class="num-col">${v}</td>`).join('');
		tr.innerHTML = `<td>${r.num}</td><td>${r.name}</td><td>${r.types.join(' / ')}</td>${stats}<td class="${cls}">${range}</td>`;
		tbody.appendChild(tr);
		shown++;
	}

	table.hidden = shown === 0;
	$('status').textContent = shown ? `${shown} match${shown === 1 ? '' : 'es'}` : 'No matches';
	updateSortIndicators();
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

	$('status').textContent = 'Searching…';
	const body = await (await fetch(`/api/search?${params}`)).json();
	lastResults = body.results;
	searched = true;
	render();
}

$('gen').addEventListener('change', loadMeta);
$('format').addEventListener('change', loadMeta);
$('search-form').addEventListener('submit', runSearch);
$('speed').addEventListener('input', render);
for (const radio of document.querySelectorAll('input[name=floor]')) radio.addEventListener('change', render);
$('speed-filter').addEventListener('change', render);
for (const th of document.querySelectorAll('th.sortable')) th.addEventListener('click', () => sortBy(th.dataset.sort));
loadMeta();
