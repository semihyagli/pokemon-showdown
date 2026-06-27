import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { Dex } from '../../sim/dex';
import { CATEGORY_KEYS, getMeta, search, type SearchCriteria } from './engine';

const STATIC_DIR = path.resolve(__dirname, '../../../tools/pokemon-search');
const STATIC_FILES: { [k: string]: string } = {
	'/': 'index.html',
	'/index.html': 'index.html',
	'/app.js': 'app.js',
	'/style.css': 'style.css',
};
const CONTENT_TYPES: { [k: string]: string } = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
};

function parseGen(raw: string | null): number {
	const gen = Number(raw);
	if (!Number.isInteger(gen) || gen < 1 || gen > Dex.gen) {
		throw new Error(`Invalid generation: ${raw}`);
	}
	return gen;
}

function handleMeta(params: URLSearchParams) {
	const gen = parseGen(params.get('gen'));
	const formatId = params.get('format') || undefined;
	return getMeta(gen, formatId);
}

function handleSearch(params: URLSearchParams) {
	const gen = parseGen(params.get('gen'));
	const moves = (params.get('moves') ?? '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 4);
	const types = (params.get('types') ?? '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 2);
	const speedRaw = params.get('speed');
	const speed = speedRaw !== null && speedRaw !== '' ? Number(speedRaw) : undefined;
	const categories: NonNullable<SearchCriteria['categories']> = {};
	for (const key of CATEGORY_KEYS) {
		const v = params.get(key);
		if (v === 'only' || v === 'exclude') categories[key] = v;
	}
	const criteria: SearchCriteria = {
		gen,
		formatId: params.get('format') || undefined,
		species: params.get('species') || undefined,
		ability: params.get('ability') || undefined,
		moves: moves.length ? moves : undefined,
		types: types.length ? types : undefined,
		speed: speed !== undefined && !Number.isNaN(speed) ? speed : undefined,
		floor: params.get('floor') === '31iv' ? '31iv' : '0iv',
		resistStab: params.get('resiststab') || undefined,
		resistStabMode: params.get('resiststabmode') === 'resistneutral' ? 'resistneutral' : 'resist',
		superStab: params.get('superstab') || undefined,
		superStabMode: params.get('superstabmode') === 'seneutral' ? 'seneutral' : 'se',
		excludeUnevolved: params.get('excludeunevolved') === '1',
		categories,
	};
	const results = search(criteria);
	return { count: results.length, results };
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
	res.end(JSON.stringify(body));
}

export function startServer(port = 8080): http.Server {
	// `Dex.gen` is 0 until base data loads; load it now so parseGen accepts the
	// latest generation on the very first request of a fresh process.
	Dex.includeData();
	const server = http.createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://localhost');
		try {
			if (url.pathname === '/api/meta') {
				sendJson(res, 200, handleMeta(url.searchParams));
				return;
			}
			if (url.pathname === '/api/search') {
				sendJson(res, 200, handleSearch(url.searchParams));
				return;
			}
			const file = STATIC_FILES[url.pathname];
			if (file) {
				const full = path.join(STATIC_DIR, file);
				const ext = path.extname(full);
				res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] ?? 'text/plain' });
				res.end(fs.readFileSync(full));
				return;
			}
			res.writeHead(404, { 'Content-Type': 'text/plain' });
			res.end('Not found');
		} catch (err) {
			sendJson(res, 400, { error: (err as Error).message });
		}
	});
	if (port) {
		server.listen(port, () => console.log(`Advanced Pokémon Search UI: http://localhost:${port}`));
	}
	return server;
}
