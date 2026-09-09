// The office board: one document, opened once and held for as long as this module is loaded,
// shared with every connection the gate allows, under the rules module's `accept`.
//
// The document is opened here, in the factory, not in the boot file. That is the whole point
// of a module: what it holds, it opens, and what it opens, it closes in `stop`.

import type { ModuleProps } from '@aweftjs/modules';
import type { Connection } from '@aweftjs/server';
import type { Store } from '@aweftjs/store';
import type { Commit, WireReason } from '@aweftjs/sync';

export const deps = ['app/Rules', 'app/Log'];

export default async ({ imports, store }: ModuleProps) => {
	const rules = imports.Rules as { whyNot(commit: Commit): WireReason[] };
	const log = imports.Log as { note(line: string): void };
	const handle = await (store as Store).open('board:office');

	return {
		public: true,
		connection: ({ link }: Connection) => {
			link.share('board', handle.root, { accept: (commit: Commit) => rules.whyNot(commit) });
		},
		stop: async () => {
			log.note('app/Board');
			await (store as Store).close(handle);
		},
	};
};
