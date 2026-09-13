// auth/SignIn: one form for signing in and signing up, because `enter` does both (design 245).
//
// It decides nothing an application would want back: no URL of its own, no redirect, and no
// opinion about who may see what. Where to go afterwards is the application's.

import { mutable } from '@aweftjs/core';
import { Button, TextField, h, text } from '@aweftjs/ui';

import type { Auth } from '../auth-client.ts';

export const deps = ['auth/Session'];

/** What a refusal from `enter` carries: one entry per problem, each naming the field it is about. */
interface Reason {
	readonly code: string;
	readonly message: string;
}

const LAYOUT = 'display:flex;flex-direction:column;gap:1rem;max-width:22rem';

const about = (reasons: readonly Reason[], code: string): string =>
	reasons.filter((one) => one.code === code).map((one) => one.message).join(' ');

/** Everything the refusal said that was not about one of the two fields. */
const rest = (reasons: readonly Reason[]): string =>
	reasons.filter((one) => one.code !== 'email' && one.code !== 'password')
		.map((one) => one.message).join(' ');

/** What the stage hands a refused act beside the refusal (design 244). */
interface SignInProps {
	/** Build the act the URL chose again. Present when this act is what `refused` names. */
	readonly retry?: () => void;
}

export default ({ imports }: { imports: Readonly<Record<string, unknown>> }): {
	title: unknown;
	component: (props: SignInProps) => unknown;
} => {
	const session = imports['Session'] as Auth;

	const component = (props: SignInProps): unknown => {
		const email = mutable('');
		const password = mutable('');
		const emailProblem = mutable('');
		const passwordProblem = mutable('');
		const problem = mutable('');
		const busy = mutable(false);

		const submit = async (): Promise<void> => {
			if (busy.get()) return;
			busy.set(true);
			emailProblem.set('');
			passwordProblem.set('');
			problem.set('');
			try {
				const outcome = await session.enter(email.get(), password.get());
				if (!('refused' in outcome)) {
					// This act is standing in for the one the URL asked for, so the thing to do once
					// the reason has stopped holding is build that act again. The battery still picks
					// no URL: `retry` is the stage's own, and the address does not move.
					props.retry?.();
					return;
				}
				const reasons = outcome.refused as readonly Reason[];
				emailProblem.set(about(reasons, 'email'));
				passwordProblem.set(about(reasons, 'password'));
				problem.set(rest(reasons));
			} catch (error) {
				problem.set(String((error as Error)?.message ?? error));
			} finally {
				busy.set(false);
			}
		};

		return (
			<form
				aria-label={text('Sign in')}
				style={LAYOUT}
				onSubmit={(event: unknown) => {
					(event as { preventDefault(): void }).preventDefault();
					void submit();
				}}
			>
				<TextField
					label={text('Email')}
					value={email}
					error={emailProblem}
					placeholder={text('you@example.com')}
					name="email"
					autocomplete="email"
				/>
				<TextField
					label={text('Password')}
					value={password}
					error={passwordProblem}
					password
					name="password"
					autocomplete="current-password"
				/>
				{/* A refusal that named no field still has to be readable, and read out. */}
				<p role="alert">{problem}</p>
				{/* `Button` is a `type="button"`, so the click is the submit and the form's own
				    handler is what the Enter key reaches. */}
				<Button label={text('Sign in')} loading={busy} disabled={busy} onClick={submit} />
			</form>
		);
	};

	return { title: text('Sign in'), component };
};
