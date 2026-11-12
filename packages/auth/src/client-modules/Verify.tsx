// auth/Verify: the page a verification link opens, and the button that asks for one (design 290).
//
// With a token in the act's parameters or the URL's query it takes the link as soon as it
// mounts and says what happened. A link opened where the page is not signed in as its account
// is refused `sign-in` and left live, so the page shows `auth/SignIn` with the address and
// takes the link again once someone has signed in (design 322). Without a token it offers a
// signed-in person the mail. It picks no URL: the application names it in the acts map, and
// points the mail at that address.

import { all, mutable } from '@aweftjs/core';
import { Button, h, text } from '@aweftjs/ui';
import type { StageValue } from '@aweftjs/ui';

import type { Auth } from '../auth-client.ts';
import { tokenOf } from './stage-token.ts';

export const deps = ['auth/Session', 'auth/SignIn'];

interface Reason {
	readonly code: string;
	readonly message: string;
	/** On `sign-in`: the address of the account the link was mailed to. */
	readonly email?: string;
}

interface VerifyProps {
	readonly stage?: StageValue;
}

const LAYOUT = 'display:flex;flex-direction:column;gap:1rem;max-width:22rem';

const said = (reasons: readonly Reason[]): string => reasons.map((one) => one.message).join(' ');


export default ({ imports }: { imports: Readonly<Record<string, unknown>> }): {
	title: unknown;
	component: (props: VerifyProps, cleanup: (...fns: (() => void)[]) => void) => unknown;
} => {
	const session = imports['Session'] as Auth;
	const SignIn = (imports['SignIn'] as { component: (props: { email?: string }) => unknown }).component;

	const component = (props: VerifyProps, cleanup: (...fns: (() => void)[]) => void): unknown => {
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
			// The address a `sign-in` refusal named, for as long as the link waits on that account.
			const wanted = mutable<string | undefined>(undefined);
			const take = async (): Promise<void> => {
				await outcome(async () => {
					const answer = await session.verify(token);
					wanted.set('refused' in answer ? (answer.refused as readonly Reason[]).find((one) => one.code === 'sign-in')?.email : undefined);
					return answer;
				}, text('Your email address is verified.'));
				// Being asked to sign in is the next step, not a failure, so it is said as the note.
				if (wanted.get() !== undefined) {
					problem.set('');
					note.set(text('Sign in to confirm this email address.'));
				}
			};
			void take();
			// The form signs in through `auth/Session`, and so does a form of the application's
			// own, so following `user` hears either. Which account it is, the route decides.
			cleanup(session.user.watch((who) => {
				if (typeof who === 'string' && wanted.get() !== undefined) void take();
			}));
			return (
				<section aria-label={text('Verify your email')} style={LAYOUT}>
					<p>{note}</p>
					<p role="alert">{problem}</p>
					{wanted.map((email) => (email === undefined ? null : <SignIn email={email} />))}
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
