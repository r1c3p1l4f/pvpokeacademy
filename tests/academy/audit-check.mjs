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

let panels = 0;

// AI-vs-AI battles throw where the engine would throw, so they give no explanation rows (and must not error).
for (const url of ['battle.php?cp=1500&cup=all&p1=azumarill&p2=registeel&s=22', 'battle.php?cp=1500&cup=all&p1=sableye&p2=swampert&s=11']) {
	await page.goto(SITE + url, { waitUntil: 'load' });
	await page.waitForTimeout(2500);
	if (await page.isVisible('.timing-audit')) panels++;
}

// Sandbox: Medicham starts with 50 energy and throws Ice Punch on turn 3 while Talonflame is mid Fast Move.
// That throw leaks a free turn, and the engine (move timing on) would have held, so both must be on screen.
await page.goto(SITE + 'battle.php?cp=1500&cup=all&p1=medicham&p2=talonflame&s=22&e=50-0&sandbox=1&a=3.10000', { waitUntil: 'load' });
await page.waitForTimeout(3500);
const rows = await page.evaluate(() => $('.audit-table.throws tr.explain').map((i, tr) => $(tr).text().replace(/\s+/g, ' ').trim()).get());
const headline = await page.evaluate(() => $('.audit-headline').text());
await browser.close();
console.log(`AI battles with a panel: ${panels}/2`);
console.log('sandbox headline: ' + headline);
rows.forEach(t => console.log('  ' + t));
assert.equal(panels, 2, 'the Energy & Timing panel did not render for AI battles');
assert.equal(rows.length, 1, 'expected one explanation row for the sandbox throw');
assert.match(rows[0], /free turn/);
assert.match(rows[0], /The simulator would have held here\./);
assert.match(rows[0], /after 1 more tap/);
assert.equal(errors.length, 0, errors.join(' | '));
console.log('Audit checks passed');
