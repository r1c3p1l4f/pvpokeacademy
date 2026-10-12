import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ER = createRequire(import.meta.url)(path.join(here, '../../src/js/academy/EngineReasons.js'));
const actionLogic = fs.readFileSync(path.join(here, '../../src/js/battle/actions/ActionLogic.js'), 'utf8');

// Pull every battle.logDecision(...) call out of ActionLogic.js, including ones that span several lines,
// and rebuild a sample of the message it would log by filling each expression with a stand-in value.
function logDecisionSamples(src) {
	const samples = [];
	let i = 0;

	while ((i = src.indexOf('battle.logDecision(', i)) > -1) {
		const start = i + 'battle.logDecision('.length;
		let depth = 1, k = start, quote = null;

		while (depth > 0 && k < src.length) {
			const c = src[k];
			if (quote) {
				if (c === '\\') k++;
				else if (c === quote) quote = null;
			} else if (c === '"' || c === "'" || c === '`') quote = c;
			else if (c === '(') depth++;
			else if (c === ')') depth--;
			k++;
		}

		// argument list is (pokemon, message); drop the first argument
		const args = src.slice(start, k - 1);
		const comma = args.indexOf(',');
		const message = args.slice(comma + 1).trim();
		const pieces = message.split('+').map(p => p.trim());
		const text = pieces.map(p => {
			const lit = /^"((?:[^"\\]|\\.)*)"$/.exec(p) || /^'((?:[^'\\]|\\.)*)'$/.exec(p);
			return lit ? lit[1] : 'Foo'; // an expression: stand in a value
		}).join('');
		const line = src.slice(0, i).split('\n').length;

		samples.push({ line, text: text.replace(/\s+/g, ' ').trim() });
		i = k;
	}

	return samples;
}

test('every reason the engine can log is recognized (guards against upstream rewording)', () => {
	const samples = logDecisionSamples(actionLogic);
	assert.ok(samples.length >= 18, 'expected to find the engine\'s logDecision calls, found ' + samples.length);

	const unrecognized = samples.filter(s => !ER.match(s.text));
	assert.deepEqual(unrecognized, [], 'ActionLogic.js logs a reason EngineReasons no longer recognizes. Add or update a rule.\n' +
		unrecognized.map(u => `  line ${u.line}: ${u.text}`).join('\n'));
});

test('a timing hold reads as a hold with a timing headline', () => {
	const e = ER.explain(['has Infinity turns to live', 'is optimizing move timing'], 'you');
	assert.equal(e.hold, true);
	assert.equal(e.headlineId, 'timing');
	assert.match(e.headline, /better timing/);
});

test('saving for a bigger move names the move', () => {
	const e = ER.explain(['uses a fast move because it has no energy for Hydro Pump'], 'you');
	assert.equal(e.hold, true);
	assert.match(e.headline, /building up to Hydro Pump/);
});

test('a plan reads in order: X now, then Y, then Z', () => {
	const e = ER.explain([
		'uses Ice Beam because it thinks that using 2 moves afterwards is the best plan.',
		'wants to use Blizzard after it uses Ice Beam',
		'wants to use Surf after it uses Blizzard'
	], 'you');
	assert.equal(e.hold, false);
	assert.equal(e.headlineId, 'plan');
	assert.match(e.headline, /Ice Beam, then Blizzard, then Surf/);
});

test('KO-or-farm keeps the engine\'s own ambiguity', () => {
	const e = ER.explain(["uses Psychic at turn 14 because it KO's or it wants to farm down afterwards"], 'you');
	assert.match(e.headline, /knocks them out, or sets up a farm-down/);
});

test('the last decisive line is the headline, earlier context becomes notes', () => {
	const e = ER.explain([
		"doesn't use Ice Beam because it wants to bait",
		'wants to farm down',
		"uses Ice Punch at turn 9 because it KO's or it wants to farm down afterwards"
	], 'you');
	assert.equal(e.headlineId, 'ko-or-farm');
	assert.deepEqual(e.notes.map(n => n.id), ['bait', 'farm-down']);
});

test('bait mentions the player\'s own Bait Shields setting but not for the opponent', () => {
	const you = ER.explain(["doesn't use Ice Beam because it wants to bait", 'is optimizing move timing'], 'you');
	const they = ER.explain(["doesn't use Ice Beam because it wants to bait", 'is optimizing move timing'], 'they');
	assert.match(you.notes[0].text, /Bait Shields setting/);
	assert.doesNotMatch(they.notes[0].text, /setting/);
});

test('wording switches between you and they', () => {
	assert.match(ER.explain(['is optimizing move timing'], 'you').headline, /^Waiting/);
	assert.match(ER.explain(['is optimizing move timing'], 'they').headline, /^They're/);
});

test('unrecognized lines are reported, never explained wrongly', () => {
	const e = ER.explain(['does something new that nothing matches'], 'you');
	assert.equal(e.headline, '');
	assert.equal(e.hold, null);
	assert.deepEqual(e.unknown, ['does something new that nothing matches']);
});

test('internal and informational lines do not produce a headline', () => {
	const e = ER.explain(['has 4 turns to live', 'considered too many states, likely an infinite loop'], 'you');
	assert.equal(e.headline, '');
	assert.deepEqual(e.unknown, []);
});
