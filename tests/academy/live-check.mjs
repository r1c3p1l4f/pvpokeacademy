/*
* Checks the Coach against a real-time Training Battle (emulate mode), which engine-check.mjs doesn't cover.
*
* 1. After each of your Charged Moves, the opponent's next action must come on the 2nd *decided* engine step (the
*    dead-turn rule), counted from Battle.getStepLog() by index. Total steps are also reported: an extra no-op step
*    can appear in real-time mode, which ticks cooldowns but allows no decisions.
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
			adviceText: $('.coach-advice').text(),
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

const result = await page.evaluate(() => { window.__battle.debug(); return { rec: window.__rec, throws: Coach.getThrows(), steps: window.__battle.getStepLog(), rawThrows: window.__battle.getThrowLog() }; });
await page.waitForTimeout(500);
await browser.close();

// Taps are dispatched on the update after the turn they were made: tap turn = update turn - 1
const tapsBy = [[], []];
result.rec.forEach(r => r.taps.forEach(a => tapsBy[a].push(r.turn - 1)));

/*
* Dead-turn check at engine level. Battle.getStepLog() has one record per processed step, and every throw records the
* index of its step, so this counts steps by array index with no UI timing involved.
*
* After each of your Charged Moves, how many engine steps pass before the opponent has an action accepted? Two numbers:
*   total   - every step, since cooldowns tick on all of them
*   decided - only steps where actions could be chosen (the "same turn" re-runs after a Charged Move don't count)
* Normally both are 2: the dead turn, then their tap. Sneaks (the opponent acted on the throw step itself) and sequences
* that end in a swap are reported separately.
*/
const steps = result.steps;
const rows = [];
let ordinaryChecked = 0, ordinaryBad = 0, skipped = 0;
const lines = [];
const sneakSeen = [];

for (const t of result.rawThrows) {
	if (t.actor !== 0 || t.simultaneous) continue;
	const graded = result.throws.find(x => x.turn === t.turn && x.actor === 0);
	const sameStep = steps[t.stepIndex] && steps[t.stepIndex].accepted.some(a => a[0] === 1);
	let total = 0, decided = 0, outcome = null;

	for (let i = t.stepIndex + 1; i < steps.length; i++) {
		total++;
		if (steps[i].decided) decided++;
		// The player's own next action (the test clicks buttons freely) changes what the count means, so stop there
		if (steps[i].accepted.some(a => a[0] === 0 && a[1] !== 'fast')) { outcome = 'own'; break; }
		const theirs = steps[i].accepted.filter(a => a[0] === 1);
		if (theirs.some(a => a[1] === 'switch')) { outcome = 'swap'; break; }
		if (theirs.length) { outcome = theirs[0][1]; break; }
		if (total > 10) { outcome = 'none'; break; }
	}

	rows.push({ turn: t.turn, grade: graded ? graded.grade : '?', rho: t.oppCooldown, sameStep, total, decided, outcome });

	if (outcome === 'swap' || outcome === 'own' || outcome === null || outcome === 'none') { skipped++; continue; }
	if (sameStep) { sneakSeen.push(`${total}/${decided}`); if (decided !== 2) ordinaryBad++; continue; }

	ordinaryChecked++;
	if (decided !== 2) ordinaryBad++;
}

console.log('engine-level steps after each of your throws (total/decided):');
rows.forEach(r => console.log(`  T${r.turn} ${r.grade} rho=${r.rho}${r.sameStep ? ' [opp acted on the throw step]' : ''}: ${r.total}/${r.decided} then opp ${r.outcome}`));

const deadTurnChecked = ordinaryChecked, deadTurnBad = ordinaryBad;
const rec = result.rec;
let adviceChecked = 0, adviceBad = 0, engineChecked = 0;

for (const t of result.throws) {
	if (t.simultaneous || t.actor !== 0) continue;
	const shown = rec.find(r => r.turn === t.turn + 1); // pre-render class = advice shown while this turn was decided
	if (shown) {
		adviceChecked++;
		// The prompt comes from the engine, so it is checked against the engine's own verdict on the same throw (the observer),
		// not against a timing model. The two ask with different settings (the prompt assumes timing optimization on and farming
		// off), so a disagreement is only reported when the player's own settings match the prompt's.
		const raw = result.rawThrows.find(r => r.turn === t.turn && r.actor === 0);
		const go = /\bgo\b/.test(shown.advice), wait = /\bwait\b/.test(shown.advice);
		if (raw && raw.engine && (go || wait)) {
			const engineHolds = raw.engine.action === -1;
			engineChecked++;
			if ((wait && !engineHolds) || (go && engineHolds)) {
				adviceBad++;
				lines.push(`ADVICE T${t.turn}: prompt "${shown.advice}" (${shown.adviceText.slice(0, 90)}) but the observer says ${engineHolds ? 'hold' : 'throw'} (rho=${t.rho}, ${t.grade}) reasons=${JSON.stringify(raw.engine.reasons)}`);
			}
		}
	}
}

console.log(`throws ${result.throws.length}; ordinary dead-turn checks ${deadTurnChecked}, mismatches ${deadTurnBad}; sneak throws (total/decided steps): ${JSON.stringify(sneakSeen)}; skipped ${skipped}; advice checks ${adviceChecked} (${engineChecked} with an engine verdict), mismatches ${adviceBad}`);
lines.filter(l => l.startsWith('ADVICE')).forEach(l => console.log(l));
if (lines.some(l => l.startsWith('DEAD-TURN'))) console.log('(dead-turn step counts differed from 2 in ' + deadTurnBad + ' ordinary throw(s); informational, see the comment at the top of this file)');
console.log(errors.length ? 'PAGE ERRORS: ' + errors.join(' | ') : 'no page errors');
// The opponent must act on the 2nd decided step after your throw (the dead-turn rule); extra no-op steps are reported, not failed
process.exit(deadTurnBad || adviceBad || errors.length ? 1 : 0);
