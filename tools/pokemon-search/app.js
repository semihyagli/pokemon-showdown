'use strict';
/* global document */

const $ = id => document.getElementById(id);

let lastResults = [];
let searched = false;

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

	let shown = 0;
	for (const r of lastResults) {
		const floorSpe = floor === '31iv' ? r.speRange.min31iv : r.speRange.min0iv;
		const inRange = speed > 0 && speed >= floorSpe && speed <= r.speRange.max;
		if (onlyMatches && speed > 0 && !inRange) continue;
		const cls = speed > 0 ? (inRange ? 'in-range' : 'out-range') : '';
		const range = `${floorSpe}–${r.speRange.max}`;
		const tr = document.createElement('tr');
		tr.innerHTML = `<td>${r.name}</td><td>${r.types.join(' / ')}</td><td>${r.baseSpe}</td><td class="${cls}">${range}</td>`;
		tbody.appendChild(tr);
		shown++;
	}

	table.hidden = shown === 0;
	$('status').textContent = shown ? `${shown} match${shown === 1 ? '' : 'es'}` : 'No matches';
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
loadMeta();
