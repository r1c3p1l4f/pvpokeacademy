/*
* Every format on the Academy menu (open leagues and each cup with ranking data): the quiz must load it, build a pool,
* generate questions in every category without errors, and, for Mega Pokemon with a third Charged Move, equip all three
* moves in the swap simulations (the pool and the sims must agree on the loadout).
*
*   SITE_URL=... PLAYWRIGHT_PATH=... CHROME_PATH=... node tests/academy/cups-check.mjs
*/
import { createRequire } from 'module';
import assert from 'node:assert/strict';

const require = createRequire(process.env.PLAYWRIGHT_PATH || '/node-tools/node_modules/');
const { chromium } = require('playwright');
const SITE = process.env.SITE_URL || 'http://127.0.0.1:8080/pvpoke/src/';
const QUESTIONS = parseInt(process.env.QUESTIONS || '60', 10);

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
// 404s are expected from the menu's existence probes (cups with no ranking file) and aborted external requests
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|bad HTTP response/.test(m.text())) errors.push('console: ' + m.text()); });
await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());
await page.goto(SITE + 'academy/', { waitUntil: 'load' });
await page.waitForSelector('.academy-card:not(.hide)', { timeout: 30000 });

const formats = await page.evaluate(() => $('.academy-league option').map((i, o) => ({ value: o.value, label: $(o).text() })).get());
console.log(`formats on the menu: ${formats.length}`);
assert.ok(formats.length > 3, 'expected cups beyond the three open leagues');

const rows = [];

for (const f of formats) {
	const r = await page.evaluate(async ([f, QUESTIONS]) => {
		const gm = GameMaster.getInstance();
		const [cpStr, cup] = f.value.split('|');
		const cp = parseInt(cpStr, 10);
		const data = await new Promise(res => gm.loadRankingData({ displayRankingData: res }, 'overall', cp, cup));
		const pool = QuizEngine.buildPool(gm.data, data, 70);

		SwapScenarios.init({ pool, cp, cup });

		const megas = pool.filter(p => p.mega);
		const three = pool.filter(p => p.charged.length >= 3);
		const loadoutBad = [];

		for (const entry of three) {
			const poke = SwapScenarios.createPokemon(entry);
			const ids = poke.chargedMoves.map(m => m && m.moveId);
			if (ids.length !== 3 || entry.charged.some((m, i) => ids[i] !== m.id)) loadoutBad.push(entry.id + ' ' + JSON.stringify(ids));
		}

		// Every category, with the swap sims running on this cup
		const rng = QuizEngine.createRng(12345);
		const types = {};
		const failures = [];
		let swapWithMega = 0;

		for (let i = 0; i < QUESTIONS; i++) {
			try {
				const q = QuizEngine.generate(rng, pool, { categories: Object.keys(QuizEngine.CATEGORIES), level: 1 + (i % 3) });
				types[q.type] = (types[q.type] || 0) + 1;
				if (q.type.indexOf('swap') === 0 && q.params && JSON.stringify(q.params).match(/_mega|_primal/)) swapWithMega++;
			} catch (e) {
				failures.push(String(e && e.message || e).slice(0, 120));
			}
		}

		return { poolSize: pool.length, megas: megas.length, three: three.length, loadoutBad, types: Object.keys(types).length, swap: types['swap.stayOrSwap'] || 0, swapWithMega, failures: failures.slice(0, 3), failureCount: failures.length };
	}, [f, QUESTIONS]);

	rows.push({ ...f, ...r });
}

// The real UI path for a few formats: pick it from the menu and page through flashcards
const uiFormats = formats.filter((f, i) => i === 0 || /mega|little/i.test(f.value)).slice(0, 4);

for (const f of uiFormats) {
	await page.selectOption('.academy-league', f.value);
	await page.waitForSelector('.academy-card:not(.hide)', { timeout: 30000 });
	await page.click('.academy-modes a[data-mode="flashcards"]');
	for (let i = 0; i < 6; i++) {
		await page.waitForSelector('.reveal-btn:visible', { timeout: 15000 });
		const q = await page.evaluate(() => InterfaceMaster.getInstance().getQuestion());
		assert.ok(q && q.type, `no question for ${f.label}`);
		await page.click('.reveal-btn');
		await page.click('.gotit-btn');
	}
}

await browser.close();

for (const r of rows) {
	console.log(`${r.label.padEnd(44)} pool ${String(r.poolSize).padStart(3)}  megas ${String(r.megas).padStart(2)}  3-move ${String(r.three).padStart(2)}  swap q ${String(r.swap).padStart(2)} (${r.swapWithMega} w/ mega)  types ${r.types}  fails ${r.failureCount}`);
	r.failures.forEach(f => console.log('    ' + f));
	r.loadoutBad.forEach(f => console.log('    LOADOUT ' + f));
}

assert.equal(rows.filter(r => r.failureCount || r.loadoutBad.length || r.poolSize < 20).length, 0, 'a format failed');
assert.ok(rows.some(r => r.three > 0), 'no format exercised a three-move Mega');
assert.equal(errors.length, 0, errors.join(' | '));
console.log('Cup checks passed');
