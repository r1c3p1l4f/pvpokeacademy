/*
* Verifies TurnMath's timing model against the real Battle.js engine.
*
* For every pair of Fast Move durations (1-5 turns) and every throw opportunity, it forces a Charged
* Move in a sandbox battle and measures how much earlier the opponent's next tap comes than it would
* have without the throw. That must equal TurnMath.tempoShift(rho) = rho - 2, and the opponent
* cooldown recorded by Battle.getThrowLog() must equal the model's rho.
*
* Needs a running site and Playwright:
*   SITE_URL=http://127.0.0.1:8080/pvpoke/src/ PLAYWRIGHT_PATH=/path/to/node_modules/ \
*   CHROME_PATH=/path/to/chrome node tests/academy/engine-check.mjs
*/
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TM = createRequire(import.meta.url)(path.join(here, '../../src/js/academy/TurnMath.js'));
const require = createRequire(process.env.PLAYWRIGHT_PATH || '/node-tools/node_modules/');
const { chromium } = require('playwright');

const SITE = process.env.SITE_URL || 'http://127.0.0.1:8080/pvpoke/src/';
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage();
await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());
await page.goto(SITE + 'battle.php', { waitUntil: 'load' });
await page.waitForFunction(() => window.GameMaster && GameMaster.getInstance().data.pokemon && GameMaster.getInstance().pokemonMap);
await page.waitForTimeout(1500);

const FAST = { 1: 'BITE', 2: 'COUNTER', 3: 'BUBBLE', 4: 'CONFUSION', 5: 'INCINERATE' };

const results = await page.evaluate(({ FAST }) => {
	const out = [];
	const taps = (tl, actor) => tl.filter(e => e.actor === actor && e.type.indexOf('tap interaction') === 0 && e.name === 'Tap').map(e => e.turn);

	function run(a, b, throwTurn) {
		const battle = new Battle();
		battle.setCP(10000);
		const make = (fast, i) => {
			const p = new Pokemon('blissey', i, battle);
			p.initialize(10000);
			p.selectMove('fast', fast);
			return p;
		};
		const me = make(FAST[a], 0);
		const opp = make(FAST[b], 1);

		if (me.fastMove.turns !== a || opp.fastMove.turns !== b) {
			return { err: 'unexpected move duration' };
		}

		me.selectMove('charged', 'ICE_PUNCH', 0);
		me.selectMove('charged', 'none', 1);
		opp.selectMove('charged', 'none', 0);
		opp.selectMove('charged', 'none', 1);
		me.setShields(0);
		opp.setShields(0);
		me.setStartEnergy(100);
		opp.setStartEnergy(0);
		battle.setNewPokemon(me, 0, false);
		battle.setNewPokemon(opp, 1, false);
		battle.setSandboxMode(true);
		battle.setTrackThrows(true);
		battle.setActions(throwTurn ? [new TimelineAction('charged', 0, throwTurn, 0, { shielded: false, buffs: false, priority: 0 })] : []);

		const tl = battle.simulate();

		return {
			opp: taps(tl, 1),
			charged: tl.filter(e => e.actor === 0 && e.type.indexOf('charged') === 0).map(e => e.turn),
			logged: battle.getThrowLog().map(t => ({ turn: t.turn, rho: t.oppCooldown }))
		};
	}

	for (let a = 1; a <= 5; a++) {
		for (let b = 1; b <= 5; b++) {
			const base = run(a, b, 0);

			for (let k = 1; k <= 8; k++) {
				const turn = 1 + a * k; // engine turns start at 1
				const thrown = run(a, b, turn);
				const next = (r) => r.opp.find(t => t > turn);

				out.push({ a, b, k, turn, charged: thrown.charged[0], shift: next(base) - next(thrown), logged: thrown.logged[0] });
			}
		}
	}

	return out;
}, { FAST });

let bad = 0;

for (const r of results) {
	const w = TM.syncWindows(r.a, r.b, r.k)[r.k - 1];

	if (w.tempoShift !== r.shift || r.charged !== r.turn || !r.logged || r.logged.rho !== w.rho || r.logged.turn !== r.turn) {
		bad++;
		console.log('MISMATCH', JSON.stringify(r), 'model', w.tempoShift);
	}
}

console.log(`checked ${results.length} throw scenarios, ${bad} mismatches`);
await browser.close();
process.exit(bad ? 1 : 0);
