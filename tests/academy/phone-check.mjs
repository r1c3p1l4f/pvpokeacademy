/*
* Measures how much of the battle window and the Coach panel is visible during a live Training Battle at
* phone and tablet sizes, including a mid-battle rotation. Prints a table; saves screenshots when SHOT_DIR is set.
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
for (const [label, size] of [['phone portrait', { width: 390, height: 844 }], ['phone landscape', { width: 844, height: 390 }], ['tablet portrait', { width: 768, height: 1024 }]]) {
	const page = await startBattle(size, label);
	const m = await measure(page);
	rows.push({ label, ...m });
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label.replace(' ', '-')}.png` });
	await page.close();
}

// Rotate mid-battle: portrait -> landscape -> portrait
const page = await startBattle({ width: 390, height: 844 }, 'rotate');
for (const [label, size] of [['rotated to landscape', { width: 844, height: 390 }], ['rotated back to portrait', { width: 390, height: 844 }]]) {
	await page.setViewportSize(size);
	await page.waitForTimeout(1500);
	rows.push({ label, ...(await measure(page)) });
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label.replace(/ /g, '-')}.png` });
}
await browser.close();

for (const r of rows) {
	const f = (x) => x ? `${x.visiblePct}% (top ${x.top}, ${x.w}x${x.h})` : 'none';
	console.log(`${r.label.padEnd(26)} ${r.viewport.padEnd(9)} hscroll:${r.hscroll}  window ${f(r.window)}\n${''.padEnd(26)} controls ${f(r.controls)} | panel ${f(r.panel)}\n${''.padEnd(26)} advice ${f(r.advice)} | you ${f(r.self)} | opp ${f(r.opp)}`);
}
