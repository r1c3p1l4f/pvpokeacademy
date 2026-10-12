import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SS = createRequire(import.meta.url)(path.join(here, '../../src/js/academy/SwapScenarios.js'));

test('similarity is a weakness overlap', () => {
	assert.equal(SS.similarity(['fire', 'ice'], ['fire', 'ice']), 1);
	assert.equal(SS.similarity(['fire'], ['water']), 0);
	assert.equal(SS.similarity(['fire', 'ice', 'rock'], ['fire', 'ice', 'steel']), 0.5);
	assert.equal(SS.similarity([], []), 1);
});

test('team shape labels ABA, ABB and ABC from weaknesses', () => {
	const fire = ['water', 'ground', 'rock'];
	const grass = ['fire', 'ice', 'flying', 'bug', 'poison'];
	const dark = ['fighting', 'bug', 'fairy'];
	const nearFire = ['water', 'ground'];
	assert.equal(SS.shape([fire, grass, nearFire]), 'ABA');
	assert.equal(SS.shape([fire, grass, grass]), 'ABB');
	assert.equal(SS.shape([fire, grass, dark]), 'ABC');
	assert.equal(SS.shape([fire, nearFire, grass]), 'AAB');
	assert.equal(SS.shape([fire, fire, fire]), 'AAA');
});

const bench = (a, b, sa = 90, sb = 88) => [{ id: 'x', rating: a, score: sa }, { id: 'y', rating: b, score: sb }];

test('decide: stay when winning', () => {
	assert.deepEqual([SS.decide(700, bench(800, 300)).action, SS.decide(700, bench(800, 300)).rule], ['stay', 'win']);
	assert.equal(SS.decide(700, bench(800, 300)).confidence, 'clear');
});

test('decide: a narrow win stays but is contested', () => {
	const d = SS.decide(520, bench(800, 300));
	assert.equal(d.action, 'stay');
	assert.equal(d.confidence, 'contested');
});

test('decide: swap to the only answer', () => {
	const d = SS.decide(380, bench(700, 350));
	assert.equal(d.action, 'swap');
	assert.deepEqual(d.targets, ['x']);
	assert.equal(d.rule, 'one-answer');
	assert.equal(d.confidence, 'clear');
});

test('decide: with two near-equal answers spend the weaker closer first and accept both', () => {
	const d = SS.decide(350, [{ id: 'strong', rating: 700, score: 95 }, { id: 'weak', rating: 680, score: 85 }]);
	assert.equal(d.rule, 'two-answers');
	assert.deepEqual(d.targets, ['weak', 'strong']);
});

test('decide: a much better answer is the only answer', () => {
	const d = SS.decide(350, [{ id: 'strong', rating: 800, score: 95 }, { id: 'weak', rating: 600, score: 85 }]);
	assert.equal(d.rule, 'one-answer');
	assert.deepEqual(d.targets, ['strong']);
});

test('decide: sacrifice when nothing beats it', () => {
	const d = SS.decide(300, bench(400, 350));
	assert.equal(d.action, 'stay');
	assert.equal(d.rule, 'sacrifice');
	assert.equal(d.confidence, 'clear');
	// but a near-miss on the bench makes it contested
	assert.equal(SS.decide(300, bench(490, 350)).confidence, 'contested');
});
