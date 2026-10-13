import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { hooks } = JSON.parse(fs.readFileSync(path.join(root, 'tests/academy/hooks.json'), 'utf8'));

for (const hook of hooks) {
	test(`hook intact: ${hook.file}`, () => {
		const text = fs.readFileSync(path.join(root, hook.file), 'utf8');
		const lost = hook.contains.filter(s => !text.includes(s));
		assert.deepEqual(lost, [], `${hook.file} lost ${lost.length} Academy hook anchor(s) (${hook.why}). Re-apply them after the merge.`);
	});
}

test('src/data is entirely upstream-owned (Academy files live elsewhere)', () => {
	// The data sync restores src/data from upstream, so nothing of ours may live there
	const own = fs.readdirSync(path.join(root, 'src/data')).filter(f => /academy/i.test(f));
	assert.deepEqual(own, []);
});
