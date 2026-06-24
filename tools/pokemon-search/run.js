'use strict';

const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');

// Pokémon Showdown runs from compiled dist/, so ensure it is built (incremental,
// so this is fast after the first run). Mirrors the ./pokemon-showdown launcher.
execSync('node build', { cwd: ROOT, stdio: 'inherit' });

const { startServer } = require(path.join(ROOT, 'dist/tools/pokemon-search/server.js'));
const port = Number(process.env.PORT) || 8080;
startServer(port);
