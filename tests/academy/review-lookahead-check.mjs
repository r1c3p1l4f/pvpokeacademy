/*
* Checks the "it would have thrown after N more taps" claim in the throw review against a real forced re-run.
*
* Run A: a Pokemon plays with move timing optimization OFF, so it throws early. At its first Charged Move the review is
* asked, with timing optimization switched on for just that call, whether the engine would have held and for how many taps.
* Run B: the identical battle with timing optimization ON from the start. Nothing differs before that decision, so B's
* first Charged Move is where the engine really throws. The review's answer is correct if B throws the predicted number of
* Fast Moves after A did.
*
* Cases where the opponent throws a Charged Move inside the waiting window are counted apart: the lookahead ignores
* the opponent's Charged Moves by design (it only advances Fast Move state), so those are not misses.
*
*   SITE_URL=... PLAYWRIGHT_PATH=... CHROME_PATH=... node tests/academy/review-lookahead-check.mjs
*/
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(process.env.PLAYWRIGHT_PATH || '/node-tools/node_modules/');
const { chromium } = require('playwright');
const SITE = process.env.SITE_URL || 'http://127.0.0.1:8080/pvpoke/src/';
const PAIRS = parseInt(process.env.PAIRS || '600', 10);

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());
await page.goto(SITE + 'battle.php', { waitUntil: 'load' });
await page.waitForFunction(() => window.GameMaster && GameMaster.getInstance().data.pokemon && GameMaster.getInstance().pokemonMap);
await page.waitForTimeout(1500);
await page.addScriptTag({ path: path.join(here, '../../src/js/academy/EngineAdvisor.js') });

const result = await page.evaluate((PAIRS) => {
	const gm = GameMaster.getInstance();
	const ids = ['medicham', 'azumarill', 'registeel', 'skarmory', 'altaria', 'stunfisk_galarian', 'swampert', 'lanturn', 'venusaur',
		'talonflame', 'trevenant', 'sableye', 'mandibuzz', 'umbreon', 'bastiodon', 'giratina_altered', 'togekiss', 'whiscash',
		'cresselia', 'dewgong', 'jellicent', 'machamp', 'cradily', 'scrafty', 'clefable', 'ninetales_alolan', 'gligar', 'carbink',
		'hypno', 'wigglytuff', 'lickitung', 'galvantula', 'charjabug', 'obstagoon', 'diggersby', 'furret', 'froslass', 'corsola_galarian']
		.filter(id => gm.getPokemonById(id));
	let seed = 777;
	const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
	const shieldConfigs = [[2, 2], [1, 1], [0, 0], [2, 0], [0, 2]];

	function run(a, b, cp, sh, timing, observer) {
		const battle = new Battle();
		battle.setCP(cp);
		battle.setCup('all');
		const make = (id, i) => { const p = new Pokemon(id, i, battle); p.initialize(cp); p.autoSelectMoves(2); return p; };
		const p0 = make(a, 0), p1 = make(b, 1);
		p0.setShields(sh[0]); p1.setShields(sh[1]);
		p0.optimizeMoveTiming = timing;
		p0.farmEnergy = false;
		battle.setNewPokemon(p0, 0, false); battle.setNewPokemon(p1, 1, false);
		battle.setTrackThrows(true);
		if (observer) { battle.setThrowObserver(observer); }
		battle.simulate();
		return battle.getThrowLog();
	}

	const out = { cases: 0, held: 0, exact: 0, tooEarly: 0, tooLate: 0, beyond: 0, beyondOk: 0, interrupted: 0, notHeld: 0, notHeldThrewSame: 0, samples: [] };

	for (let n = 0; n < PAIRS; n++) {
		const a = ids[Math.floor(rnd() * ids.length)];
		const b = ids[Math.floor(rnd() * ids.length)];
		if (a === b) continue;
		const cp = [1500, 2500][Math.floor(rnd() * 2)];
		const sh = shieldConfigs[n % shieldConfigs.length];
		let verdict = null;

		const logA = run(a, b, cp, sh, false, (poke, opp, move, snap) => {
			if (poke.index !== 0 || verdict) { return null; }
			const saved = poke.optimizeMoveTiming;
			poke.optimizeMoveTiming = true;
			try { verdict = EngineAdvisor.review(poke, opp, move, snap); } finally { poke.optimizeMoveTiming = saved; }
			return null;
		});
		const firstA = logA.find(t => t.actor === 0);
		if (!firstA || !verdict || firstA.simultaneous) { continue; }

		const logB = run(a, b, cp, sh, true, null);
		const firstB = logB.find(t => t.actor === 0);
		out.cases++;

		if (verdict.action > -1) {
			out.notHeld++;
			if (firstB && firstB.turn === firstA.turn && firstB.moveIndex === firstA.moveIndex) { out.notHeldThrewSame++; }
			continue;
		}

		out.held++;
		const gap = firstB ? firstB.turn - firstA.turn : null;
		const oppThrowInside = logB.some(t => t.actor === 1 && firstB && t.turn >= firstA.turn && t.turn <= firstB.turn);

		if (!firstB) { continue; }
		if (oppThrowInside) { out.interrupted++; continue; }

		// A's first throw turn and B's, in units of this Pokemon's own Fast Moves
		const ft = (function () { const p = new Pokemon(a, 0, new Battle()); p.initialize(cp); p.autoSelectMoves(2); return p.fastMove.turns; })();
		const taps = gap / ft;

		if (verdict.waitTaps === null) {
			out.beyond++;
			if (taps > 2) { out.beyondOk++; }
			else if (out.samples.length < 8) { out.samples.push({ pair: `${a} vs ${b} @${cp} ${sh}`, turnA: firstA.turn, turnB: firstB.turn, predicted: null, taps, reasons: verdict.reasons.slice(0, 3) }); }
		} else if (taps === verdict.waitTaps) {
			out.exact++;
		} else {
			if (taps < verdict.waitTaps) { out.tooEarly++; } else { out.tooLate++; }
			if (out.samples.length < 8) { out.samples.push({ pair: `${a} vs ${b} @${cp} ${sh}`, turnA: firstA.turn, turnB: firstB.turn, predicted: verdict.waitTaps, taps, reasons: verdict.reasons.slice(0, 3) }); }
		}
	}

	return out;
}, PAIRS);

await browser.close();

const judged = result.exact + result.tooEarly + result.tooLate;
console.log(`pairs with a first throw to judge: ${result.cases}; the engine (timing on) would have thrown right there: ${result.notHeld} (${result.notHeldThrewSame} of those matched a real re-run); would have held: ${result.held}`);
console.log(`of the holds: opponent threw inside the window (not judged) ${result.interrupted}; predicted "beyond 2 taps": ${result.beyond}, re-run agreed ${result.beyondOk}; predicted 1-2 taps: ${judged}, exact ${result.exact}, too early ${result.tooEarly}, too late ${result.tooLate}`);
result.samples.forEach(s => console.log('  MISS ' + JSON.stringify(s)));
console.log(errors.length ? 'PAGE ERRORS: ' + errors.join(' | ') : 'no page errors');
const bad = result.tooEarly + result.tooLate + (result.beyond - result.beyondOk);
process.exit(errors.length || result.held === 0 || bad > 0 ? 1 : 0);
