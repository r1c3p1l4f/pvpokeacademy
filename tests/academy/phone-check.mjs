/*
* Measures how much of the battle window and the Coach panel is visible during a live Training Battle at
* portrait phone and tablet sizes. Prints a table; saves screenshots when SHOT_DIR is set.
*
*   SITE_URL=... PLAYWRIGHT_PATH=... CHROME_PATH=... SHOT_DIR=/tmp/shots node tests/academy/phone-check.mjs
*/
import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(process.env.PLAYWRIGHT_PATH || '/node-tools/node_modules/');
const { chromium } = require('playwright');
const SITE = process.env.SITE_URL || 'http://127.0.0.1:8080/pvpoke/src/';
const SHOTS = process.env.SHOT_DIR || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});

async function measure(page) {
	return page.evaluate(() => {
		const vw = innerWidth, vh = innerHeight;
		const part = (sel) => {
			const el = document.querySelector(sel);
			if (!el) return null;
			const r = el.getBoundingClientRect();
			const visH = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
			const visW = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
			return { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width), visiblePct: r.height && r.width ? Math.round(100 * (visH * visW) / (r.height * r.width)) : 0 };
		};
		return {
			viewport: vw + 'x' + vh,
			hscroll: document.documentElement.scrollWidth > vw,
			pageScrolls: document.documentElement.scrollHeight > vh,
			window: part('.battle-window'),
			controls: part('.battle-window .controls'),
			panel: part('.coach-panel'),
			advice: part('.coach-advice'),
			self: part('.coach-side.self'),
			opp: part('.coach-side.opp'),
			log: part('.coach-log')
		};
	});
}

// The overlay must be visible during live play and must never intercept a tap
async function overlayChecks(page) {
	for (let i = 0; i < 60; i++) {
		const ready = await page.evaluate(() => $('.battle-window').attr('phase') === 'neutral' && $('.coach-banner').text().length > 0);
		if (ready) break;
		await page.waitForTimeout(500);
	}

	return page.evaluate(() => {
		const win = document.querySelector('.battle-window').getBoundingClientRect();
		const visible = (sel) => {
			const el = document.querySelector(sel);
			if (!el || getComputedStyle(el).display === 'none') return 0;
			const r = el.getBoundingClientRect();
			const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
			const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
			return Math.round(100 * (w * h) / (r.width * r.height || 1));
		};
		const overlays = [...document.querySelectorAll('.coach-overlay')];
		const hittable = overlays.filter(el => getComputedStyle(el).pointerEvents !== 'none').length;
		// Points a player taps: the window centre and the middle of every Charged Move button
		const points = [['window centre', win.left + win.width / 2, win.top + win.height * 0.45]];
		document.querySelectorAll('.controls .move-bar').forEach((bar, i) => {
			const r = bar.getBoundingClientRect();
			if (r.width) points.push(['button ' + (i + 1), r.left + r.width / 2, r.top + r.height / 2]);
		});
		const hits = points.map(([name, x, y]) => {
			const el = document.elementFromPoint(x, y);
			return { name, blocked: !!(el && el.closest('.coach-overlay')), target: el ? (el.className || el.tagName).toString().slice(0, 30) : null };
		});
		return { banner: visible('.coach-banner'), oppEnergy: visible('.coach-opp-energy'), overlays: overlays.length, hittable, hits };
	});
}

async function startBattle(size, label) {
	const page = await browser.newPage({ viewport: size, hasTouch: size.width < 900, isMobile: size.width < 900 });
	await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());
	await page.goto(SITE + 'train/', { waitUntil: 'load' });
	await page.waitForTimeout(2500);
	await page.selectOption('.league-cup-select', '1500 all');
	await page.selectOption('.coach-select', 'learn');
	await page.locator('a.random:visible').first().click();
	await page.waitForTimeout(1200);
	await page.click('.battle-btn');
	await page.waitForSelector('.battle-window[phase="neutral"]', { timeout: 20000 });
	await page.waitForTimeout(6000);
	return page;
}

const rows = [];
// The game is played in portrait, so only portrait sizes are checked. Short phones are the tight case.
for (const [label, size] of [
	['phone 390x844', { width: 390, height: 844 }],
	['small phone 375x667', { width: 375, height: 667 }],
	['small phone 360x640', { width: 360, height: 640 }],
	['tablet 768x1024', { width: 768, height: 1024 }]
]) {
	const page = await startBattle(size, label);
	rows.push({ label, ...(await measure(page)), overlay: await overlayChecks(page) });
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label.replace(/ /g, '-')}.png` });
	await page.close();
}

await browser.close();

let failures = 0;

for (const r of rows) {
	const f = (x) => x ? `${x.visiblePct}% (top ${x.top}, ${x.w}x${x.h})` : 'none';
	const o = r.overlay;
	const blocked = o.hits.filter(h => h.blocked).map(h => h.name);
	const problems = [];

	if (r.window.visiblePct < 100) problems.push('window not fully visible');
	if (r.controls.visiblePct < 100) problems.push('controls not fully visible');
	if (r.hscroll) problems.push('horizontal scroll');
	if (o.banner < 100) problems.push('banner not fully visible');
	if (o.oppEnergy < 100) problems.push('opponent energy bar not fully visible');
	if (o.hittable > 0) problems.push(o.hittable + ' overlay element(s) can receive taps');
	if (blocked.length) problems.push('overlay covers: ' + blocked.join(', '));
	failures += problems.length;

	console.log(`${r.label.padEnd(22)} ${r.viewport.padEnd(8)} window ${f(r.window)} | controls ${f(r.controls)}`);
	console.log(`${''.padEnd(22)} overlay: banner ${o.banner}%, opp energy ${o.oppEnergy}%, ${o.overlays} elements, taps reach ${o.hits.map(h => h.name + ' -> ' + h.target).join('; ')}`);
	console.log(`${''.padEnd(22)} ${problems.length ? 'PROBLEMS: ' + problems.join('; ') : 'ok'}`);
}

process.exit(failures ? 1 : 0);
