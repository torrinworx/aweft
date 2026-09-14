// auth/Verify: the page a verification link opens, and the button that asks for one (design 290).
//
// With a token in the act's parameters or the URL's query it takes the link as soon as it
// mounts and says what happened. Without one it offers a signed-in person the mail. It picks no
// URL: the application names it in the acts map, and points the mail at that address.

import { all, mutable } from '@aweftjs/core';
import { Button, h, text } from '@aweftjs/ui';
import type { StageValue } from '@aweftjs/ui';

import type { Auth } from '../auth-client.ts';
import { tokenOf } from './stage-token.ts';

export const deps = ['auth/Session'];

interface Reason {
	readonly code: string;
	readonly message: string;
}

interface VerifyProps {
	readonly stage?: StageValue;
}

const LAYOUT = 'display:flex;flex-direction:column;gap:1rem;max-width:22rem';

const said = (reasons: readonly Reason[]): string => reasons.map((one) => one.message).join(' ');


export default ({ imports }: { imports: Readonly<Record<string, unknown>> }): {
	title: unknown;
	component: (props: VerifyProps) => unknown;
} => {
	const session = imports['Session'] as Auth;

	const component = (props: VerifyProps): unknown => {
		const token = tokenOf(props.stage);
		const note = mutable<unknown>('');
		const problem = mutable('');
		const busy = mutable(false);
		const done = mutable(false);

		const outcome = async (run: () => Promise<{ ok: true } | { refused: readonly Reason[] }>, onOk: unknown): Promise<void> => {
			if (busy.get()) return;
			busy.set(true);
			problem.set('');
			try {
				const answer = await run();
				if ('refused' in answer) problem.set(said(answer.refused));
				else { note.set(onOk); done.set(true); }
			} catch (error) {
				problem.set(String((error as Error)?.message ?? error));
			} finally {
				busy.set(false);
			}
		};

		if (token !== undefined) {
			void outcome(() => session.verify(token), text('Your email address is verified.'));
			return (
				<section aria-label={text('Verify your email')} style={LAYOUT}>
					<p>{note}</p>
					<p role="alert">{problem}</p>
				</section>
			);
		}

		const send = (): Promise<void> => outcome(() => session.verify(), text('The link is on its way. Open it from your mail.'));
		// Reads `user`, so the button follows a sign-in or a sign-out on the same page.
		const anonymous = session.user.map((who) => who === null);
		return (
			<section aria-label={text('Verify your email')} style={LAYOUT}>
				<p>{anonymous.map((is) => is ? text('Sign in first, then ask for the link.') : text('We will send a link to your email address.'))}</p>
				<p>{note}</p>
				<p role="alert">{problem}</p>
				<Button label={text('Send the link')} loading={busy} disabled={all([anonymous, busy, done]).map(([is, sending, sent]) => is || sending || sent)} onClick={send} />
			</section>
		);
	};

	return { title: text('Verify your email'), component };
};
