import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TM = createRequire(import.meta.url)(path.join(here, '../../src/js/academy/TurnMath.js'));

test('fastMovesToReach rounds up and handles ready/empty cases', () => {
	assert.equal(TM.fastMovesToReach(0, 55, 9), 7);
	assert.equal(TM.fastMovesToReach(0, 45, 9), 5);
	assert.equal(TM.fastMovesToReach(20, 55, 9), 4);
	assert.equal(TM.fastMovesToReach(60, 55, 9), 0);
	assert.equal(TM.fastMovesToReach(0, 55, 0), Infinity);
});

test('replayHistory caps energy per Fast Move and spends Charged Moves', () => {
	// 10 Counters (+3... use gain 8): 80 energy, throw 55 -> 25
	let r = TM.replayHistory([{ type: 'fast', count: 10 }, { type: 'charged', cost: 55 }], 8, 0);
	assert.equal(r.energy, 25);
	assert.equal(r.wasted, 0);

	// 14 fast moves of gain 8 would be 112, so 12 energy is wasted before the throw
	r = TM.replayHistory([{ type: 'fast', count: 14 }, { type: 'charged', cost: 55 }], 8, 0);
	assert.equal(r.wasted, 12);
	assert.equal(r.energy, 45);

	// unaffordable throw is flagged
	r = TM.replayHistory([{ type: 'fast', count: 2 }, { type: 'charged', cost: 55 }], 8, 0);
	assert.deepEqual(r.invalid, [1]);
	assert.equal(r.energy, 16);
});

test('countSequence carries leftover energy into the next count', () => {
	// gain 4, cost 35: 9 fast (36) leaves 1, then 2, then 3, then the 4th throw needs only 8 and leaves 0
	const seq = TM.countSequence(4, 35, 8, 0);
	assert.deepEqual(seq.map(s => s.fastMoves), [9, 9, 9, 8, 9, 9, 9, 8]);
	assert.deepEqual(seq.slice(0, 4).map(s => s.leftover), [1, 2, 3, 0]);

	// gain 3 vs cost 45 is exactly 15 every time
	assert.deepEqual(TM.countSequence(3, 45, 3, 0).map(s => s.fastMoves), [15, 15, 15]);
});

test('race compares first Charged Move turns', () => {
	const r = TM.race(
		{ gain: 3, duration: 1, cost: 45, startEnergy: 0 },   // 15 turns
		{ gain: 8, duration: 2, cost: 55, startEnergy: 0 }    // 7 fast x 2 = 14 turns
	);
	assert.equal(r.turnsA, 15);
	assert.equal(r.turnsB, 14);
	assert.equal(r.first, 'b');
	assert.equal(r.margin, -1);
});

test('projectRho follows a continuously tapping opponent', () => {
	// b = 3, tapped this turn (cd 3): next turn 2, then 1, then taps again (3)
	assert.deepEqual([1, 2, 3, 4, 5].map(d => TM.projectRho(3, 3, d)), [2, 1, 3, 2, 1]);
	// idle opponent acts next turn
	assert.equal(TM.projectRho(0, 4, 1), 4);
	assert.equal(TM.projectRho(0, 4, 2), 3);
});

test('gradeThrow thresholds', () => {
	assert.equal(TM.gradeThrow(1, 5).grade, 'perfect');
	assert.equal(TM.gradeThrow(2, 5).grade, 'good');
	assert.equal(TM.gradeThrow(3, 5).grade, 'minor');
	assert.equal(TM.gradeThrow(4, 5).grade, 'bad');
	assert.equal(TM.gradeThrow(5, 5).grade, 'sneak');
	assert.equal(TM.gradeThrow(5, 5).freeTurns, 3);
	// a 2-turn move tapped this turn only has rho 2: no free turns
	assert.equal(TM.gradeThrow(2, 2).grade, 'good');
	assert.equal(TM.gradeThrow(1, 1).grade, 'perfect');
});

test('perfect counts match the Battle page for Counter vs Incinerate (2, 7, 12)', () => {
	assert.deepEqual(TM.perfectCounts(2, 5, 3, true), [2, 7, 12]);
});

test('5-turn vs 3-turn from a synced start', () => {
	const w = TM.syncWindows(5, 3, 6);
	assert.deepEqual(w.map(x => x.rho), [1, 2, 3, 1, 2, 3]);
	assert.deepEqual(w.map(x => x.freeTurns), [0, 0, 1, 0, 0, 1]);
	assert.equal(w[2].sneak, true);
	assert.deepEqual(TM.perfectCounts(5, 3, 3, true), [1, 4, 7]);
});

test('mirror matches have no way to improve timing', () => {
	// Same-length moves stay in step: the opponent always taps on your throw turn
	TM.syncWindows(3, 3, 5).forEach(w => assert.equal(w.rho, 3));
	TM.syncWindows(2, 2, 5).forEach(w => assert.equal(w.freeTurns, 0));
	// 1-turn opponents can never be interrupted for free turns
	TM.syncWindows(4, 1, 6).forEach(w => assert.equal(w.freeTurns, 0));
});

test('adviseThrow recommends waiting only when it helps and is safe', () => {
	// Opponent has 5 turn move and just tapped; I have a 2-turn move ready now
	let adv = TM.adviseThrow({ a: 2, b: 5, myCd: 0, oppCd: 5, energy: 60, gain: 8, cost: 55, maxWait: 3 });
	assert.equal(adv.now.rho, 4);
	assert.equal(adv.action, 'wait');
	assert.equal(adv.waitFor.grade === 'perfect' || adv.waitFor.good, true);

	// Wasting energy past 100 blocks the wait
	adv = TM.adviseThrow({ a: 2, b: 5, myCd: 0, oppCd: 5, energy: 98, gain: 8, cost: 55, maxWait: 3 });
	assert.equal(adv.action, 'throw');
	assert.match(adv.reason, /wastes/);

	// A Fast Move that would knock you out before the window blocks the wait (their 2-turn move registers next turn)
	const slow = { a: 3, b: 4, myCd: 0, oppCd: 4, energy: 40, gain: 4, cost: 35, maxWait: 3 };
	assert.equal(TM.adviseThrow(slow).action, 'wait');
	adv = TM.adviseThrow(Object.assign({}, slow, { danger: { hp: 5, oppFastDamage: 5, oppDuration: 4 } }));
	assert.equal(adv.action, 'throw');
	assert.match(adv.reason, /knocked out/);

	// Already good: throw
	adv = TM.adviseThrow({ a: 2, b: 5, myCd: 0, oppCd: 2, energy: 60, gain: 8, cost: 55 });
	assert.equal(adv.action, 'throw');
	assert.equal(adv.now.grade, 'perfect');
});

test('leakValue converts free turns to opponent energy and damage', () => {
	const v = TM.leakValue(2, 9, 4, 8);
	assert.equal(v.fastMoves, 0.5);
	assert.equal(v.energy, 4.5);
	assert.equal(v.damage, 4);
});

test('an opponent with no Fast Move in flight (rho 0) is graded idle, not perfect', () => {
	const g = TM.gradeThrow(0, 5);
	assert.equal(g.grade, 'idle');
	assert.equal(g.freeTurns, 0);
	assert.equal(g.tempoShift, -1);
});

test('adviseThrow will not wait into a Charged Move that could knock you out', () => {
	const base = { a: 2, b: 5, myCd: 0, oppCd: 5, energy: 60, gain: 8, cost: 55, maxWait: 3 };
	// Safe against Fast Moves alone...
	assert.equal(TM.adviseThrow(Object.assign({}, base, { danger: { hp: 50, oppFastDamage: 5, oppDuration: 5, oppBurst: 0 } })).action, 'wait');
	// ...but not if they could also have a 60 damage Charged Move ready
	const adv = TM.adviseThrow(Object.assign({}, base, { danger: { hp: 50, oppFastDamage: 5, oppDuration: 5, oppBurst: 60 } }));
	assert.equal(adv.action, 'throw');
	assert.match(adv.reason, /knocked out/);
});

test('landingsBefore counts Fast Moves that register before the throw turn only', () => {
	// They just tapped a 5-turn move (cd 5): it registers when cd hits 1, 4 turns from now
	assert.equal(TM.landingsBefore(5, 5, 4), 0);   // registers on turn 4 itself: not before
	assert.equal(TM.landingsBefore(5, 5, 5), 1);
	// next tap at turn 5 registers at turn 9
	assert.equal(TM.landingsBefore(5, 5, 9), 1);
	assert.equal(TM.landingsBefore(5, 5, 10), 2);
	// 1-turn move registers every turn it's tapped
	assert.equal(TM.landingsBefore(1, 1, 4), 3);
	// move that registers this turn (cd 1) is already behind us
	assert.equal(TM.landingsBefore(1, 3, 2), 0);
});

test('a lethal Fast Move landing on the throw turn does not block waiting for that window', () => {
	// 5-turn opponent just tapped. Waiting lands you on a perfect throw as their move registers on that very turn.
	const adv = TM.adviseThrow({ a: 2, b: 5, myCd: 0, oppCd: 5, energy: 60, gain: 8, cost: 55, maxWait: 3,
		danger: { hp: 5, oppFastDamage: 5, oppDuration: 5, oppBurst: 0 } });
	// The first good window has their move registering at the throw turn, which the Charged Move beats
	assert.equal(adv.action, 'wait');
	// but a fatal landing strictly before the window still blocks it
	const blocked = TM.adviseThrow({ a: 5, b: 2, myCd: 0, oppCd: 1, energy: 60, gain: 4, cost: 35, maxWait: 3,
		danger: { hp: 5, oppFastDamage: 5, oppDuration: 2, oppBurst: 0 } });
	assert.equal(blocked.action, 'throw');
});
