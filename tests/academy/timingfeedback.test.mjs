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

test('a last-turn throw is perfect and has no advice', () => {
	const t = TF.grade(entry({ oppCooldown: 1 }));
	assert.equal(t.grade, 'perfect');
	assert.equal(t.advice, null);
	assert.match(TF.describe(t), /perfect/);
	assert.equal(TF.betterNext(t), '');
});

test('a sneak is flagged, valued, and gets a wait suggestion', () => {
	const t = TF.grade(entry({ oppCooldown: 5, energyBefore: 40 }));
	assert.equal(t.grade, 'sneak');
	assert.equal(t.freeTurns, 3);
	// 3 free turns of a 5 turn move is 0.6 of a fast move: 5.4 energy, 6 damage
	assert.equal(t.leakEnergy, 5.4);
	assert.equal(t.leakDamage, 6);
	assert.equal(t.advice.action, 'wait');
	assert.match(TF.betterNext(t), /Next time: tap \d+ more Fast Moves? first/);
	assert.match(TF.describe(t), /sneak/);
});

test('waiting advice is withheld when it would waste energy', () => {
	const t = TF.grade(entry({ oppCooldown: 4, energyBefore: 99 }));
	assert.equal(t.grade, 'bad');
	assert.equal(t.advice.action, 'throw');
	assert.match(TF.betterNext(t), /No better window/);
});

test('simultaneous throws are not graded as leaks and are excluded from summaries', () => {
	const t = TF.grade(entry({ oppCooldown: 5, simultaneous: true }));
	assert.equal(t.advice, null);
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
