// The table behind `docs/security.md`, and the check that keeps it honest (design 270).
//
// One row per ASVS 5.0 requirement at level 1 or 2: who owns it, and the check or the pattern
// that meets it. A row that says the stack owns a requirement names the case that proves it, and
// the case has to exist; a case that cites a requirement has to be in the table under `stack`.

/** One line of the table. */
export interface SecurityRow {
	readonly id: string;
	readonly level: string;
	readonly owner: string;
	readonly check: string;
}

/** One case of the suite, as much of it as the table needs. */
export interface SecurityCase {
	readonly name: string;
	readonly requirements: readonly string[];
}

/** Whether a file holds what a row names: a test of that title, or a document section under that heading. */
export type TestExists = (file: string, text: string, kind: 'test' | 'doc') => boolean;

const OWNERS = new Set(['stack', 'application', 'operator', 'none']);
const ID = /^V\d+\.\d+\.\d+$/;

/**
 * The table, from the CSV text: a header line `id,level,owner,check`, then one row per line.
 * The check column may carry commas; the first three commas split the row.
 *
 * Params:
 *   text: the file's text
 *
 * Returns: the rows, in file order. A blank line is skipped.
 *
 * Example:
 *   parseSecurityTable(readFileSync('docs/security/asvs.csv', 'utf8'));
 */
export const parseSecurityTable = (text: string): SecurityRow[] => {
	const lines = text.split('\n').map((line) => line.trimEnd()).filter((line) => line !== '');
	const [header, ...rest] = lines;
	if (header !== 'id,level,owner,check') throw new Error(`the table starts with ${JSON.stringify(header)} rather than id,level,owner,check`);
	return rest.map((line) => {
		const [id = '', level = '', owner = '', ...check] = line.split(',');
		return { id: id.trim(), level: level.trim(), owner: owner.trim(), check: check.join(',').trim() };
	});
};

/**
 * Every way the table and the suite could disagree.
 *
 * Params:
 *   rows: the table
 *   cases: the suite's cases, by name and the requirements each cites
 *   testExists: answers whether `test: <file>#<title>` names a test that is there
 *
 * Returns: one line per problem, empty when the table holds: an id that is not `Vn.n.n` or
 * appears twice; a level that is not 1 or 2; an owner that is not one of the four words; an
 * empty check; a `stack` row whose check is not `suite: <name>` naming a case, `test:
 * <file>#<title>` naming a test that exists, or `doc: <file>#<heading>` naming a section that
 * exists; a case citing an id the table lacks or does not mark `stack`.
 *
 * Example:
 *   const problems = checkSecurityTable(rows, securityChecks({ gate: open }), exists);
 */
export const checkSecurityTable = (rows: readonly SecurityRow[], cases: readonly SecurityCase[], testExists: TestExists): string[] => {
	const problems: string[] = [];
	const seen = new Set<string>();
	const names = new Set(cases.map((c) => c.name));
	const owners = new Map<string, string>();
	rows.forEach((row, at) => {
		const line = `row ${String(at + 2)} (${row.id || 'no id'})`;
		if (!ID.test(row.id)) problems.push(`${line}: the id is not of the form V1.2.3`);
		if (seen.has(row.id)) problems.push(`${line}: the id appears twice`);
		seen.add(row.id);
		owners.set(row.id, row.owner);
		if (row.level !== '1' && row.level !== '2') problems.push(`${line}: the level is ${JSON.stringify(row.level)}, not 1 or 2`);
		if (!OWNERS.has(row.owner)) problems.push(`${line}: the owner is ${JSON.stringify(row.owner)}, not stack, application, operator or none`);
		if (row.check === '') problems.push(`${line}: the check is empty; say what meets it, or why it does not apply`);
		if (row.owner !== 'stack') return;
		if (row.check.startsWith('suite: ')) {
			const name = row.check.slice('suite: '.length);
			if (!names.has(name)) problems.push(`${line}: no case of securityChecks() is named ${JSON.stringify(name)}`);
		} else if (row.check.startsWith('test: ') || row.check.startsWith('doc: ')) {
			const kind = row.check.startsWith('test: ') ? 'test' : 'doc';
			const rest = row.check.slice(kind.length + 2);
			const at = rest.indexOf('#');
			const file = at < 0 ? rest : rest.slice(0, at);
			const text = at < 0 ? '' : rest.slice(at + 1);
			if (at < 0 || text === '' || !testExists(file, text, kind)) {
				problems.push(kind === 'test'
					? `${line}: no test in ${file} is titled ${JSON.stringify(text)}`
					: `${line}: no section of ${file} is headed ${JSON.stringify(text)}`);
			}
		} else {
			problems.push(`${line}: a stack row names its check as suite: <case>, test: <file>#<title> or doc: <file>#<heading>`);
		}
	});
	for (const c of cases) {
		for (const id of c.requirements) {
			const owner = owners.get(id);
			if (owner === undefined) problems.push(`the case ${JSON.stringify(c.name)} cites ${id}, which the table does not have`);
			else if (owner !== 'stack') problems.push(`the case ${JSON.stringify(c.name)} cites ${id}, which the table gives to ${owner}`);
		}
	}
	return problems;
};
