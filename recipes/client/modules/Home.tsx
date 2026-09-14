// site/Home: the public act. It reads identity but does not require it.

import type { Auth } from '@aweftjs/auth/client';
import { h } from '@aweftjs/ui';

import { trace } from '../trace.ts';

export const deps = ['auth/Session'];

export default ({ imports }: { imports: Readonly<Record<string, unknown>> }): {
	title: string;
	component: () => unknown;
	stop(): void;
} => {
	const session = imports['Session'] as Auth;
	trace('site/Home loaded');
	return {
		title: 'Home',
		component: (): unknown => (
			<section id="home">
				<h1>Notes</h1>
				<p id="who">
					{session.user.map((who) =>
						(typeof who === 'string' ? `signed in as ${who}` : who === null ? 'nobody' : 'asking'))}
				</p>
				{/* The names follow the roles share, so a grant on the server shows here with no reload. */}
				<p id="names">
					{session.names.map((names) => (names === undefined ? 'asking' : names.length === 0 ? 'holds nothing' : `holds ${names.join(', ')}`))}
				</p>
			</section>
		),
		stop: () => { trace('site/Home stopped'); },
	};
};
