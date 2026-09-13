// The security table against the suite (design 270): every `stack` row names a case or a test
// that exists, and every case cites a requirement the table gives to the stack.
//
//   node packages/testing/scripts/check-security.ts

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { open } from '@aweftjs/server';

import { checkSecurityTable, parseSecurityTable, securityChecks } from '../src/index.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const table = join(root, 'docs', 'security', 'asvs.csv');

// A test is there when its file holds its title as written, quoted in one of the two spellings a
// test name takes; a section is there when its file holds the heading as a markdown heading.
const testExists = (file: string, text: string, kind: 'test' | 'doc'): boolean => {
	const path = join(root, file);
	if (!existsSync(path)) return false;
	const held = readFileSync(path, 'utf8');
	if (kind === 'doc') return new RegExp(`^#{1,4} ${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(held);
	return held.includes(`'${text.replace(/'/g, '\\\'')}'`) || held.includes(`\`${text}\``);
};

const rows = parseSecurityTable(readFileSync(table, 'utf8'));
const problems = checkSecurityTable(rows, securityChecks({ gate: open }), testExists);
if (problems.length > 0) {
	for (const line of problems) console.error(`docs/security/asvs.csv: ${line}`);
	console.error(`\n${String(problems.length)} problem(s) between the table and the suite.`);
	process.exit(1);
}

const owned = rows.filter((row) => row.owner === 'stack').length;
console.log(`security: ${String(rows.length)} requirements in the table, ${String(owned)} owned by the stack, every one backed`);
