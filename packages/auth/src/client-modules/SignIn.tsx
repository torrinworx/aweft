// auth/SignIn: one form for signing in and signing up, because `enter` does both (design 245). It
// asks for the email first and says which of the two will happen before it asks for a password
// (design 318), and with `google` on it offers Google, with its mark, above the email. Once the
// person has picked email, Google steps aside. A `challenge` puts the application's own human check
// on the create-account step and sends its fields with the sign-up (design 330).
//
// It decides nothing an application would want back: no URL of its own, no redirect, and no
// opinion about who may see what. Where to go afterwards is the application's.

import { mutable } from '@aweftjs/core';
import { Button, Icon, Shown, TextField, h, mark, text } from '@aweftjs/ui';

import type { Auth } from '../auth-client.ts';
import { googleMark } from '../google-mark.ts';

export const deps = ['auth/Session'];

export const defaults = { google: false, challenge: null };

/** What `challenge` answers: a check of the application's own on the create-account step (design 330). */
export interface Challenge {
	/** Drawn on the create-account step only, above the Create account button. A component call (`h(Box, {})`) is built again each time the step shows. */
	readonly view: unknown;
	/** The fields sent beside the address and the password, which `refuseSignUp` reads as `extra`. */
	fields(): Readonly<Record<string, unknown>> | Promise<Readonly<Record<string, unknown>>>;
	/** Called after a create-account attempt that made no account, since an answer is usually good for one try. */
	reset?(): void;
}

/** What a refusal from `enter` carries: one entry per problem, each naming the field it is about. */
interface Reason {
	readonly code: string;
	readonly message: string;
}

type Step = 'email' | 'known' | 'new';

const STACK = 'display:flex;flex-direction:column;gap:1rem';
const LAYOUT = `${STACK};max-width:22rem`;
const OR = 'display:flex;align-items:center;gap:0.75rem';
const RULE = 'flex:1;margin:0;border:0;border-top:1px solid currentColor;opacity:0.25';
const ADDRESS = 'display:flex;align-items:center;justify-content:space-between;gap:0.75rem';
const WRAPS = 'min-width:0;overflow-wrap:anywhere';

const about = (reasons: readonly Reason[], code: string): string =>
	reasons.filter((one) => one.code === code).map((one) => one.message).join(' ');

/** Everything the refusal said that was not about one of the two fields. */
const rest = (reasons: readonly Reason[]): string =>
	reasons.filter((one) => one.code !== 'email' && one.code !== 'password')
		.map((one) => one.message).join(' ');

/** What the `auth=<code>` a Google sign-in comes back with means, to the person. */
const BACK: Readonly<Record<string, unknown>> = {
	cancelled: text('Google sign-in was cancelled.'),
	unverified: text('Google has not confirmed that email address. Use your email below instead.'),
};

/** The page's address, where there is a page: no DOM types here, and a render on the server has none. */
const where = (): { readonly href: string; assign(url: string): void } | undefined =>
	(globalThis as { location?: { readonly href: string; assign(url: string): void } }).location;

/** What the stage hands a refused act beside the refusal (design 244). */
interface SignInProps {
	/** Build the act the URL chose again. Present when this act is what `refused` names. */
	readonly retry?: () => void;
	/** An address already known to have an account: the form opens on the password step with it (design 322). */
	readonly email?: string;
}

export default ({ imports, config }: { imports: Readonly<Record<string, unknown>>; config: Readonly<Record<string, unknown>> }): {
	title: unknown;
	component: (props: SignInProps) => unknown;
} => {
	const session = imports['Session'] as Auth;
	const google = config['google'] === true;
	const challengeOf = config['challenge'] as (() => Challenge) | null;

	const component = (props: SignInProps): unknown => {
		const step = mutable<Step>(props.email === undefined ? 'email' : 'known');
		const email = mutable(props.email ?? '');
		const password = mutable('');
		const emailProblem = mutable<unknown>('');
		const passwordProblem = mutable('');
		const problem = mutable<unknown>('');
		const busy = mutable(false);
		const known = step.map((held) => held === 'known');
		const challenge = challengeOf === null ? null : challengeOf();

		const page = where();
		if (page !== undefined) {
			const code = new URL(page.href).searchParams.get('auth');
			if (code !== null) problem.set(BACK[code] ?? text('Signing in with Google did not work. Try again, or use your email.'));
		}

		const attempt = async (work: () => Promise<void>): Promise<void> => {
			if (busy.get()) return;
			busy.set(true);
			emailProblem.set('');
			passwordProblem.set('');
			problem.set('');
			try {
				await work();
			} catch (error) {
				problem.set(String((error as Error)?.message ?? error));
			} finally {
				busy.set(false);
			}
		};

		// The server's own test of an address, so a typo is caught here rather than offered an account.
		const next = (): Promise<void> => attempt(async () => {
			const address = email.get().trim().toLowerCase();
			if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
				emailProblem.set(text('Enter an email address, like you@example.com.'));
				return;
			}
			step.set(await session.check(address) ? 'known' : 'new');
		});

		const enter = (): Promise<void> => attempt(async () => {
			const signUp = challenge !== null && step.get() === 'new';
			let outcome;
			try {
				outcome = await session.enter(email.get(), password.get(), signUp ? await challenge.fields() : undefined);
			} catch (error) {
				if (signUp) challenge.reset?.();
				throw error;
			}
			if (signUp && 'refused' in outcome) challenge.reset?.();
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
		});

		const back = (): void => {
			password.set('');
			passwordProblem.set('');
			problem.set('');
			step.set('email');
		};

		// The page's own address, less the `auth` a failed attempt came back with, is where Google returns to.
		const toGoogle = (): void => {
			const here = new URL(where()!.href);
			here.searchParams.delete('auth');
			where()!.assign(`/api/auth/google?return=${encodeURIComponent(`${here.pathname}${here.search}`)}`);
		};

		return (
			<form
				aria-label={text('Sign in or create an account')}
				style={LAYOUT}
				onSubmit={(event: unknown) => {
					(event as { preventDefault(): void }).preventDefault();
					void (step.get() === 'email' ? next() : enter());
				}}
			>
				<Shown value={step.map((held) => held === 'email')}>
					{google ? (
						<div style={STACK}>
							<Button label={text('Continue with Google')} type="outlined" icon={<Icon name={googleMark} size="1.125em" />} onClick={toGoogle} />
							<div style={OR} aria-hidden="true">
								<hr style={RULE} />
								<span>{text('or')}</span>
								<hr style={RULE} />
							</div>
						</div>
					) : null}
					<TextField
						label={text('Email')}
						value={email}
						error={emailProblem}
						placeholder={text('you@example.com')}
						name="email"
						autocomplete="email"
					/>
					{/* `Button` is a `type="button"`, so the click is the submit and the form's own
					    handler is what the Enter key reaches. */}
					<Button label={text('Continue')} loading={busy} disabled={busy} onClick={next} />
					<mark.else>
						<p>
							<strong>{known.map((held) => (held ? text('Welcome back.') : text('No account uses this email yet.')))}</strong>
							{' '}
							{known.map((held) => (held ? text('Enter your password to sign in.') : text('Pick a password to create your account.')))}
						</p>
						<p style={ADDRESS}>
							<span style={WRAPS}>{email}</span>
							<Button label={text('Change email')} type="text" inline onClick={back} />
						</p>
						<TextField
							label={known.map((held) => (held ? text('Password') : text('New password')))}
							value={password}
							error={passwordProblem}
							password
							name="password"
							autocomplete={known.map((held) => (held ? 'current-password' : 'new-password'))}
						/>
						{challenge === null ? null : <Shown value={known} invert>{challenge.view}</Shown>}
						<Button label={known.map((held) => (held ? text('Sign in') : text('Create account')))} loading={busy} disabled={busy} onClick={enter} />
					</mark.else>
				</Shown>
				{/* A refusal that named no field still has to be readable, and read out. */}
				<p role="alert">{problem}</p>
			</form>
		);
	};

	return { title: text('Sign in or create an account'), component };
};
