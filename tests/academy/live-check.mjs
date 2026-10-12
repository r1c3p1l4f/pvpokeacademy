/*
* Checks the Coach against a real-time Training Battle (emulate mode), which engine-check.mjs doesn't cover.
*
* 1. After each of your Charged Moves, the opponent's next tap must come on turn T+2 (the dead-turn rule).
* 2. The prompt that was on screen the turn before each of your throws must agree with how the throw was graded:
*    "throw now" => rho <= 2, "tap again" => rho >= 3.
*
*   SITE_URL=... PLAYWRIGHT_PATH=... CHROME_PATH=... node tests/academy/live-check.mjs
*/
import { createRequire } from 'module';

const require = createRequire(process.env.PLAYWRIGHT_PATH || '/node-tools/node_modules/');
const { chromium } = require('playwright');
const SITE = process.env.SITE_URL || 'http://127.0.0.1:8080/pvpoke/src/';
const MAX_MS = parseInt(process.env.MAX_MS || '170000', 10);

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1000, height: 1250 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());
await page.goto(SITE + 'train/', { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.selectOption('.league-cup-select', '1500 all');
await page.selectOption('.coach-select', 'learn');
await page.locator('a.random:visible').first().click();
await page.waitForTimeout(1200);

// Record every coach update: the advice that was on screen during the previous turn, and each side's taps
await page.evaluate(() => {
	window.__rec = [];
	const orig = Coach.update;
	Coach.update = function (r) {
		window.__rec.push({
			turn: r.turn,
			phase: r.phase,
			advice: $('.coach-advice').attr('class') || '',
			taps: (r.animations || []).filter(a => a.type === 'fast').map(a => a.actor)
		});
		return orig.apply(this, arguments);
	};
});

await page.click('.battle-btn');
await page.waitForSelector('.battle-window[phase="neutral"]', { timeout: 20000 });
await page.hover('.auto-tap');
await page.click('.auto-tap');

const t0 = Date.now();
while (Date.now() - t0 < MAX_MS) {
	await page.waitForTimeout(400);
	const phase = await page.getAttribute('.battle-window', 'phase');
	if (phase === 'game_over_screen') break;
	const bar = page.locator('.controls .move-bar.active:visible').first();
	if (phase === 'neutral' && await bar.count()) await bar.click().catch(() => {});
	if (phase === 'suspend_charged_attack') { await page.mouse.down(); await page.waitForTimeout(2500); await page.mouse.up(); }
	if (phase && phase.startsWith('suspend_charged_shield')) await page.evaluate(() => $('.shield-window .close').trigger('click'));
}

const result = await page.evaluate(() => ({ rec: window.__rec, throws: Coach.getThrows() }));
await browser.close();

// Taps are dispatched on the update after the turn they were made: tap turn = update turn - 1
const tapsBy = [[], []];
result.rec.forEach(r => r.taps.forEach(a => tapsBy[a].push(r.turn - 1)));

let deadTurnChecked = 0, deadTurnBad = 0, adviceChecked = 0, adviceBad = 0;
const lines = [];

for (const t of result.throws) {
	if (t.simultaneous) continue;
	// Only your throws are checked: the opponent AI taps deterministically, while your own taps come from
	// autotap and real-time input, which jitter by a turn or two and say nothing about the engine.
	const next = t.actor === 0 ? tapsBy[1].find(x => x > t.turn) : undefined;
	if (next !== undefined) {
		deadTurnChecked++;
		const delta = next - t.turn;
		// The in-flight tap is excluded: an opponent that tapped on the throw turn itself shows up at t.turn
		if (delta !== 2) { deadTurnBad++; lines.push(`DEAD-TURN T${t.turn} actor ${t.actor}: next tap after throw at +${delta}, expected +2`); }
	}

	if (t.actor === 0) {
		const shown = result.rec.find(r => r.turn === t.turn + 1); // pre-render class = advice shown while this turn was decided
		if (shown) {
			adviceChecked++;
			const go = /\bgo\b/.test(shown.advice), wait = /\bwait\b/.test(shown.advice);
			const ok = go ? t.rho <= 2 : (wait ? t.rho >= 3 : true);
			if (!ok) { adviceBad++; lines.push(`ADVICE T${t.turn}: prompt "${shown.advice}" but graded rho=${t.rho} (${t.grade})`); }
		}
	}
}

console.log(`throws ${result.throws.length}; dead-turn checks ${deadTurnChecked}, mismatches ${deadTurnBad}; advice checks ${adviceChecked}, mismatches ${adviceBad}`);
lines.forEach(l => console.log(l));
console.log(errors.length ? 'PAGE ERRORS: ' + errors.join(' | ') : 'no page errors');
process.exit(deadTurnBad || adviceBad || errors.length ? 1 : 0);
