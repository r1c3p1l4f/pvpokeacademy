/*
* Replays every AI throw in many simulated battles through EngineAdvisor.review and requires the engine to say
* "throw, same Charged Move" each time.
*
* In a non-sandbox simulation every Charged Move is itself the output of ActionLogic.decideAction, so replaying the
* decision must reproduce it. A miss means the stand-in battle, the cooldown patching or the queue capture is wrong,
* and everything built on EngineAdvisor (live prompts, throw review) would be unreliable. This test blocks shipping those.
*
*   SITE_URL=... PLAYWRIGHT_PATH=... CHROME_PATH=... node tests/academy/engine-replay-check.mjs
*/
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(process.env.PLAYWRIGHT_PATH || '/node-tools/node_modules/');
const { chromium } = require('playwright');
const SITE = process.env.SITE_URL || 'http://127.0.0.1:8080/pvpoke/src/';
const PAIRS = parseInt(process.env.PAIRS || '500', 10);

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

	// Small seeded generator so a failure is reproducible
	let seed = 12345;
	const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
	const shieldConfigs = [[2, 2], [1, 1], [0, 0], [2, 0], [0, 2]];

	let sims = 0, throws = 0, agree = 0, simultaneous = 0, unjudged = 0;
	const byActor = [0, 0];
	const misses = [];

	for (let n = 0; n < PAIRS; n++) {
		const a = ids[Math.floor(rnd() * ids.length)];
		let b = ids[Math.floor(rnd() * ids.length)];
		if (a === b) continue;
		const cp = [1500, 2500][Math.floor(rnd() * 2)];
		const battle = new Battle();
		battle.setCP(cp);
		battle.setCup('all');
		const make = (id, i) => { const p = new Pokemon(id, i, battle); p.initialize(cp); p.autoSelectMoves(2); return p; };
		const p0 = make(a, 0), p1 = make(b, 1);
		const sh = shieldConfigs[n % shieldConfigs.length];
		p0.setShields(sh[0]); p1.setShields(sh[1]);
		battle.setNewPokemon(p0, 0, false); battle.setNewPokemon(p1, 1, false);
		battle.setTrackThrows(true);
		battle.setThrowObserver((poke, opp, move, snap) => EngineAdvisor.review(poke, opp, move, snap));
		battle.simulate();
		sims++;

		for (const t of battle.getThrowLog()) {
			if (t.simultaneous) { simultaneous++; continue; }
			if (!t.engine) { unjudged++; continue; }
			throws++;
			byActor[t.actor]++;
			if (t.engine.agrees) agree++;
			else if (misses.length < 10) {
				misses.push({
					pair: `${a} vs ${b} @${cp} shields ${sh}`, turn: t.turn, actor: t.actor, thrown: t.moveName, thrownIndex: t.moveIndex,
					engineAction: t.engine.action, engineMove: t.engine.move ? t.engine.move.name : null, reasons: t.engine.reasons.slice(0, 3),
					snapshot: t.snapshot
				});
			}
		}
	}

	return { sims, throws, agree, simultaneous, unjudged, byActor, misses };
}, PAIRS);

await browser.close();

console.log(`simulations ${result.sims}; judged throws ${result.throws} (player ${result.byActor[0]}, opponent ${result.byActor[1]}); same-step throws skipped ${result.simultaneous}; unjudged ${result.unjudged}`);
console.log(`engine replayed the same throw: ${result.agree}/${result.throws} (${result.throws ? (100 * result.agree / result.throws).toFixed(2) : 'n/a'}%)`);
result.misses.forEach(m => console.log('  MISS ' + JSON.stringify(m)));
console.log(errors.length ? 'PAGE ERRORS: ' + errors.join(' | ') : 'no page errors');
process.exit(result.throws === 0 || result.agree !== result.throws || errors.length ? 1 : 0);
