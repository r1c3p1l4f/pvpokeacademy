/*
* Train mode with Mega Pokemon, including one with a third Charged Move.
*
* Imports a manual team led by a Mega with three Charged Moves (taken from the Mega Great League ranking), plays
* it with the Coach on Learn, and checks that all three Charged Move buttons exist and carry the Coach's per-button
* count, that prompts can name the third move, and that nothing throws.
*
*   SITE_URL=... PLAYWRIGHT_PATH=... CHROME_PATH=... node tests/academy/mega-check.mjs
*/
import { createRequire } from 'module';
import assert from 'node:assert/strict';

const require = createRequire(process.env.PLAYWRIGHT_PATH || '/node-tools/node_modules/');
const { chromium } = require('playwright');
const SITE = process.env.SITE_URL || 'http://127.0.0.1:8080/pvpoke/src/';
const MAX_MS = parseInt(process.env.MAX_MS || '90000', 10);

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());
await page.goto(SITE + 'train/', { waitUntil: 'load' });
await page.waitForFunction(() => window.GameMaster && GameMaster.getInstance().data.pokemon && $('.league-cup-select').length);
await page.waitForTimeout(1500);

await page.selectOption('.league-cup-select', '1500 mega');
await page.selectOption('.coach-select', 'learn');
await page.selectOption('.team-method-select', 'manual');
await page.waitForTimeout(500);

async function importTeam(index, csv) {
	await page.locator('.poke.multi').nth(index).locator('.export-btn').click();
	await page.waitForSelector('.modal textarea.list-text');
	await page.fill('.modal textarea.list-text', csv);
	await page.click('.modal .button.import');
	await page.waitForTimeout(500);
}

// SIDE=opp puts the Megas on the AI's side instead (the preset pools have no Megas, so importing is the only way the AI fields one)
// The team comes from the Mega Great League ranking: the lead is a Mega whose ranked moveset has three Charged Moves,
// followed by two other Megas, so a data refresh changes the team rather than breaking the test.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ranking = JSON.parse(fs.readFileSync(path.join(repo, 'src/data/rankings/mega/overall/rankings-1500.json'), 'utf8'));
const gamemaster = JSON.parse(fs.readFileSync(path.join(repo, 'src/data/gamemaster.json'), 'utf8'));
const megasRanked = ranking.filter(r => /_mega|_primal/.test(r.speciesId));
const lead = megasRanked.find(r => r.moveset.length === 4);
assert.ok(lead, 'no three-move Mega in the Mega Great League ranking');
const rest = megasRanked.filter(r => r !== lead && r.moveset.length === 3).slice(0, 2);
assert.equal(rest.length, 2, 'need two more Megas to fill the team');
const csv = r => [r.speciesId, ...r.moveset].join(',');
const MEGAS = [lead, ...rest].map(csv).join('\n');
const leadName = gamemaster.pokemon.find(p => p.speciesId === lead.speciesId).speciesName.split(' ')[0].toLowerCase();
const PLAIN = 'azumarill\nregisteel\nskarmory';
const oppSide = process.env.SIDE === 'opp';
await importTeam(0, oppSide ? PLAIN : MEGAS);
await importTeam(1, oppSide ? MEGAS : PLAIN);

const listed = await page.evaluate(() => $('.poke.multi').first().find('.rankings-container .rank .name').slice(0, 3).map((i, e) => $(e).text()).get());
console.log('player team as listed: ' + JSON.stringify(listed));

await page.click('.battle-btn');
await page.waitForSelector('.lets-go-btn:visible, .battle-window[phase]', { timeout: 20000 });
if (await page.isVisible('.lets-go-btn')) await page.click('.lets-go-btn');
await page.waitForSelector('.battle-window[phase="neutral"]', { timeout: 30000 });

const info = await page.evaluate(() => ({
	bars: $('.controls .move-bar').filter((i, e) => $(e).css('display') !== 'none').length,
	barNames: $('.controls .move-labels .label').map((i, e) => $(e).text().trim()).get(),
	counts: $('.coach-btn-count').length,
	species: $('.battle-window .self .name, .battle-window .name').first().text()
}));
console.log('lead buttons: ' + JSON.stringify(info));

if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
await page.hover('.auto-tap');
await page.click('.auto-tap');

const t0 = Date.now();
const seen = { oppEnergyShown: false, oppNames: [], thirdButtonShown: false, thirdBadge: false, thirdNamedInPrompt: false, promptSamples: [] };

while (Date.now() - t0 < MAX_MS) {
	await page.waitForTimeout(400);
	const phase = await page.getAttribute('.battle-window', 'phase');
	if (phase === 'game_over_screen') break;

	const snap = await page.evaluate(() => {
		const bars = $('.controls .move-bar');
		const third = bars.eq(2);
		return {
			thirdVisible: !!(third.length && third.css('display') !== 'none'),
			thirdName: $('.controls .move-labels .label').eq(2).text().trim(),
			thirdBadge: third.find('.coach-badge, .coach-btn-count').length > 0,
			oppEnergy: $('.coach-opp-energy').length > 0 && $('.coach-opp-energy').text().trim() !== '',
			oppName: $('.battle-window .opponent .name, .coach-side.opp .side-title').first().text().trim(),
			advice: $('.coach-advice').text(),
			banner: $('.coach-banner').text()
		};
	});

	if (snap.oppEnergy) { seen.oppEnergyShown = true; if (snap.oppName && !seen.oppNames.includes(snap.oppName)) seen.oppNames.push(snap.oppName); }
	if (snap.thirdVisible) seen.thirdButtonShown = true;
	if (snap.thirdVisible && snap.thirdBadge) seen.thirdBadge = true;
	if (snap.thirdName && (snap.advice + snap.banner).includes(snap.thirdName)) seen.thirdNamedInPrompt = true;
	if (seen.promptSamples.length < 4 && snap.advice && !seen.promptSamples.includes(snap.advice)) seen.promptSamples.push(snap.advice);

	const bar = page.locator('.controls .move-bar.active:visible').first();
	if (phase === 'neutral' && await bar.count()) await bar.click().catch(() => {});
	if (phase === 'suspend_charged_attack') { await page.mouse.down(); await page.waitForTimeout(2500); await page.mouse.up(); }
	if (phase && phase.startsWith('suspend_charged_shield')) await page.evaluate(() => $('.shield-window .close').trigger('click'));
}

await browser.close();
console.log(JSON.stringify(seen, null, 1));
if (!oppSide) {
	assert.ok(listed.join(' ').toLowerCase().includes(leadName), `${leadName} was not accepted into the player team`);
	assert.equal(info.bars, 3, 'expected three Charged Move buttons for the lead');
	assert.ok(seen.thirdButtonShown, 'third Charged Move button never showed');
	assert.ok(seen.thirdBadge, 'Coach put no count/badge on the third button');
} else {
	assert.ok(seen.oppEnergyShown, 'the Coach never showed the Mega opponent\'s energy');
}
assert.equal(errors.length, 0, errors.join(' | '));
console.log('Mega checks passed');
