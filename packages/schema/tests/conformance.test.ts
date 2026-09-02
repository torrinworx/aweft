// Every commit in the normative corpus, through the validator.
//
// Two things are checked at once. That a policy which grants the paths a fixture touches
// accepts it and one that grants nothing refuses it, so the corpus exercises authority rather
// than only encoding. And that the resident index agrees with a from-scratch rebuild of the
// same history, which is the oracle G1a required: the index answers by walking up parent
// pointers, the oracle answers by walking down a replayed edge map, and they share no code.
//
// The rebuild spells a slot the way the conformance harness does, so this also pins the
// index's own spelling of a path step to the one the fixtures are written in. If those two
// ever disagreed, every path here would differ by a step.

import test from 'node:test';
import assert from 'node:assert/strict';

import { bytesFromHex, decodeCommit, idFromText } from '@aweftjs/codec';
import type { Commit } from '@aweftjs/codec';
import { loadFixtures } from '@aweftjs/testing';

import { REST, createIndex, pathOf, record, validate } from '../src/index.ts';
import type { Policy, Reason } from '../src/index.ts';

import { commitFor } from './documents.ts';
import { pathsFrom } from './oracle.ts';

const fixtures = loadFixtures(new URL('../../../spec/fixtures/', import.meta.url));

const everything: Policy = [{ effect: 'allow', path: [REST] }];
const nothing: Policy = [];
const actor = { id: 'conformance' };

test('the corpus is loaded', () => {
	assert.ok(fixtures.length >= 16, `${fixtures.length} fixtures`);
});

for (const fixture of fixtures) {
	test(`${fixture.name}: authority tracks the paths the commits reach`, () => {
		const index = createIndex(idFromText(fixture.initial.root));
		const history: Commit[] = [];

		const seed = commitFor(fixture.initial);
		if (seed.deltas.length > 0) {
			record(index, seed);
			history.push(seed);
		}

		for (const stated of fixture.commits) {
			const commit = decodeCommit(bytesFromHex(stated.bytes));

			const open = validate(commit, { index, policy: everything, actor });
			assert.equal(open.ok, true, `${fixture.name}: a grant of everything refused a valid commit`);

			const closed = validate(commit, { index, policy: nothing, actor });
			assert.equal(closed.ok, false, `${fixture.name}: a grant of nothing accepted a commit`);
			if (!closed.ok) {
				assert.equal(closed.reasons.length, commit.deltas.length);
				for (const reason of closed.reasons) {
					assert.equal(reason.code, 'unauthorized');
					assert.ok(reason.path !== undefined, 'a refused delta that resolved should name its path');
				}
			}

			record(index, commit);
			history.push(commit);

			const expected = pathsFrom(fixture.initial.root, history);
			for (const [id, path] of expected) {
				assert.deepEqual(
					pathOf(index, idFromText(id)),
					path,
					`${fixture.name}: the index and a rebuild disagree about where ${id} lives`,
				);
			}
		}

		// Everything the final document holds is reachable, and the index says so.
		for (const id of Object.keys(fixture.final.observables)) {
			assert.notEqual(
				pathOf(index, idFromText(id)),
				undefined,
				`${fixture.name}: ${id} is in the final document and the index cannot place it`,
			);
		}
	});

	test(`${fixture.name}: denying one path it touches refuses it`, () => {
		const index = createIndex(idFromText(fixture.initial.root));
		const seed = commitFor(fixture.initial);
		if (seed.deltas.length > 0) record(index, seed);

		for (const stated of fixture.commits) {
			const commit = decodeCommit(bytesFromHex(stated.bytes));
			const open = validate(commit, { index, policy: everything, actor });
			assert.equal(open.ok, true);

			// Take a path the commit actually lands on, from the refusal a closed policy gives,
			// rather than restating one here: the point is that authority follows the commit.
			const closed = validate(commit, { index, policy: nothing, actor });
			assert.equal(closed.ok, false);
			const target = (closed as { reasons: readonly Reason[] }).reasons[0]!.path!;

			const carved: Policy = [
				{ effect: 'allow', path: [REST] },
				{ effect: 'deny', path: target },
			];
			const verdict = validate(commit, { index, policy: carved, actor });
			assert.equal(verdict.ok, false, `${fixture.name}: denying ${target.join('/')} did not refuse it`);
			if (!verdict.ok) {
				assert.deepEqual(verdict.reasons.map((r) => r.path), [target]);
			}

			record(index, commit);
		}
	});
}
