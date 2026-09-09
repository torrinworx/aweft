// notes/Page: the act behind the gate. Its factory is where the page decides it may be seen.

import { observer } from '@aweftjs/core';
import { h } from '@aweftjs/ui';

import { trace } from '../trace.ts';
import type { Current } from './Current.ts';
import type { Gate } from './Gate.ts';

export const deps = ['site/Gate', 'notes/Current'];

export default async ({ imports }: { imports: Readonly<Record<string, unknown>> }): Promise<{
	title: string;
	component: () => unknown;
	stop(): void;
}> => {
	// Both of these are the whole gate: the throw from `require` never reaches the component,
	// because there is no component until it has returned.
	const who = await (imports['Gate'] as Gate).require();
	const board = await (imports['Current'] as Current).ready;
	trace('notes/Page loaded');
	return {
		title: 'Notes',
		component: (): unknown => (
			<section id="notes">
				<h1>Notes</h1>
				<p id="notes-user">{who}</p>
				<p id="notes-title">{observer(board).path('title')}</p>
			</section>
		),
		stop: () => { trace('notes/Page stopped'); },
	};
};
