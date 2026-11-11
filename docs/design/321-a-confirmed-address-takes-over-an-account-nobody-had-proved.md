# 321: A confirmed address takes over an account nobody had proved

Amends design 318 (sign-in with Google), which signed a known address in to its account as it
stood and named this case as what would reverse it.

## Decision

When `enterConfirmed` is given an address whose account has never been confirmed
(`emailVerified` is not true), it writes the account's password to empty, ends every session the
account has, then marks it confirmed and grants `verified`, as before. The caller then issues the
one session for the person the other party vouched for. No password signs in to the account
afterwards; forgot and reset set one, as for an account Google made.

An account already confirmed is signed in as it stands: its password and its other sessions are
its holder's, because the holder proved the address once.

## Why

Signing up with a password asks for no proof of the address and gives a session at once. So
anyone could make an account for `ada@example.com`, wait for Ada to press Sign in with Google,
and then share her account: the callback marked that account confirmed and signed her in, and
the stranger's password and open sessions went on working, now on a `verified` account. An audit
of an application on this stack (2026-11-10) found the path by reading; nobody is known to have
used it.

Design 318 said a report of this would make the sign-in ask for the account's password once.
That shuts out the wrong person: Ada does not know a password a stranger chose, and she is the
one the provider vouched for. The provider's word is the only proof of the address either party
has given, so its holder keeps the account and the other credentials go.

## What this costs

A person who signed up with a password, never opened the link in their mail, and later signs in
with Google loses that password and is signed out on their other devices. They set a new one
with forgot and reset. What the account already holds (its state, its names beyond `verified`)
stays, including anything a stranger wrote into it before the holder arrived; the application
decides whether that matters.

One narrow race is left. The sign-in route checks the password inside the per-email queue and
issues its session after it. A password sign-in that passed the check just before the
confirmation ran can still be issued a session just after. Closing it means issuing the session
inside the queue, which is a change to the route and to `enter()` and is not made here.

## What would reverse this

A provider that confirms addresses it does not control the mailbox of, so that its word is worth
less than a password. Or the race above being used, which would move the session's issue inside
the queue.

Checked by `a confirmed address takes over an account nobody had proved: its password and its
sessions end` in `packages/auth/tests/google.test.ts`.
