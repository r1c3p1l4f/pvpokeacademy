import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '../../src');
const require = createRequire(import.meta.url);
const QE = require(path.join(src, 'js/academy/QuizEngine.js'));
const TM = require(path.join(src, 'js/academy/TurnMath.js'));

const gm = JSON.parse(fs.readFileSync(path.join(src, 'data/gamemaster.json'), 'utf8'));
const rankings = JSON.parse(fs.readFileSync(path.join(src, 'data/rankings/all/overall/rankings-1500.json'), 'utf8'));
const pool = QE.buildPool(gm, rankings, 80);

test('pool is built from rankings with valid moves', () => {
	assert.ok(pool.length >= 60, 'pool size ' + pool.length);
	for (const mon of pool) {
		assert.ok(mon.fast.gain > 0 && mon.fast.turns >= 1 && mon.fast.turns <= 5, mon.id);
		assert.ok(mon.charged.length >= 1);
		mon.charged.forEach(m => assert.ok(m.energy > 0 && m.energy <= 100));
		assert.equal(pool.byId[mon.id], mon);
	}
});

test('rng is repeatable for a seed', () => {
	const a = QE.createRng(42), b = QE.createRng(42);
	for (let i = 0; i < 20; i++) assert.equal(a.next(), b.next());
});

test('every generator builds well-formed questions at every level', () => {
	const types = Object.keys(QE.GENERATORS).filter(t => !t.startsWith('swap.'));
	assert.ok(types.length >= 14);
	for (const type of types) {
		const gen = QE.GENERATORS[type];
		for (let level = gen.minLevel; level <= 3; level++) {
			for (let seed = 1; seed <= 60; seed++) {
				const rng = QE.createRng(seed * 7919 + level);
				const q = QE.build(type, gen.makeParams(rng, pool, level), pool, level);
				const label = `${type} L${level} seed ${seed}`;
				for (const text of [q.prompt, q.explain]) {
					assert.equal(typeof text, 'string', label);
					assert.ok(!/undefined|NaN|\[object/.test(text), `${label}: ${text}`);
				}
				assert.ok(q.prompt.length > 20, label);
				if (q.input.kind === 'number') {
					assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer <= q.input.max, `${label}: answer ${q.answer}`);
				} else if (q.input.kind === 'choice') {
					assert.ok(q.input.options.some(o => o.id === q.answer), label);
				} else {
					assert.ok(q.answer.every(id => q.input.options.some(o => o.id === id)), label);
				}
				// the right answer passes and a wrong one fails
				assert.equal(QE.check(q, q.input.kind === 'number' ? q.answer : q.answer).correct, true, label);
				if (q.input.kind === 'number') assert.equal(QE.check(q, q.answer + 1).correct, false, label);
				// params replay the exact same question
				const again = QE.build(type, JSON.parse(JSON.stringify(q.params)), pool, level);
				assert.equal(again.prompt, q.prompt, label);
				assert.equal(again.key, q.key, label);
			}
		}
	}
});

test('count answers agree with independent arithmetic', () => {
	for (let seed = 1; seed <= 100; seed++) {
		const rng = QE.createRng(seed);
		const p = QE.GENERATORS['count.toCharged'].makeParams(rng, pool, 2);
		const q = QE.build('count.toCharged', p, pool);
		const mon = pool.byId[p.mon];
		const cost = mon.charged.find(m => m.id === p.move).energy;
		let energy = p.energy, taps = 0;
		while (energy < cost) { energy += mon.fast.gain; taps++; }
		assert.equal(q.answer, taps);
	}
});

test('count.race matches a tick-by-tick simulation', () => {
	for (let seed = 1; seed <= 60; seed++) {
		const rng = QE.createRng(seed);
		const p = QE.GENERATORS['count.race'].makeParams(rng, pool, 2);
		const q = QE.build('count.race', p, pool);
		const first = (mon, move) => {
			const cost = mon.charged.find(m => m.id === move).energy;
			let e = 0, turn = 0;
			while (e < cost) { e += mon.fast.gain; turn += mon.fast.turns; }
			return turn;
		};
		const ta = first(pool.byId[p.a], p.am), tb = first(pool.byId[p.b], p.bm);
		assert.equal(q.answer, ta < tb ? 'a' : (tb < ta ? 'b' : 'tie'));
	}
});

test('history answers match an energy replay including the 100 cap', () => {
	for (let seed = 1; seed <= 100; seed++) {
		const rng = QE.createRng(seed);
		const p = QE.GENERATORS['history.energy'].makeParams(rng, pool, 3);
		const q = QE.build('history.energy', p, pool);
		const mon = pool.byId[p.mon];
		let e = 0;
		for (const ev of p.events) {
			if (ev.type === 'fast') for (let i = 0; i < ev.count; i++) e = Math.min(100, e + mon.fast.gain);
			else e -= ev.cost;
		}
		assert.ok(e >= 0);
		assert.equal(q.answer, e);
	}
	const capped = QE.build('history.capped', QE.GENERATORS['history.capped'].makeParams(QE.createRng(3), pool, 3), pool);
	assert.match(capped.explain, /caps at 100/);
});

test('history.next never asks about a move that is already affordable', () => {
	for (let seed = 1; seed <= 100; seed++) {
		const rng = QE.createRng(seed);
		const q = QE.build('history.next', QE.GENERATORS['history.next'].makeParams(rng, pool, 3), pool);
		assert.ok(q.answer > 0, q.prompt);
	}
});

test('timing questions agree with TurnMath', () => {
	for (let seed = 1; seed <= 80; seed++) {
		const rng = QE.createRng(seed);
		const pc = QE.build('timing.perfectCount', QE.GENERATORS['timing.perfectCount'].makeParams(rng, pool, 1), pool);
		assert.ok(pc.answer >= 1);
		const gc = QE.build('timing.goodCounts', QE.GENERATORS['timing.goodCounts'].makeParams(rng, pool, 2), pool);
		assert.ok(gc.answer.length >= 1 && gc.answer.length < 8);
	}
	// the user's own example: 5-turn vs 3-turn
	const q = QE.build('timing.goodCounts', { a: 5, b: 3 }, pool);
	assert.deepEqual(q.answer, ['1', '2', '4', '5', '7', '8']);
	const q2 = QE.build('timing.canPerfect', { a: 2, b: 4 }, pool);
	assert.equal(q2.answer, 'no');
	assert.equal(QE.build('timing.canPerfect', { a: 2, b: 5 }, pool).answer, 'yes');
});

test('snapshot questions always have an unambiguous answer', () => {
	for (let seed = 1; seed <= 100; seed++) {
		const rng = QE.createRng(seed);
		const q = QE.build('timing.snapshot', QE.GENERATORS['timing.snapshot'].makeParams(rng, pool, 3), pool);
		assert.ok(q.answer === 'throw' || q.answer === 'wait');
	}
});

test('check handles multi-select order and wrong answers', () => {
	const q = QE.build('timing.goodCounts', { a: 5, b: 3 }, pool);
	assert.equal(QE.check(q, ['8', '7', '5', '4', '2', '1']).correct, true);
	assert.equal(QE.check(q, ['1', '2']).correct, false);
	assert.equal(QE.check(q, 'x').correct, false);
});

test('generate respects categories and falls back when a level has none', () => {
	const rng = QE.createRng(9);
	for (let i = 0; i < 40; i++) {
		const q = QE.generate(rng, pool, { categories: ['history'], level: 1 });
		assert.equal(q.category, 'history');
	}
	for (let i = 0; i < 40; i++) {
		const q = QE.generate(rng, pool, { categories: ['count', 'timing'], level: 1 });
		assert.ok(['count', 'timing'].includes(q.category));
		assert.ok(q.level <= 1);
	}
});

test('Progress tracks stats, replays misses, and masters cards', () => {
	const prog = new QE.Progress();
	const rng = QE.createRng(1);
	const q = QE.generate(rng, pool, { categories: ['count'], level: 1 });

	assert.equal(prog.pickWeak(rng), null);
	prog.record(q, false);
	assert.equal(prog.weakCards().length, 1);
	assert.equal(prog.stats().streak, 0);

	const replay = QE.next(QE.createRng(2), pool, { categories: ['count'], level: 1, weakOnly: true }, prog);
	assert.equal(replay.key, q.key);
	assert.equal(replay.replay, true);

	for (let i = 0; i < 4; i++) prog.record(q, true);
	assert.equal(prog.weakCards().length, 0, 'mastered after 4 correct in a row');
	const s = prog.stats();
	assert.equal(s.streak, 4);
	assert.equal(s.best, 4);
	assert.equal(s.mastered, 1);
	assert.equal(s.categories.count.seen, 5);
	assert.equal(s.categories.count.pct, 80);
});

test('Progress persists to storage and survives corrupt data', () => {
	const store = QE.memoryStorage();
	const q = QE.generate(QE.createRng(4), pool, { categories: ['timing'], level: 1 });
	const a = new QE.Progress(store);
	a.record(q, false);
	const b = new QE.Progress(store);
	assert.equal(b.weakCards().length, 1);

	store.setItem('academy.progress.v1', '{not json');
	const c = new QE.Progress(store);
	assert.equal(c.stats().total, 0);

	// storage that throws must not break recording
	const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
	const d = new QE.Progress(broken);
	d.record(q, true);
	assert.equal(d.stats().total, 1);
});

test('Progress keeps at most 200 cards', () => {
	const prog = new QE.Progress();
	for (let seed = 1; seed <= 400; seed++) {
		const q = QE.generate(QE.createRng(seed), pool, { categories: ['count', 'timing', 'history'], level: 3 });
		prog.record(q, seed % 2 === 0);
	}
	assert.ok(prog.weakCards().length <= 200);
});

test('answer text uses singular units for 1', () => {
	const q = QE.build('timing.freeTurns', { a: 4, b: 5, k: 3 }, pool);
	assert.equal(q.answer, 1);
	assert.equal(QE.answerText(q), '1 free turn');
	const q2 = QE.build('count.toCharged', { mon: pool[0].id, move: pool[0].charged[0].id, energy: 0 }, pool);
	assert.match(QE.answerText(q2), /^\d+ Fast Moves?$/);
});
