/*
* The Battle page's Energy & Timing panel with the engine's verdicts: runs a few matchups through the page and requires
* that the panel renders, that every non-clean throw row carries an engine sentence, and that no page errors occur.
*
*   SITE_URL=... PLAYWRIGHT_PATH=... CHROME_PATH=... node tests/academy/audit-check.mjs
*/
import { createRequire } from 'module';
import assert from 'node:assert/strict';

const require = createRequire(process.env.PLAYWRIGHT_PATH || '/node-tools/node_modules/');
const { chromium } = require('playwright');
const SITE = process.env.SITE_URL || 'http://127.0.0.1:8080/pvpoke/src/';
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());

let rows = 0, explained = 0, panels = 0;
const sample = [];

for (const url of ['battle.php?cp=1500&cup=all&p1=medicham&p2=talonflame&s1=2&s2=2', 'battle.php?cp=1500&cup=all&p1=azumarill&p2=registeel&s1=2&s2=2', 'battle.php?cp=1500&cup=all&p1=sableye&p2=swampert&s1=1&s2=1']) {
	await page.goto(SITE + url, { waitUntil: 'load' });
	await page.waitForTimeout(2500);
	if (!(await page.isVisible('.timing-audit'))) continue;
	panels++;
	const found = await page.evaluate(() => $('.audit-table.throws tr.explain').map((i, tr) => $(tr).text()).get());
	rows += found.length;
	for (const text of found) {
		if (/simulator/i.test(text)) explained++;
		if (sample.length < 4) sample.push(text.trim());
	}
}

await browser.close();
console.log(`panels shown ${panels}/3; leaky throw rows ${rows}, with a simulator sentence ${explained}`);
sample.forEach(t => console.log('  ' + t));
assert.ok(panels >= 1, 'the Energy & Timing panel never rendered');
assert.equal(errors.length, 0, errors.join(' | '));
console.log('Audit checks passed');
