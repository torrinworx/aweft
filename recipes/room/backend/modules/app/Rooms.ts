// app/Rooms: the module document a room loads its act from, the board a room writes to, and a
// call that answers who asked and what the board says.
//
// The act is written as JSX in `../../acts/app/Main.jsx` and turned into `h` calls here, once,
// when this module is built: a module document holds JavaScript, and a room compiles nothing
// (design 110). An application that stores agent-written modules runs the same transform when
// it stores them.

import { readFileSync } from 'node:fs';

import type { AuthContext } from '@aweftjs/auth';
import { transform } from '@aweftjs/build';
import { createObject } from '@aweftjs/core';
import type { ModuleProps } from '@aweftjs/modules';
import { type Connection, open } from '@aweftjs/server';
import type { Store } from '@aweftjs/store';

const ACT = new URL('../../acts/app/Main.jsx', import.meta.url);

export default async ({ store }: ModuleProps) => {
	const source = transform(readFileSync(ACT, 'utf8'), { filename: 'app/Main.jsx', defaultH: '@aweftjs/ui' }).code;
	const modules = createObject<Record<string, unknown>>({ 'app/Main': createObject({ source }) });

	const handle = await (store as Store).open('board:main');
	const board = handle.root as { title?: string; note?: string };
	board.title ??= 'the board';

	return {
		public: true,
		connection: ({ link }: Connection) => {
			// The room reads the module document through the page, and neither writes it.
			link.share('modules', modules, { accept: () => [{ code: 'read-only', message: 'the module document is written by its author, not by a page' }] });
			link.share('board', handle.root, open);
		},
		// What the room asks through the page: the page's identity is what the gate saw.
		call: (_args: unknown, context: AuthContext) => ({ user: context.user ?? null, note: board.note ?? null }),
		stop: async () => { await (store as Store).close(handle); },
	};
};
