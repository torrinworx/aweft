# 330: A sign-up can carry a challenge, and the rule knows which door it came through

Amends design 291 (who may sign up) and design 318 (sign-in with Google). Asked for by an
application that wants a human check (a CAPTCHA) on new accounts made with a password, and none
on an address Google vouched for.

## Decision

**`auth/SignIn` takes `challenge`**, configuration beside `google`: `null`, or a function the
form calls once each time it is built, answering:

- `view`, drawn on the create-account step only, above the Create account button;
- `fields()`, sync or async, whose fields go to `enter` as its `extra`, so they reach
  `refuseSignUp` beside the address;
- `reset()`, optional, called after a create-account attempt that did not make an account,
  because the answer to a challenge is usually good for one try.

A sign-in never shows the view and never calls `fields()`. A `fields()` that throws is shown on
the form like a throw from `enter`, and nothing is sent.

**`SignUp` gains `confirmed`**: `false` for a sign-up through `POST /api/session`, `true` for one
through `enterConfirmed`. A rule that checks a challenge lets a confirmed sign-up through, since
the other party already checked the person and there was no form to carry an answer.

## Why

The rule could already refuse a sign-up (design 291), but the form had no way to send anything
beside the address and the password. The other way was for the application to replace
`auth/SignIn` whole, which copies the email step, the Google button and the refusal handling to
add one box. A view and a function of fields cost the form one optional configuration.

Without `confirmed`, a sign-up through Google arrives with an empty `extra`, the same as a
password sign-up that left the challenge out. The rule could not tell them apart, so it had to
refuse both or check neither.

The battery names no provider. What the challenge is (Turnstile, hCaptcha, a puzzle of the
application's own) and how its answer is checked stay the application's.

## What it costs

One optional configuration on the form and one boolean on `SignUp`. A challenge that loads a
script from elsewhere is the application's to load; the form draws whatever `view` it is given.

## What would reverse it

A second step of the form that needs its own challenge (a sign-in after many failures): then
`challenge` would take the step it is for, and this note is amended.
