// An administrator's module. It says what it needs with one word, and the battery's gate reads
// it against the names the person holds; this module checks nobody's identity, the way no
// module in this stack does.

import type { ModuleProps } from '@aweftjs/modules';

export const deps = ['app/Log'];

export default ({ imports }: ModuleProps) => {
	const log = imports.Log as { note(line: string): void };
	return {
		needs: 'admin',
		call: () => 'the board was wiped',
		stop: () => { log.note('app/Wipe'); },
	};
};
