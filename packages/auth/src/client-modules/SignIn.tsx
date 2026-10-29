// auth/SignIn: one form for signing in and signing up, because `enter` does both (design 245). It
// asks for the email first and says which of the two will happen before it asks for a password
// (design 318), and with `google` on it offers Google, with its mark, above the email. Once the
// person has picked email, Google steps aside.
//
// It decides nothing an application would want back: no URL of its own, no redirect, and no
// opinion about who may see what. Where to go afterwards is the application's.

import { mutable } from '@aweftjs/core';
import { Button, Icon, Shown, TextField, h, mark, text } from '@aweftjs/ui';

import type { Auth } from '../auth-client.ts';

export const deps = ['auth/Session'];

export const defaults = { google: false };

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

/** Google's own mark, in its four colours, which its branding rules ask a sign-in button to carry. */
const GOOGLE = {
	width: 48,
	height: 48,
	body: '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>'
		+ '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>'
		+ '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>'
		+ '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>',
};

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
}

export default ({ imports, config }: { imports: Readonly<Record<string, unknown>>; config: Readonly<Record<string, unknown>> }): {
	title: unknown;
	component: (props: SignInProps) => unknown;
} => {
	const session = imports['Session'] as Auth;
	const google = config['google'] === true;

	const component = (props: SignInProps): unknown => {
		const step = mutable<Step>('email');
		const email = mutable('');
		const password = mutable('');
		const emailProblem = mutable<unknown>('');
		const passwordProblem = mutable('');
		const problem = mutable<unknown>('');
		const busy = mutable(false);
		const known = step.map((held) => held === 'known');

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
							<Button label={text('Continue with Google')} type="outlined" icon={<Icon name={GOOGLE} size="1.125em" />} onClick={toGoogle} />
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
