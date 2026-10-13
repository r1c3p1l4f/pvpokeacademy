import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TF = createRequire(import.meta.url)(path.join(here, '../../src/js/academy/TimingFeedback.js'));

function entry(over) {
	return Object.assign({
		turn: 20, actor: 0, moveName: 'Ice Punch', cost: 40, energyBefore: 48,
		oppCooldown: 1, oppFastTurns: 5, oppFastGain: 9, oppFastDamage: 10, oppFastName: 'Incinerate',
		myFastTurns: 2, myFastGain: 4, pokeName: 'Medicham', oppName: 'Talonflame',
		hp: 100, simultaneous: false
	}, over);
}

const HOLD_TIMING = { action: -1, move: null, agrees: false, waitTaps: 1, reasons: ['is optimizing move timing'] };
const THROW_SAME = { action: 0, move: { name: 'Ice Punch' }, agrees: true, waitTaps: null, reasons: ['uses Ice Punch because it has 2 turn(s) before it is KO\'d'] };

test('a last-turn throw is perfect and carries no engine verdict unless one was recorded', () => {
	const t = TF.grade(entry({ oppCooldown: 1 }));
	assert.equal(t.grade, 'perfect');
	assert.equal(t.engine, null);
	assert.match(TF.describe(t), /perfect/);
	assert.equal(TF.betterNext(t), '');
});

test('a sneak is flagged and valued; the engine says whether to wait', () => {
	const t = TF.grade(entry({ oppCooldown: 5, energyBefore: 40, engine: HOLD_TIMING }));
	assert.equal(t.grade, 'sneak');
	assert.equal(t.freeTurns, 3);
	// 3 free turns of a 5 turn move is 0.6 of a fast move: 5.4 energy, 6 damage
	assert.equal(t.leakEnergy, 5.4);
	assert.equal(t.leakDamage, 6);
	assert.equal(t.engine.holds, true);
	assert.equal(t.engine.waitTaps, 1);
	assert.match(TF.betterNext(t), /would have held here/);
	assert.match(TF.betterNext(t), /better timing/);
	assert.match(TF.betterNext(t), /after 1 more tap\./);
	assert.match(TF.describe(t), /sneak/);
});

test('a leak the engine would also throw into is reported as such, with its reason', () => {
	const t = TF.grade(entry({ oppCooldown: 4, energyBefore: 99, engine: THROW_SAME }));
	assert.equal(t.grade, 'bad');
	assert.equal(t.engine.agrees, true);
	assert.match(TF.betterNext(t), /throws here too/);
	assert.match(TF.betterNext(t), /knocked out/);
});

test('a clean throw the engine would have held still says so, and a different move is named', () => {
	const clean = TF.grade(entry({ oppCooldown: 2, engine: HOLD_TIMING }));
	assert.match(TF.betterNext(clean), /No free turns, but the simulator would still have held/);
	const other = TF.grade(entry({ oppCooldown: 4, engine: { action: 1, move: { name: 'Psychic' }, agrees: false, waitTaps: null, reasons: [] } }));
	assert.match(TF.betterNext(other), /would have thrown Psychic instead/);
});

test('simultaneous throws are not graded as leaks and are excluded from summaries', () => {
	const t = TF.grade(entry({ oppCooldown: 5, simultaneous: true }));
	assert.equal(TF.betterNext(t), '');
	assert.match(TF.describe(t), /priority/);
	const s = TF.summarize([t, TF.grade(entry({ oppCooldown: 2 }))]);
	assert.equal(s.you.total, 1);
	assert.equal(s.you.clean, 1);
});

test('summaries tally each side separately', () => {
	const list = [
		TF.grade(entry({ turn: 10, oppCooldown: 1 })),
		TF.grade(entry({ turn: 20, oppCooldown: 4 })),
		TF.grade(entry({ turn: 30, actor: 1, oppCooldown: 5 }))
	];
	const s = TF.summarize(list);
	assert.equal(s.you.total, 2);
	assert.equal(s.you.clean, 1);
	assert.equal(s.you.counts.bad, 1);
	assert.equal(s.you.freeTurns, 2);
	assert.equal(s.opp.counts.sneak, 1);
});

test('opponent throws are described from the player view', () => {
	const t = TF.grade(entry({ actor: 1, oppCooldown: 4 }));
	assert.match(TF.describe(t), /free turns? for you/);
	assert.equal(TF.betterNext(t), '');
});

test('an idle opponent is a clean throw with its own wording', () => {
	const t = TF.grade(entry({ oppCooldown: 0 }));
	assert.equal(t.grade, 'idle');
	assert.match(TF.describe(t), /wasn't in the middle of a Fast Move/);
	assert.equal(TF.summarize([t]).you.clean, 1);
});

test('every grade the grader can return has display info', () => {
	const grades = new Set();
	for (let rho = 0; rho <= 6; rho++) {
		for (let b = 1; b <= 5; b++) grades.add(TF.grade(entry({ oppCooldown: rho, oppFastTurns: b })).grade);
	}
	assert.ok(grades.has('idle') && grades.has('perfect') && grades.has('sneak'));
	for (const g of grades) {
		assert.ok(TF.GRADES[g] && TF.GRADES[g].css && TF.GRADES[g].label && TF.GRADES[g].icon, 'missing GRADES entry for ' + g);
	}
});
