/*
* The site as it will be deployed: files copied with deploy-excludes.txt, served from the root of a domain with a
* config.local.php ($WEB_ROOT '/', PWA on, no database), the way a SiteGround upload looks. Checks:
*   - developer and write endpoints are not there (data/write.php answers 404)
*   - the Academy boots by itself. (Locally the developer panel, which only shows when $WEB_ROOT contains "src", started it,
*     which hid a page that never loaded on a real server.)
*   - the Battle page's audit panel, the Train setup and its Coach select render
*   - Train's results endpoint answers cleanly when the database is off
*   - the manifest, icons and worker resolve from the root
*
*   PLAYWRIGHT_PATH=... CHROME_PATH=... node tests/academy/deploy-check.mjs      (needs php and rsync on the PATH)
*/
import { createRequire } from 'module';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(process.env.PLAYWRIGHT_PATH || '/node-tools/node_modules/');
const { chromium } = require('playwright');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const site = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-check-'));

execFileSync('rsync', ['-a', `--exclude-from=${path.join(repo, 'scripts/academy/deploy-excludes.txt')}`, path.join(repo, 'src') + '/', site + '/']);
fs.writeFileSync(path.join(site, 'modules/config.local.php'), "<?php\n$WEB_ROOT = '/';\n$PWA_ENABLED = true;\n$TRAINING_DB_ENABLED = false;\n");

const PORT = 18097;
const BASE = `http://127.0.0.1:${PORT}/`;
const server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', site], { env: { ...process.env, PHP_CLI_SERVER_WORKERS: '6' }, stdio: 'ignore' });
const cleanup = () => { server.kill(); fs.rmSync(site, { recursive: true, force: true }); };
process.on('exit', cleanup);

for (let i = 0; i < 60; i++) {
	try { if ((await fetch(BASE)).ok) break; } catch (e) { /* not up yet */ }
	await new Promise(r => setTimeout(r, 100));
}

// Files that must not be there
for (const gone of ['data/write.php', 'data/compile.php', 'ranker.php', 'rankersandbox.php', 'data/training/getTraining.php']) {
	assert.equal((await fetch(BASE + gone)).status, 404, gone + ' should not be deployed');
}
assert.equal(fs.existsSync(path.join(site, '.htaccess')), true, '.htaccess must be deployed');

// The results endpoint with the database off
const res = await fetch(BASE + 'data/training/postTraining.php', { method: 'POST', headers: { Origin: BASE.replace(/\/$/, '') }, body: new URLSearchParams({ 'pokemon[0][pokemonId]': 'a', 'teams[0][teamStr]': 'a' }) });
assert.equal(res.status, 200);

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());

// The Academy starts by itself
await page.goto(BASE + 'academy/', { waitUntil: 'load' });
await page.waitForSelector('.academy-card:not(.hide)', { timeout: 30000 });
assert.ok(await page.evaluate(() => InterfaceMaster.getInstance().getQuestion() !== null), 'the Academy did not produce a question');
assert.ok(await page.evaluate(() => $('.academy-league option').length) > 3, 'the format menu was not built');

// PWA pieces from the root
const manifest = await (await fetch(BASE + 'academy/manifest.json')).json();
assert.equal(new URL(manifest.start_url, BASE + 'academy/manifest.json').href, BASE + 'academy/');
assert.equal(new URL(manifest.scope, BASE + 'academy/manifest.json').href, BASE);
for (const icon of manifest.icons) assert.equal((await fetch(new URL(icon.src, BASE + 'academy/manifest.json'))).status, 200, icon.src);
await page.evaluate(() => navigator.serviceWorker.ready);
assert.match(await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.active.scriptURL)), /\/service-worker\.js\?v=/);

// Battle page audit panel and Train setup
await page.goto(BASE + 'battle.php?cp=1500&cup=all&p1=azumarill&p2=registeel&s=22', { waitUntil: 'load' });
await page.waitForSelector('.timing-audit', { state: 'visible', timeout: 30000 });
await page.goto(BASE + 'train/', { waitUntil: 'load' });
await page.waitForFunction(() => $('.coach-select option').length > 0, null, { timeout: 30000 });

await browser.close();
cleanup();
assert.deepEqual(errors, [], errors.join(' | '));
console.log('Deploy checks passed');
