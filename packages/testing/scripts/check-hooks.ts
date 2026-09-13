// The push hook is in place: git's hooks path names `.githooks`, which `npm install` at the
// root sets through the `prepare` script, and the hook there can run. A push with the hook
// missing is a push the gate never saw.
//
//   node packages/testing/scripts/check-hooks.ts

import { execFileSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');

let path = '';
try {
	path = execFileSync('git', ['config', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8' }).trim();
} catch {
	path = '';
}
if (path !== '.githooks') {
	console.error(`hooks: core.hooksPath is ${JSON.stringify(path)}, not .githooks; run npm install at the root, which sets it`);
	process.exit(1);
}
try {
	accessSync(join(root, '.githooks', 'pre-push'), constants.X_OK);
} catch {
	console.error('hooks: .githooks/pre-push is not there or not executable');
	process.exit(1);
}
console.log('hooks: .githooks/pre-push runs the gate and the audit before every push');
