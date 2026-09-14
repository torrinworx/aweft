// auth/Reset: the forgot form, and the new-password form a reset link opens (design 290).
//
// Without a token in the act's parameters or the URL's query it asks for an address and mails
// the link; with one it asks for the new password and sets it. It picks no URL: the application
// names it in the acts map, and points the mail at that address.

import { mutable } from '@aweftjs/core';
import { Button, TextField, h, text } from '@aweftjs/ui';
import type { StageValue } from '@aweftjs/ui';

import type { Auth } from '../auth-client.ts';
import { tokenOf } from './stage-token.ts';

export const deps = ['auth/Session'];

interface Reason {
	readonly code: string;
	readonly message: string;
}

interface ResetProps {
	readonly stage?: StageValue;
}

const LAYOUT = 'display:flex;flex-direction:column;gap:1rem;max-width:22rem';

const about = (reasons: readonly Reason[], code: string): string =>
	reasons.filter((one) => one.code === code).map((one) => one.message).join(' ');

const rest = (reasons: readonly Reason[], codes: readonly string[]): string =>
	reasons.filter((one) => !codes.includes(one.code)).map((one) => one.message).join(' ');


export default ({ imports }: { imports: Readonly<Record<string, unknown>> }): {
	title: unknown;
	component: (props: ResetProps) => unknown;
} => {
	const session = imports['Session'] as Auth;

	const component = (props: ResetProps): unknown => {
		const token = tokenOf(props.stage);
		const email = mutable('');
		const password = mutable('');
		const fieldProblem = mutable('');
		const problem = mutable('');
		const note = mutable<unknown>('');
		const busy = mutable(false);
		const done = mutable(false);

		const run = async (call: () => Promise<{ ok: true } | { refused: readonly Reason[] }>, field: string, onOk: unknown): Promise<void> => {
			if (busy.get()) return;
			busy.set(true);
			fieldProblem.set('');
			problem.set('');
			try {
				const answer = await call();
				if ('refused' in answer) {
					fieldProblem.set(about(answer.refused, field));
					problem.set(rest(answer.refused, [field]));
				} else {
					note.set(onOk);
					done.set(true);
				}
			} catch (error) {
				problem.set(String((error as Error)?.message ?? error));
			} finally {
				busy.set(false);
			}
		};

		const submit = (): Promise<void> => token === undefined
			? run(() => session.forgot(email.get()), 'email', text('If that address has an account, a link is on its way.'))
			: run(() => session.reset(token, password.get()), 'password', text('Your password is set. Sign in with it.'));

		return (
			<form
				aria-label={text('Reset your password')}
				style={LAYOUT}
				onSubmit={(event: unknown) => {
					(event as { preventDefault(): void }).preventDefault();
					void submit();
				}}
			>
				{token === undefined
					? <TextField label={text('Email')} value={email} error={fieldProblem} placeholder={text('you@example.com')} name="email" autocomplete="email" />
					: <TextField label={text('New password')} value={password} error={fieldProblem} password name="password" autocomplete="new-password" />}
				<p>{note}</p>
				<p role="alert">{problem}</p>
				{/* `Button` is a `type="button"`, so the click is the submit and the form's own
				    handler is what the Enter key reaches. */}
				<Button label={token === undefined ? text('Send the link') : text('Set the password')} loading={busy} disabled={done} onClick={submit} />
			</form>
		);
	};

	return { title: text('Reset your password'), component };
};
