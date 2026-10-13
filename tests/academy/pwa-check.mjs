/*
* The installable, offline-capable Academy.
*
* Starts its own PHP servers (needs `php` on the PATH): one with PWA_ENABLED=1 and a pinned SITE_VERSION_OVERRIDE, and one
* with the defaults. "Offline" means the PWA server is actually stopped, because Playwright's offline mode does not reach
* requests the service worker makes itself. Checks:
*   - installability and manifest resolution (via the browser's own checks)
*   - the worker takes control, and a new version replaces the old worker and deletes the old caches
*   - after a warm online visit, an offline reload renders a question with no errors
*   - offline, a format that was never opened recovers instead of hanging
*   - with the flag off, none of it reaches the page
*
*   PWA_URL=... OFF_URL=... PLAYWRIGHT_PATH=... CHROME_PATH=... node tests/academy/pwa-check.mjs
*/
import { createRequire } from 'module';
import assert from 'node:assert/strict';

const require = createRequire(process.env.PLAYWRIGHT_PATH || '/node-tools/node_modules/');
const { chromium } = require('playwright');
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-check-'));
fs.symlinkSync(repo, path.join(docroot, 'pvpoke')); // the site expects to live under /pvpoke/src/
const PWA_PORT = 18081, OFF_PORT = 18080;
const PWA = `http://127.0.0.1:${PWA_PORT}/pvpoke/src/`;
const OFF = `http://127.0.0.1:${OFF_PORT}/pvpoke/src/`;
const servers = {};

async function startServer(port, env) {
	const child = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', docroot], { env: { ...process.env, PHP_CLI_SERVER_WORKERS: '4', ...env }, stdio: 'ignore' });
	servers[port] = child;
	for (let i = 0; i < 50; i++) {
		try { const r = await fetch(`http://127.0.0.1:${port}/pvpoke/src/academy/`); if (r.ok) return; } catch (e) { /* not up yet */ }
		await new Promise(r => setTimeout(r, 100));
	}
	throw new Error('PHP server did not start on ' + port);
}

async function stopServer(port) {
	const child = servers[port];
	if (!child) return;
	await new Promise(res => { child.once('exit', res); child.kill(); });
	delete servers[port];
}

process.on('exit', () => Object.values(servers).forEach(c => c.kill()));

await startServer(PWA_PORT, { PWA_ENABLED: '1', SITE_VERSION_OVERRIDE: 'pwa-test-1' });
await startServer(OFF_PORT, {});

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const context = await browser.newContext();
async function setOffline(value) {
	if (value) {
		await stopServer(PWA_PORT);
	} else {
		await startServer(PWA_PORT, { PWA_ENABLED: '1', SITE_VERSION_OVERRIDE: 'pwa-test-1' });
	}
}
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());

async function ready() {
	await page.waitForSelector('.academy-card:not(.hide)', { timeout: 30000 });
	await page.waitForFunction(() => InterfaceMaster.getInstance().getQuestion() !== null);
}

// ---- Installability and manifest ----
await page.goto(PWA + 'academy/', { waitUntil: 'load' });
await ready();
const cdp = await context.newCDPSession(page);
await cdp.send('Page.enable');
const installErrors = (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors;
assert.deepEqual(installErrors, [], 'installability errors: ' + JSON.stringify(installErrors));

const { url: manifestUrl, data, errors: manifestErrors } = await cdp.send('Page.getAppManifest');
assert.deepEqual(manifestErrors, [], 'manifest errors: ' + JSON.stringify(manifestErrors));
const manifest = JSON.parse(data);
assert.equal(new URL(manifest.start_url, manifestUrl).href, PWA + 'academy/');
assert.equal(new URL(manifest.scope, manifestUrl).href, PWA);
assert.equal(new URL(manifest.id, manifestUrl).href, PWA + 'academy/');
// What Chrome itself computes for the app id (stable across versions; that is what identifies the install)
const appIdResult = await cdp.send('Page.getAppId');
console.log('Chrome app id: ' + JSON.stringify(appIdResult));
// This headless Chromium returns nothing for the app id, so it is reported but not asserted; the id is resolved against the manifest above
assert.equal(manifest.name, 'PvP Academy');
for (const icon of manifest.icons) {
	const res = await page.request.get(new URL(icon.src, manifestUrl).href);
	assert.equal(res.status(), 200, icon.src);
	assert.equal(res.headers()['content-type'], 'image/png');
}
assert.ok(manifest.icons.some(i => i.purpose === 'maskable'));
const touch = await page.request.get(PWA + 'img/academy/apple-touch-icon.png');
assert.equal(touch.status(), 200);
console.log('installable: no errors; start_url, scope and id resolve under ' + PWA);

// ---- The worker takes control ----
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload({ waitUntil: 'load' });
await ready();
assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'worker is not controlling the page after a reload');
const scriptUrl = await page.evaluate(() => navigator.serviceWorker.controller.scriptURL);
assert.equal(scriptUrl, PWA + 'service-worker.js?v=pwa-test-1');
console.log('worker controls the page: ' + scriptUrl);

// ---- Warm a second format online, then go offline ----
const formats = await page.evaluate(() => $('.academy-league option').map((i, o) => o.value).get());
// Any two cup formats will do (picked from the menu, so a data refresh changes the picks, not the test)
const cupFormats = formats.filter(v => v !== '1500|all' && v.startsWith('1500|'));
assert.ok(cupFormats.length >= 2, 'need two 1500 CP cups on the menu');
const warm = cupFormats[0];
const warmLabel = await page.evaluate(v => $(".academy-league option[value='" + v + "']").text(), warm);
await page.selectOption('.academy-league', warm);
await page.waitForFunction(v => JSON.parse(localStorage.getItem('academy.settings')).format === v, warm);
await page.waitForTimeout(2500);
await page.selectOption('.academy-league', '1500|all');
await page.waitForTimeout(1500);
await page.reload({ waitUntil: 'load' });
await ready();

await setOffline(true);
await page.reload({ waitUntil: 'load' });
await ready();
const heading = await page.textContent('h1');
assert.equal(heading.trim(), 'Academy');
const offlineQuestion = await page.evaluate(() => InterfaceMaster.getInstance().getQuestion().type);
console.log('offline reload rendered a question: ' + offlineQuestion);

// The format that was warmed works offline too
await page.selectOption('.academy-league', warm);
await page.waitForFunction(v => JSON.parse(localStorage.getItem('academy.settings')).format === v, warm);
await page.waitForTimeout(1500);
assert.ok(await page.isHidden('.academy-load-error'), 'a format opened online should load offline');

// A format that was never opened cannot load offline: it must recover, not hang
const cold = cupFormats[1];
assert.ok(cold, 'no cold format to try');
await page.selectOption('.academy-league', cold);
await page.waitForSelector('.academy-load-error:not(.hide)', { timeout: 15000 });
const message = await page.textContent('.academy-load-error');
assert.ok(message.startsWith("Couldn't load") && message.includes('Showing ' + warmLabel + ' instead'), message);
assert.equal(await page.inputValue('.academy-league'), warm, 'menu should go back to the last format that loaded');
assert.ok(await page.evaluate(() => InterfaceMaster.getInstance().getQuestion() !== null), 'the previous format should still be playable');
console.log('uncached format offline: ' + message);
await setOffline(false);

// ---- A new version replaces the old worker and its caches ----
const before = await page.evaluate(() => caches.keys());
assert.ok(before.some(k => k.endsWith('pwa-test-1')), 'expected caches for version 1: ' + before);
await page.evaluate(async (url) => {
	const reg = await navigator.serviceWorker.register(url, { scope: new URL('./', url).href });
	await new Promise(res => {
		if (reg.active && reg.active.scriptURL === url) return res();
		const w = reg.installing || reg.waiting;
		w.addEventListener('statechange', () => { if (w.state === 'activated') res(); });
	});
}, PWA + 'service-worker.js?v=pwa-test-2');
await page.waitForFunction(async () => (await caches.keys()).every(k => !k.endsWith('pwa-test-1')), null, { timeout: 15000 });
// The new worker caches under its own name
await page.evaluate(() => fetch(webRoot + 'data/gamemaster.min.json?v=pwa-test-2').then(r => r.arrayBuffer()));
await page.waitForFunction(async () => (await caches.keys()).includes('assets-pwa-test-2'), null, { timeout: 10000 });
const after = await page.evaluate(() => caches.keys());
assert.ok(after.length > 0 && after.every(k => k.endsWith('pwa-test-2')), 'old caches should be gone: ' + after);
console.log('version bump: old worker replaced, caches now ' + JSON.stringify(after));

// ---- Flag off: nothing reaches the page ----
const plain = await browser.newContext();
const offPage = await plain.newPage();
const offErrors = [];
offPage.on('pageerror', e => offErrors.push(e.message));
await offPage.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());
await offPage.goto(OFF + 'academy/', { waitUntil: 'load' });
await offPage.waitForTimeout(2500);
const off = await offPage.evaluate(async () => ({
	manifest: document.querySelector('link[rel=manifest]').getAttribute('href'),
	touch: !!document.querySelector('link[rel=apple-touch-icon]'),
	install: document.querySelectorAll('.academy-install').length,
	workers: (await navigator.serviceWorker.getRegistrations()).length
}));
assert.match(off.manifest, /data\/manifest\.json\?v=3$/);
assert.equal(off.touch, false);
assert.equal(off.install, 0);
assert.equal(off.workers, 0);
assert.deepEqual(offErrors, []);

// Upstream's own registration reaches the (now filled-in) worker file from the home and battle pages without a version.
// It must stay inert there: no caches, no handlers, whatever it does with the page.
for (const url of [OFF, OFF + 'battle.php', OFF + 'train/']) {
	await offPage.goto(url, { waitUntil: 'load' });
	await offPage.waitForTimeout(1500);
	await offPage.reload({ waitUntil: 'load' });
	await offPage.waitForTimeout(1500);
	const state = await offPage.evaluate(async () => ({ caches: await caches.keys(), scripts: (await navigator.serviceWorker.getRegistrations()).map(r => (r.active || r.installing || r.waiting || {}).scriptURL) }));
	assert.deepEqual(state.caches, [], `${url}: the flag-off worker must not create caches`);
	state.scripts.forEach(s => assert.ok(!/\?v=/.test(s || ''), `${url}: flag-off registration should be the unversioned upstream one`));
}
console.log('flag off: ' + JSON.stringify(off) + '; home, battle and train register no caching');

await browser.close();
await stopServer(PWA_PORT);
await stopServer(OFF_PORT);
fs.rmSync(docroot, { recursive: true, force: true });
assert.deepEqual(errors, [], errors.join(' | '));
console.log('PWA checks passed');
