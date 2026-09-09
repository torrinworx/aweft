// An administrator's module. It says so with one word, and the application's gate is what
// reads that word; this module checks nobody's identity, the way no module in this stack does.

import type { ModuleProps } from '@aweftjs/modules';

export const deps = ['app/Log'];

export default ({ imports }: ModuleProps) => {
	const log = imports.Log as { note(line: string): void };
	return {
		admin: true,
		call: () => 'the board was wiped',
		stop: () => { log.note('app/Wipe'); },
	};
};
