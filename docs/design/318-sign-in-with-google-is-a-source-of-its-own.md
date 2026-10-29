# 318: Sign-in with Google is a source of its own, and the form asks for the email first

Amends designs 074 (the battery mints credentials), 245 (the auth client source) and 291 (who
may sign up is the application's rule).

## Decision

**A third source, `google`,** exported from `@aweftjs/auth` beside `auth` and `mail`, holding one
module, `auth/Google`. An application that wants Google lists it (`sources: [own, auth, google]`);
one that does not leaves it out and loads nothing of it. It `deps` on `auth/Session` and
`auth/Enter`. Its configuration, in a same-named file, has three settings with no default:
`clientId`, `clientSecret` and `callback`, the absolute address Google sends the browser back
to, which must be listed under the OAuth client's redirect URIs. A battery picks no URL, so
`callback` is the application's, as `url` is for the mail modules. `fetch` is a fourth, the
global by default, for a test that stands in for Google.

**Two routes, the OpenID Connect authorization code flow with PKCE** (RFC 7636):

- `GET /api/auth/google?return=<path>` mints a state and a code verifier, puts both and the
  return path in one HttpOnly, SameSite=Lax cookie scoped to `/api/auth/google` that lives ten
  minutes, and answers 302 to Google's authorization endpoint with the S256 challenge and the
  scopes `openid email profile`. `return` is a path on this site: anything that does not start
  with one `/` is `/`, so the route can never send a person to another host.
- `GET /api/auth/google/callback` takes Google's answer. The state must equal the cookie's, so
  a callback the browser did not start is refused. The code is exchanged at Google's token
  endpoint with the secret and the verifier, and the ID token in the answer is read without
  checking its signature, because it came straight from Google over TLS (OpenID Connect Core
  3.1.3.7, item 6). Its issuer must be Google's, its audience the `clientId`, it must not have
  expired, and `email_verified` must be true. Then `auth/Enter` admits the address, a session
  is issued, the flow cookie is cleared, and the answer is 302 to the return path. Every
  failure is 302 to the return path with `auth=<code>` in the query (`cancelled`, `google`,
  `unverified`, or the code of a sign-up refusal), so the page that started it can say what
  happened.

**`auth/Enter` gains `enterConfirmed(email, { name, context })`**, for an address another party
has confirmed. A known address is signed in, and its `emailVerified` is written and `verified`
granted, since the address is now confirmed. A new one asks the application's `refuseSignUp`
(design 291) with an empty `extra`, then makes a user with no password, `emailVerified` true and
`name` as given, grants `verified`, and runs the `afterSignUp` listeners. The same per-email
queue as `enter` keeps two admissions of one address from making two accounts. An account with
no password cannot be signed in with one: `verifyPassword` refuses an empty hash. The person sets
one through forgot and reset when they want one.

**The `verified` name moves to `names.ts`**, so `auth/Enter` grants it without importing
`auth/Verify`; `auth/Verify` uses the same constant.

**`auth/SignIn` asks for the email first.** It shows the email field and Continue. Continue asks
`auth/Check`, and the form then says which of two things happens: "Welcome back" with the
password field and a Sign in button, or "No account uses this email yet" with a new-password
field and a Create account button. A Change button goes back to the email. Both submit through
`enter`, so the server's answer is still what decides. The form's configuration gains `google`,
false by default: true shows Continue with Google above the email, which navigates to the start
route with the page's own path as `return`, and the form says what an `auth=<code>` in the
address means.

## Why

One form for both was right for the server (design 074) and wrong for people. Visitors on an
application using the battery's form could not tell whether they were signing in or signing up,
because the only button said Sign in whichever happened. `auth/Check` already answered the
question; the form never asked it.

A source of its own, because an application without Google must load nothing of it, and there
is no optional dependency (design 290, the same reasoning). A cookie for the flow rather than a
document in the store, because the state has to be bound to the browser that started it, which
a cookie is, and ten minutes of three values need no sweep.

The signature is not checked because checking it needs Google's keys fetched and cached, and
the token endpoint's TLS already says who wrote it. A provider that hands the ID token to the
browser first (the implicit flow) would need it; this flow never does.

`enterConfirmed` on `auth/Enter` rather than in `auth/Google`: making a user, the first grant,
the sign-up rule, the per-email queue and the listeners are already Enter's, and a second copy
would drift. Signing a known address in is the common behaviour for a provider that confirms
email, and it keeps one person to one account.

## What it costs

Two more routes on a server that lists `google`. A person who signs up with Google and later
types the address into the form is told "Welcome back" and asked for a password they never set;
"Forgot your password?" sets one. The form takes a round trip (`check`) before it asks for a
password. The sign-in form's single-step shape is gone; an application that wanted it writes
its own `auth/SignIn`.

## What would reverse it

A second provider. Then the flow becomes one module taking the provider's endpoints, and Google
is its first configuration. A report of a session taken through a confirmed address of an
account that someone else had made first would make signing a known address in ask for its
password once.
