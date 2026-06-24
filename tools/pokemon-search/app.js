'use strict';
/* global document */

const $ = id => document.getElementById(id);

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

function renderResults(body, targetSpeed) {
	const table = $('results');
	const tbody = table.querySelector('tbody');
	tbody.innerHTML = '';
	$('fit-col').textContent = targetSpeed ? `${targetSpeed}?` : 'Spe';
	for (const r of body.results) {
		const tr = document.createElement('tr');
		const range = `${r.speRange.min0iv}–${r.speRange.max}`;
		let fit = '';
		if (targetSpeed) {
			const floor = document.querySelector('input[name=floor]:checked').value === '31iv' ? r.speRange.min31iv : r.speRange.min0iv;
			const ok = targetSpeed >= floor && targetSpeed <= r.speRange.max;
			fit = `<span class="${ok ? 'yes' : 'no'}">${ok ? 'yes' : 'no'}</span>`;
		}
		tr.innerHTML = `<td>${r.name}</td><td>${r.types.join(' / ')}</td><td>${r.baseSpe}</td><td>${range}</td><td>${fit}</td>`;
		tbody.appendChild(tr);
	}
	table.hidden = body.results.length === 0;
	$('status').textContent = body.count ? `${body.count} match${body.count === 1 ? '' : 'es'}` : 'No matches';
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
	const speed = $('speed').value;
	if (speed) params.set('speed', speed);
	params.set('floor', document.querySelector('input[name=floor]:checked').value);

	$('status').textContent = 'Searching…';
	const body = await (await fetch(`/api/search?${params}`)).json();
	renderResults(body, speed ? Number(speed) : null);
}

$('gen').addEventListener('change', loadMeta);
$('format').addEventListener('change', loadMeta);
$('search-form').addEventListener('submit', runSearch);
loadMeta();
