/*
* Validates the engine-sourced live prompts in a real Training Battle.
*
* The player only autotaps and never throws, so energy builds up and the engine is asked at many different timing
* states. At each of your action boundaries this records the prompt, what the old TurnMath.adviseThrow model would have
* said for the same state, and then reports:
*   - how often the two disagree on "throw now" versus "hold"
*   - whether the tap countdown held up: when the badge said N, did the engine say GO N taps later?
*   - the reasons the engine gave for holding
*
*   SITE_URL=... PLAYWRIGHT_PATH=... CHROME_PATH=... node tests/academy/advice-check.mjs
*/
import { createRequire } from 'module';

const require = createRequire(process.env.PLAYWRIGHT_PATH || '/node-tools/node_modules/');
const { chromium } = require('playwright');
const SITE = process.env.SITE_URL || 'http://127.0.0.1:8080/pvpoke/src/';
const MAX_MS = parseInt(process.env.MAX_MS || '110000', 10);

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1000, height: 1250 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && /Coach/.test(m.text())) errors.push(m.text().slice(0, 200)); });
await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());
await page.goto(SITE + 'train/', { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.selectOption('.league-cup-select', '1500 all');
await page.selectOption('.coach-select', 'learn');
await page.locator('a.random:visible').first().click();
await page.waitForTimeout(1200);

await page.evaluate(() => {
	window.__rows = [];
	window.__oppThrows = 0;
	const orig = Coach.update;
	Coach.update = function (r) {
		const out = orig.apply(this, arguments);
		const me = r.pokemon[0], opp = r.pokemon[1];

		if (r.phase === 'neutral' && me.cooldown <= 500 && me.hp > 0 && opp.hp > 0) {
			const adv = Coach.getAdvice();
			const ready = me.chargedMoves.filter(m => me.energy >= m.energy);
			let old = null;

			if (ready.length) {
				const cheapest = ready.reduce((lo, m) => m.energy < lo.energy ? m : lo, ready[0]);
				const a = TurnMath.adviseThrow({
					a: me.fastMove.turns, b: opp.fastMove.turns, myCd: me.cooldown / 500, oppCd: opp.cooldown / 500,
					energy: me.energy, gain: me.fastMove.energyGain, cost: cheapest.energy, maxWait: 2
				});
				old = a.action;
			}

			window.__rows.push({
				turn: r.turn, who: me.speciesName + '|' + opp.speciesName, throws: Coach.getThrows().filter(t => t.actor === 1).length,
				energy: me.energy, ready: ready.length > 0,
				engine: adv ? { css: adv.css, badge: adv.badge, taps: adv.taps } : null, old
			});
		}

		return out;
	};
});

await page.click('.battle-btn');
await page.waitForSelector('.battle-window[phase="neutral"]', { timeout: 20000 });
await page.hover('.auto-tap');
await page.click('.auto-tap');

const t0 = Date.now();
while (Date.now() - t0 < MAX_MS) {
	await page.waitForTimeout(800);
	const phase = await page.getAttribute('.battle-window', 'phase');
	if (phase === 'game_over_screen') break;
	// Dismiss anything that needs an answer so the battle keeps moving, but never throw
	if (phase && phase.startsWith('suspend_charged_shield')) await page.evaluate(() => $('.shield-window .close').trigger('click'));
}

const rows = await page.evaluate(() => window.__rows);
await browser.close();

// Only states where a Charged Move was affordable are interesting
const live = rows.filter(r => r.ready);
let both = 0, agree = 0, engineGoOldWait = 0, engineHoldOldThrow = 0;

for (const r of live) {
	if (!r.engine || !r.old) continue;
	both++;
	const engineGo = r.engine.css === 'go';
	const oldGo = r.old === 'throw';
	if (engineGo === oldGo) agree++;
	else if (engineGo) engineGoOldWait++;
	else engineHoldOldThrow++;
}

// Badge hit rate: when the badge said N, N boundaries later the engine should say GO (same matchup, no opponent throw between)
let badgeChecked = 0, badgeHit = 0;
const misses = [];

for (let i = 0; i < live.length; i++) {
	const r = live[i];
	if (!r.engine || !(r.engine.taps >= 1)) continue;
	const later = rows[rows.indexOf(r) + r.engine.taps];
	if (!later || later.who !== r.who || later.throws !== r.throws || !later.ready) continue;
	badgeChecked++;
	if (later.engine && later.engine.css === 'go') badgeHit++;
	else misses.push(`T${r.turn}: badge ${r.engine.badge} -> T${later.turn} said ${later.engine ? later.engine.badge : 'none'}`);
}

const pct = (n, d) => d ? Math.round(100 * n / d) + '%' : 'n/a';
console.log(`boundaries recorded: ${rows.length}, with a Charged Move affordable: ${live.length}`);
console.log(`engine vs old TurnMath model on "throw now" vs "hold": ${agree}/${both} agree (${pct(agree, both)}); engine says GO but old says wait: ${engineGoOldWait}; engine holds but old says throw: ${engineHoldOldThrow}`);
console.log(`tap countdown hit rate: ${badgeHit}/${badgeChecked} (${pct(badgeHit, badgeChecked)})`);
misses.slice(0, 6).forEach(m => console.log('  miss ' + m));
console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no page errors');
process.exit(errors.length ? 1 : 0);
