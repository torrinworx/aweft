// The security table check, against tables written here so the expected answers are fixed by
// this file. What it does over the real table is `npm run security`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { checkSecurityTable, parseSecurityTable } from '../src/security-table.ts';
import type { SecurityCase } from '../src/security-table.ts';

const cases: SecurityCase[] = [
	{ name: 'the cookie is HttpOnly', requirements: ['V3.3.4'] },
	{ name: 'a foreign Origin is refused', requirements: ['V4.4.2', 'V3.5.1'] },
];

const exists = (file: string, text: string, kind: 'test' | 'doc'): boolean =>
	(kind === 'test' && file === 'packages/x/tests/y.test.ts' && text === 'the bound holds')
	|| (kind === 'doc' && file === 'docs/security.md' && text === 'The rules');

const good = [
	'id,level,owner,check',
	'V3.3.4,2,stack,suite: the cookie is HttpOnly',
	'V4.4.2,2,stack,suite: a foreign Origin is refused',
	'V3.5.1,1,stack,suite: a foreign Origin is refused',
	'V4.2.1,2,stack,test: packages/x/tests/y.test.ts#the bound holds',
	'V8.1.1,1,stack,doc: docs/security.md#The rules',
	'V6.2.4,1,application,check the password against a list, through refusePassword',
	'V12.2.1,1,operator,TLS at the proxy in front',
	'V10.1.1,2,none,no OAuth here',
].join('\n');

test('parse: the header is required, the first three commas split a row, and the check keeps its commas', () => {
	const rows = parseSecurityTable(`${good}\n`);
	assert.equal(rows.length, 8);
	assert.deepEqual(rows[5], { id: 'V6.2.4', level: '1', owner: 'application', check: 'check the password against a list, through refusePassword' });
	assert.throws(() => parseSecurityTable('id,owner\nV1.1.1,stack'), /starts with/);
});

test('a table whose every stack row names a case or a test that exists, and whose cases are all in it, has no problems', () => {
	assert.deepEqual(checkSecurityTable(parseSecurityTable(good), cases, exists), []);
});

for (const [what, line, expected] of [
	['a malformed id', 'V3.3,2,stack,suite: the cookie is HttpOnly', /row 10 \(V3.3\): the id is not of the form/],
	['a duplicate id', 'V3.3.4,2,stack,suite: the cookie is HttpOnly', /row 10 \(V3.3.4\): the id appears twice/],
	['a level that is not 1 or 2', 'V3.9.9,3,none,level three', /the level is "3"/],
	['an unknown owner', 'V3.9.9,2,vendor,someone else', /the owner is "vendor"/],
	['an empty check', 'V3.9.9,2,application,', /the check is empty/],
	['a stack row naming no case', 'V3.9.9,2,stack,suite: nothing is named this', /no case of securityChecks\(\) is named "nothing is named this"/],
	['a stack row naming a test that is not there', 'V3.9.9,2,stack,test: packages/x/tests/y.test.ts#a title nobody wrote', /no test in packages\/x\/tests\/y.test.ts is titled/],
	['a stack row naming a test with no title', 'V3.9.9,2,stack,test: packages/x/tests/y.test.ts', /no test in packages\/x\/tests\/y.test.ts is titled ""/],
	['a stack row naming a section that is not there', 'V3.9.9,2,stack,doc: docs/security.md#Nothing is headed this', /no section of docs\/security.md is headed "Nothing is headed this"/],
	['a stack row whose check is prose', 'V3.9.9,2,stack,the server does this', /a stack row names its check as suite/],
] as const) {
	test(`${what} is refused, naming the row`, () => {
		const problems = checkSecurityTable(parseSecurityTable(`${good}\n${line}`), cases, exists);
		assert.equal(problems.length, 1, problems.join('\n'));
		assert.match(problems[0]!, expected);
	});
}

test('a row is numbered by its line in the file, header included', () => {
	const problems = checkSecurityTable(parseSecurityTable(`${good}\nV3.9.9,2,stack,suite: nowhere`), cases, exists);
	assert.match(problems[0]!, /^row 10 \(V3\.9\.9\)/);
});

test('a case citing an id the table lacks, or gives to someone else, is a problem', () => {
	const citing: SecurityCase[] = [...cases, { name: 'a new case', requirements: ['V9.9.9', 'V6.2.4'] }];
	const problems = checkSecurityTable(parseSecurityTable(good), citing, exists);
	assert.deepEqual(problems, [
		'the case "a new case" cites V9.9.9, which the table does not have',
		'the case "a new case" cites V6.2.4, which the table gives to application',
	]);
});
