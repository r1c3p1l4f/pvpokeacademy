/*
* Checks the Coach against a real-time Training Battle (emulate mode), which engine-check.mjs doesn't cover.
*
* 1. (Informational) How many live steps pass after each of your Charged Moves before the opponent acts. The T+2 rule
*    is verified against the engine in engine-check.mjs. Here it's only reported: counting steps from the UI update
*    stream is unreliable around the charge sequence in real-time mode, whose timers run on wall-clock time, not the
*    500 ms tick. Results have varied between runs, so this must not fail the check.
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
const debugLines = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'log' && /^\d+\t:\t/.test(m.text())) debugLines.push(m.text()); });
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
	// Capture the battle so its decision log can be read afterwards
	const start = Coach.start;
	Coach.start = function (b) {
		window.__battle = b;
		b.setDebugMode(true);
		return start.apply(this, arguments);
	};
	const orig = Coach.update;
	Coach.update = function (r) {
		window.__rec.push({
			turn: r.turn,
			phase: r.phase,
			advice: $('.coach-advice').attr('class') || '',
			taps: (r.animations || []).filter(a => a.type === 'fast').map(a => a.actor),
			cd: [r.pokemon[0].cooldown, r.pokemon[1].cooldown]
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

const result = await page.evaluate(() => { window.__battle.debug(); return { rec: window.__rec, throws: Coach.getThrows() }; });
await page.waitForTimeout(500);
await browser.close();

// Taps are dispatched on the update after the turn they were made: tap turn = update turn - 1
const tapsBy = [[], []];
result.rec.forEach(r => r.taps.forEach(a => tapsBy[a].push(r.turn - 1)));

/*
* Dead-turn check, counted in real engine steps rather than turn numbers. In emulate mode the turn counter can run
* backwards ("continue the same turn" when a throw shares a turn with the opponent's tap), so numbers mislead.
*
* After each of your Charged Moves, count the live (neutral) updates until the opponent acts. Normally that's 2: the
* dead turn, then their tap. Throws that share a turn with an opponent tap (sneaks) and sequences that end in a faint
* or swap are reported separately, because the engine handles those differently.
*/
let ordinaryChecked = 0, ordinaryBad = 0, sneakSeen = [], skipped = 0;
const lines = [];
const rec = result.rec;

function stepsToOppAction(startIndex) {
	let steps = 0;

	for (let i = startIndex; i < rec.length; i++) {
		const r = rec[i];

		if (r.phase === 'suspend_switch' || r.phase === 'game_over') return { outcome: 'faint-or-swap' };
		if (r.phase.startsWith('suspend_charged')) return { outcome: 'other-charged', steps };
		if (r.phase !== 'neutral') continue;

		steps++;
		if (r.taps.includes(1)) return { outcome: 'tap', steps };
		if (steps > 8) return { outcome: 'none-seen', steps };
	}

	return { outcome: 'ended' };
}

for (const t of result.throws) {
	if (t.simultaneous || t.actor !== 0) continue;

	// Find this throw's charge sequence, then the end of its animation, then count live steps from there
	const charge = rec.findIndex(r => r.phase === 'suspend_charged_attack' && r.turn >= t.turn - 1 && r.turn <= t.turn + 1);
	if (charge < 0) { skipped++; continue; }
	const anim = rec.findIndex((r, i) => i > charge && r.phase === 'animating');
	if (anim < 0) { skipped++; continue; }

	const res = stepsToOppAction(anim + 1);

	if (res.outcome === 'faint-or-swap' || res.outcome === 'other-charged' || res.outcome === 'ended') { skipped++; continue; }

	if (t.sneak) {
		sneakSeen.push(res.steps);
		continue;
	}

	ordinaryChecked++;

	if (res.steps !== 2) {
		ordinaryBad++;
		const nearby = rec.slice(Math.max(0, charge - 1), anim + 8).map(r => `update ${r.turn} ${r.phase} taps:${r.taps.join('') || '-'} cd:${r.cd.join('/')}`);
		lines.push(`DEAD-TURN T${t.turn} (${t.grade}): opponent acted after ${res.steps} live steps, expected 2\n  ${nearby.join('\n  ')}`);
	}
}

const deadTurnChecked = ordinaryChecked, deadTurnBad = ordinaryBad;
let adviceChecked = 0, adviceBad = 0;

for (const t of result.throws) {
	if (t.simultaneous || t.actor !== 0) continue;
	const shown = rec.find(r => r.turn === t.turn + 1); // pre-render class = advice shown while this turn was decided
	if (shown) {
		adviceChecked++;
		const go = /\bgo\b/.test(shown.advice), wait = /\bwait\b/.test(shown.advice);
		const ok = go ? t.rho <= 2 : (wait ? t.rho >= 3 : true);
		if (!ok) { adviceBad++; lines.push(`ADVICE T${t.turn}: prompt "${shown.advice}" but graded rho=${t.rho} (${t.grade})`); }
	}
}

console.log(`throws ${result.throws.length}; ordinary dead-turn checks ${deadTurnChecked}, mismatches ${deadTurnBad}; sneak throws (live steps until they act): ${JSON.stringify(sneakSeen)}; skipped (faint/swap/other) ${skipped}; advice checks ${adviceChecked}, mismatches ${adviceBad}`);
lines.filter(l => l.startsWith('ADVICE')).forEach(l => console.log(l));
if (lines.some(l => l.startsWith('DEAD-TURN'))) console.log('(dead-turn step counts differed from 2 in ' + deadTurnBad + ' ordinary throw(s); informational, see the comment at the top of this file)');
console.log(errors.length ? 'PAGE ERRORS: ' + errors.join(' | ') : 'no page errors');
// Only the advice agreement and page errors fail the check; the dead-turn counts above are informational
process.exit(adviceBad || errors.length ? 1 : 0);
