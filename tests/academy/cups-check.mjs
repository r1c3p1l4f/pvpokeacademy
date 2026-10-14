/*
* Every format on the Academy menu (open leagues and each cup with ranking data): the quiz must load it, build a pool,
* generate questions in every category without errors, and, for Mega Pokemon with a third Charged Move, equip all three
* moves in the swap simulations (the pool and the sims must agree on the loadout).
*
*   SITE_URL=... PLAYWRIGHT_PATH=... CHROME_PATH=... node tests/academy/cups-check.mjs
*/
import { createRequire } from 'module';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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
		const info = InterfaceMaster.getInstance().getFormatInfo()[f.value] || {};
		const pool = QuizEngine.buildPool(gm.data, data, 70, { exclude: info.exclude });

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

		const bannedPresent = (info.exclude || []).length ? pool.filter(p => info.exclude.some(x => x.filterType === 'id' && x.values.includes(p.id))).map(p => p.id) : [];
		const cupData = gm.getCupById(cup);
		// Team rules the quiz does not model: a cup with any of these would make swap questions show illegal teams
		const KNOWN = ['name', 'title', 'include', 'exclude', 'partySize', 'levelCap', 'presetOnly', 'excludeLowPokemon', 'rankingAlias', 'league', 'link', 'overrides', 'useDefaultMovesets'];
		const unknownRules = Object.keys(cupData || {}).filter(k => !KNOWN.includes(k));

		// No team may repeat a Pokemon in any form (Shadow and regular, Kanto and Alolan, Mega and base), and the opponent is a
		// different Pokemon from all of them. Pokedex number identifies every form of one Pokemon.
		const sameSpecies = [];
		const swapRng = QuizEngine.createRng(777);
		for (let i = 0; i < 25; i++) {
			const q = QuizEngine.generate(swapRng, pool, { categories: ['swap'], level: 1 + (i % 3) });
			const ids = [...q.params.team, q.params.opp];
			const dexes = ids.map(id => pool.byId[id].dex);
			if (dexes.some(d => d === undefined)) sameSpecies.push('no dex for ' + ids.join(','));
			else if (new Set(dexes).size !== ids.length) sameSpecies.push(ids.join(' / '));
		}

		return { sameSpecies, cp, borrowed: !!(info.exclude && info.exclude.length), bannedPresent, unknownRules, poolSize: pool.length, megas: megas.length, three: three.length, loadoutBad, types: Object.keys(types).length, swap: types['swap.stayOrSwap'] || 0, swapWithMega, failures: failures.slice(0, 3), failureCount: failures.length };
	}, [f, QUESTIONS]);

	rows.push({ ...f, ...r });
}

// The real UI path: pick formats from the menu and page through flashcards. Which ones is derived from what the data has
// (a 500 CP cup, a cup with Megas, a cup that borrows another's ranking), so a data refresh changes the picks, not the test.
// Each pick must actually load that format's pool: the question's Pokemon have to be in the new ranking, not left over.
const pick = (pred) => rows.find(pred);
const uiFormats = [rows[0], pick(r => r.cp === 500), pick(r => r.megas > 0), pick(r => r.borrowed)].filter((r, i, all) => r && all.indexOf(r) === i).map(r => ({ value: r.value, label: r.label }));
assert.ok(uiFormats.length >= 2, 'expected the UI phase to cover more than one format');

for (const f of uiFormats) {
	await page.selectOption('.academy-league', f.value);
	await page.waitForFunction(v => localStorage.getItem('academy.settings') && JSON.parse(localStorage.getItem('academy.settings')).format === v, f.value);
	await page.waitForTimeout(1500);
	await page.click('.academy-modes a[data-mode="flashcards"]');

	for (let i = 0; i < 6; i++) {
		await page.waitForSelector('.reveal-btn:visible', { timeout: 15000 });
		const q = await page.evaluate(() => InterfaceMaster.getInstance().getQuestion());
		assert.ok(q && q.type, `no question for ${f.label}`);

		const outsiders = await page.evaluate(async ([value, params]) => {
			const gm = GameMaster.getInstance();
			const [cp, cup] = value.split('|');
			const data = await new Promise(res => gm.loadRankingData({ displayRankingData: res }, 'overall', parseInt(cp, 10), cup));
			const ids = new Set(data.map(r => r.speciesId));
			const used = JSON.stringify(params).match(/"([a-z0-9_]+)"/g) || [];
			return used.map(x => x.replace(/"/g, '')).filter(x => gm.getPokemonById(x) && !ids.has(x));
		}, [f.value, q.params]);

		assert.equal(outsiders.length, 0, `${f.label}: question uses Pokemon outside this format's ranking: ${outsiders}`);
		await page.click('.reveal-btn');
		await page.click('.gotit-btn');
	}
}

await browser.close();

for (const r of rows) {
	console.log(`${r.label.padEnd(44)} pool ${String(r.poolSize).padStart(3)}  megas ${String(r.megas).padStart(2)}  3-move ${String(r.three).padStart(2)}  swap q ${String(r.swap).padStart(2)} (${r.swapWithMega} w/ mega)  types ${r.types}  fails ${r.failureCount}${r.bannedPresent.length ? ' BANNED ' + r.bannedPresent : ''}${r.unknownRules.length ? ' RULES ' + r.unknownRules : ''}${r.sameSpecies.length ? ' SAME-SPECIES ' + r.sameSpecies.slice(0, 2).join(' | ') : ''}`);
	r.failures.forEach(f => console.log('    ' + f));
	r.loadoutBad.forEach(f => console.log('    LOADOUT ' + f));
}

assert.equal(rows.filter(r => r.failureCount || r.loadoutBad.length || r.poolSize < 20 || r.bannedPresent.length || r.unknownRules.length || r.sameSpecies.length).length, 0, 'a format failed');
// Whether the menu offers what the data says it should, derived from the gamemaster and the ranking directory rather than
// from names: every cup that has a ranking file, and every cup that borrows another's ranking and adds bans of a kind the
// quiz can apply.
const gmData = JSON.parse(fs.readFileSync(path.join(repo, 'src/data/gamemaster.json'), 'utf8'));
const cupByName = Object.fromEntries(gmData.cups.map(c => [c.name, c]));
const onMenu = new Set(rows.map(r => r.value.split('|')[1]));
const rankingDirs = fs.readdirSync(path.join(repo, 'src/data/rankings'));
const missingFromMenu = rankingDirs.filter(d => d !== 'all' && cupByName[d] && !onMenu.has(d));
assert.deepEqual(missingFromMenu, [], 'cups with ranking data are missing from the menu: ' + missingFromMenu);

const extraBans = c => (c.exclude || []).filter(f => !((cupByName[c.rankingAlias] || {}).exclude || []).some(b => b.filterType === f.filterType && b.values.join() === f.values.join()));
const borrowingMissing = gmData.cups.filter(c => c.rankingAlias && extraBans(c).length && extraBans(c).every(f => ['id', 'tag', 'type'].includes(f.filterType)) && !onMenu.has(c.name)).map(c => c.name);
assert.deepEqual(borrowingMissing, [], 'borrowed-ranking cups with their own bans are missing from the menu: ' + borrowingMissing);
assert.ok(rows.filter(r => r.borrowed).every(r => r.bannedPresent.length === 0), 'a banned Pokemon is in a borrowed-ranking pool');
assert.ok(rows.some(r => r.three > 0), 'no format exercised a three-move Mega');
assert.equal(errors.length, 0, errors.join(' | '));
console.log('Cup checks passed');
