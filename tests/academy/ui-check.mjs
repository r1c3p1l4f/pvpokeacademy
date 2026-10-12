/*
* Drives the Academy page in a real browser: quiz, flashcards, missed-card replay and progress.
*
*   SITE_URL=http://127.0.0.1:8080/pvpoke/src/ PLAYWRIGHT_PATH=/path/to/node_modules/ \
*   CHROME_PATH=/path/to/chrome SHOT_DIR=/tmp/shots node tests/academy/ui-check.mjs
*/
import { createRequire } from 'module';
import assert from 'node:assert/strict';
import fs from 'fs';

const require = createRequire(process.env.PLAYWRIGHT_PATH || '/node-tools/node_modules/');
const { chromium } = require('playwright');
const SITE = process.env.SITE_URL || 'http://127.0.0.1:8080/pvpoke/src/';
const SHOTS = process.env.SHOT_DIR || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERR ' + e.message));
await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());

const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const question = () => page.evaluate(() => InterfaceMaster.getInstance().getQuestion());

async function answer(q, correct) {
	if (q.input.kind === 'number') {
		await page.fill('.card-input input', String(correct ? q.answer : q.answer + 1));
	} else {
		const ids = q.input.kind === 'multi' ? (correct ? q.answer : []) : [correct ? q.answer : q.input.options.map(o => o.id).find(id => id !== q.answer && !(q.accept || []).includes(id))];
		if (q.input.kind === 'multi' && !correct) ids.push(q.input.options.map(o => o.id).find(id => !q.answer.includes(id)) || q.input.options[0].id);
		for (const id of ids) await page.click(`.card-input .option[data-id="${id}"]`);
	}
}

await page.goto(SITE + 'academy/', { waitUntil: 'load' });
await page.waitForSelector('.academy-card:not(.hide)', { timeout: 30000 });

// Hidden controls really are hidden in quiz mode
for (const sel of ['.reveal-btn', '.next-btn', '.self-grade']) assert.equal(await page.isVisible(sel), false, sel + ' should start hidden');
assert.equal(await page.isVisible('.submit-btn'), true);
await shot('quiz-question');

// Empty submit is rejected without scoring
await page.evaluate(() => { localStorage.clear(); });
await page.click('.submit-btn');
assert.equal(await page.isVisible('.card-feedback'), false);

// Each topic on its own: answer right then wrong
const seen = {};
for (const cat of ['count', 'history', 'timing', 'swap']) {
	// leave only this topic on
	await page.evaluate((c) => {
		document.querySelectorAll('.cat-chip').forEach(el => { if (el.dataset.cat === c && !el.classList.contains('on')) el.click(); });
	}, cat);
	await page.evaluate((c) => {
		document.querySelectorAll('.cat-chip.on').forEach(el => { if (el.dataset.cat !== c) el.click(); });
	}, cat);

	for (let i = 0; i < 6; i++) {
		const q = await question();
		assert.equal(q.category, cat);
		seen[q.type] = (seen[q.type] || 0) + 1;
		const wantCorrect = i % 3 !== 2;
		await answer(q, wantCorrect);
		await page.click('.submit-btn');
		await page.waitForSelector(wantCorrect ? '.card-feedback.correct' : '.card-feedback.wrong');
		const explain = await page.textContent('.card-feedback .explain');
		assert.ok(explain.length > 20 && !/undefined|NaN/.test(explain), explain);
		if (i === 0) await shot('quiz-feedback-' + cat);
		await page.click('.next-btn');
		await page.waitForTimeout(50);
	}
}
console.log('question types seen:', JSON.stringify(seen));

// Finish a round: 10 questions
await page.evaluate(() => { document.querySelectorAll('.cat-chip').forEach(el => { if (!el.classList.contains('on')) el.click(); }); });
await page.selectOption('.academy-length', '10');
for (let i = 0; i < 10; i++) {
	const q = await question();
	await answer(q, true);
	await page.click('.submit-btn');
	await page.waitForSelector('.card-feedback.correct');
	await page.click('.next-btn');
}
await page.waitForSelector('.academy-summary:not(.hide)');
assert.match(await page.textContent('.summary-score'), /10 \/ 10/);
await shot('summary');

// Flashcards: reveal, mark missed, then replay missed only
// The replay picks at random among every missed card, so start from an empty history to make the one missed here the only candidate
await page.evaluate(() => localStorage.removeItem('academy.progress.v1'));
await page.reload();
await page.waitForSelector('.academy-modes a[data-mode="flashcards"]');
await page.click('.academy-modes a[data-mode="flashcards"]');
await page.waitForSelector('.academy-card:not(.hide)');
assert.equal(await page.isVisible('.reveal-btn'), true);
assert.equal(await page.isVisible('.submit-btn'), false);
const flash = await question();
await page.click('.reveal-btn');
await page.waitForSelector('.card-feedback:not(.hide)');
assert.equal(await page.isVisible('.self-grade'), true);
await shot('flashcard-revealed');
await page.click('.missed-btn');
await page.waitForTimeout(100);

await page.click('.academy-weak');
const replay = await question();
assert.equal(replay.key, flash.key, 'missed card should come back');
assert.equal(await page.isVisible('.replay-badge'), true);
await page.click('.reveal-btn');
await page.click('.gotit-btn');
await page.click('.academy-weak');

// Progress tab
await page.click('.academy-modes a[data-mode="progress"]');
await page.waitForSelector('.academy-progress:not(.hide)');
const tiles = await page.textContent('.progress-stats');
assert.match(tiles, /Answered/);
await shot('progress');

// Settings persist across reloads
await page.reload();
await page.waitForSelector('.academy-progress:not(.hide)');
assert.match(await page.textContent('.progress-stats'), /Answered/);

assert.deepEqual(errors, []);
console.log('Academy UI checks passed');
await browser.close();
