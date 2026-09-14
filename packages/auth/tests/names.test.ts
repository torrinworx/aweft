// Names: the check the server's gate and the page both run (design 289).

import test from 'node:test';
import assert from 'node:assert/strict';

import { holds } from '../src/index.ts';

test('holds is true for the name itself, a dotted parent of it, or everything, and false otherwise', () => {
	assert.equal(holds(['posts.delete'], {}, 'posts.delete'), true);
	assert.equal(holds(['posts'], {}, 'posts.delete'), true, 'a parent covers what is under it');
	assert.equal(holds(['products.abc123'], {}, 'products.abc123.read'), true, 'one product covers its own features');
	assert.equal(holds(['products.abc123'], {}, 'products.def456.read'), false, 'and not another product');
	assert.equal(holds(['products.abc'], {}, 'products.abc123'), false, 'a prefix of the text is not a parent');
	assert.equal(holds(['posts.delete'], {}, 'posts'), false, 'a child does not cover its parent');
	assert.equal(holds(['*'], {}, 'anything.at.all'), true);
	assert.equal(holds([], {}, '*'), false, 'nobody holds everything by default');
	assert.equal(holds(['admin'], {}, 'admin.super'), true, 'admin covers admin.super');
	assert.equal(holds(['admin.super'], {}, 'admin'), false, 'admin.super does not cover admin');
});

test('holds follows the table transitively, keyed by the exact name held, and a cycle in it ends', () => {
	const implies = { admin: ['moderator', 'reports'], moderator: ['posts.delete', 'admin'], member: ['products.read'] };
	assert.equal(holds(['admin'], implies, 'posts.delete'), true, 'two steps through the table');
	assert.equal(holds(['admin'], implies, 'reports.monthly'), true, 'an implied name covers what is under it');
	assert.equal(holds(['moderator'], implies, 'reports'), true, 'round the cycle');
	assert.equal(holds(['member'], implies, 'posts.delete'), false);
	assert.equal(holds(['admin.super'], implies, 'posts.delete'), false, 'the table is keyed by the exact name held');
	assert.equal(holds(['member'], { member: ['*'] }, 'anything'), true);
	assert.equal(holds(['toString'], {}, 'constructor'), false, 'a name that is an object property is not in an empty table');
	assert.equal(holds(['constructor'], { constructor: ['x'] } as Record<string, string[]>, 'x'), true);
});
