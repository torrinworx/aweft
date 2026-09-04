/* eslint-disable no-console */
// The proof for @aweftjs/sandbox: a hostile module stays contained while a benign one does
// real work through granted names, and the same room shape runs behind three different walls.
//
// The job: an application lets people drop in report modules an agent wrote. A report may
// read the day's rows through a granted `data/Rows` and may compose another report module,
// but it may not touch the filesystem, the network, or the application's own state. One
// report is benign and is summarized; one is hostile and is contained; a plan change revokes
// a name mid-run; an edit to a report reloads it in place.
//
// Run: node examples/sandbox/main.ts

import { createArray, createObject } from '@aweftjs/core';
import { createSandbox, inProcess } from '@aweftjs/sandbox';
import { child } from '@aweftjs/sandbox/node';
import type { Runner, Sandbox } from '@aweftjs/sandbox';

let checks = 0;
let failed = 0;
const check = (ok: boolean, what: string): void => {
	checks += 1;
	if (!ok) failed += 1;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
const rejects = async (reason: string, what: string, run: () => Promise<unknown>): Promise<void> => {
	try {
		await run();
		check(false, `${what} (it answered instead of ${reason})`);
	} catch (error) {
		check((error as { reason?: string }).reason === reason, `${what} (${(error as { reason?: string }).reason})`);
	}
};
const until = async (what: string, ok: () => boolean | Promise<boolean>): Promise<void> => {
	for (let i = 0; i < 500; i++) {
		if (await ok()) return;
		await new Promise((done) => setTimeout(done, 5));
	}
	check(false, `timed out waiting for ${what}`);
};

// The reports an agent wrote, as source in a document. `daily/Summary` composes `lib/Format`,
// a report module of its own; `evil/Exfiltrate` tries everything a room must not be able to do.
const reports = (): Record<string, unknown> => createObject<Record<string, unknown>>({
	'lib/Format': createObject({ source: `export default () => ({ bullet: (line) => '- ' + line });` }),
	'daily/Summary': createObject({ source: `
		export const deps = ['data/Rows', 'lib/Format'];
		export default ({ imports }) => ({
			run: async (day) => {
				const rows = await imports.Rows.forDay(day);
				return rows.map((r) => imports.Format.bullet(r.label + ': ' + r.value)).join('\\n');
			},
		});` }),
	'evil/Exfiltrate': createObject({ source: `
		export default () => ({
			ransack: async () => {
				const out = {};
				const attempt = async (name, fn) => { try { out[name] = await fn(); } catch (e) { out[name] = (e.code ?? e.name); } };
				await attempt('read /etc/passwd', async () => (await import('node:fs')).readFileSync('/etc/passwd', 'utf8').length);
				await attempt('spawn', async () => (await import('node:child_process')).execSync('id').toString());
				await attempt('eval', () => new Function('return process.env')());
				return out;
			},
			smuggle: () => ({ looksFine: true, but: () => 'a function' }),
		});` }),
});

// What the application grants: a reader over the day's rows, and nothing else.
const rowsForDay = { forDay: (day: string) => [{ label: 'signups', value: day === 'mon' ? 12 : 3 }, { label: 'churn', value: 1 }] };

const scenario = async (label: string, runner: Runner, contained: boolean): Promise<void> => {
	console.log(`\n${label}`);
	const modules = reports();
	const grants = createArray<string>(['data/Rows']);
	const applied: string[] = [];
	const sandbox: Sandbox = await createSandbox({
		runner, modules, grants, props: { site: 'reports' }, follow: true, limits: { callMs: 10000 },
		handlers: { applied: (name, action) => applied.push(`${name} ${action}`) },
	});
	try {
		sandbox.expose('data/Rows', rowsForDay);

		const { 'daily/Summary': summary } = await sandbox.load(['daily/Summary']);
		check(await summary!.run!('mon') === '- signups: 12\n- churn: 1',
			'a report read the granted rows and composed another report module to format them');

		const { 'evil/Exfiltrate': evil } = await sandbox.load(['evil/Exfiltrate']);
		if (contained) {
			// Behind a wall, every reach out of the room is denied, so the result is all error
			// codes and crosses as data. The point is that not one of them says a number or a
			// captured value.
			const ransacked = await evil!.ransack!() as Record<string, string>;
			const reached = Object.entries(ransacked).filter(([, v]) => v === undefined || /^\d+$/.test(String(v)) || String(v).includes('uid='));
			check(reached.length === 0, `the hostile report reached nothing behind the wall: ${JSON.stringify(ransacked)}`);
		} else {
			// In process there is no wall: the module runs with the process's own privileges, and
			// its reaches SUCCEED. That is what the runner claims, and why it is the trusted case.
			console.log('  --   in process there is no isolation, so this report is NOT contained (by design)');
		}
		await rejects('not-data', 'a function it tried to smuggle out in a result was refused by name, in every runner', () => evil!.smuggle!());

		// The plan changes: this tenant loses row access. The next call is refused.
		grants.splice(grants.indexOf('data/Rows'), 1);
		await rejects('refused', 'a name revoked mid-run refuses from the next call', () => summary!.run!('tue'));
		grants.push('data/Rows');
		check(await summary!.run!('tue') === '- signups: 3\n- churn: 1', 'and granting it again lets the report run again');

		// An agent revises the summary. It reloads in place, and the new source is what runs.
		(modules['daily/Summary'] as { source: string }).source = `
			export const deps = ['data/Rows'];
			export default ({ imports }) => ({ run: async (day) => 'total ' + (await imports.Rows.forDay(day)).reduce((n, r) => n + r.value, 0) });`;
		await until('the reload', () => applied.includes('daily/Summary reloaded'));
		check(await (await sandbox.load(['daily/Summary']))['daily/Summary']!.run!('mon') === 'total 13',
			'an edited report reloaded in place and the new source is what ran');
	} finally {
		await sandbox.stop();
	}
	await rejects('closed', 'and after the room stopped, it answers nothing', () => sandbox.loaded());
};

console.log('@aweftjs/sandbox: a room for modules the host does not trust');
await scenario('in process (no isolation: the trusted case)', inProcess(), false);
await scenario('a child process under the permission model', child({ limits: { memoryMB: 128 } }), true);

console.log(`\n${checks - failed}/${checks} checks passed`);
if (failed > 0) process.exitCode = 1;
