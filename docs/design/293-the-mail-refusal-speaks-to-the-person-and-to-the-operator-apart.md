# 293: The `mail` refusal speaks to the person and to the operator apart

Amends design 290 (the 502 `mail` answer). Applies design 101 to a refusal a route answers
rather than throws.

## Decision

The `mail` refusal is `{ code: 'mail', message, detail, fix }`. `message` is one sentence for
the person the page shows it to, the same on every failure: `the mail could not be sent; try
again later`. `detail` is what the mailer said, word for word: notify's own error, the
`skipped` reason, or the shape it answered that notify never would. `fix` is the one sentence
that is true of every case, and names `notify/Send` as the setting to check and `detail` as
where the mailer's answer is.

A route's `{ reasons: [...] }` carries the three fields as they are. The client half hands
them through unchanged, as it does every reason.

## Why

Design 101 gives a refusal three parts: the token, what was seen, and what to do. A route's
reason had two, `code` and `message`, and `mailFailed` put what was seen into `message`, so the
sentence a page prints to a person read `the mail could not be sent: email is not configured:
give notify/Send an email setting`. The person cannot act on the second half and should not
see a module name; the operator needs exactly that half. Two readers, so two fields.

`fix` is fixed text rather than the mailer's words for the reason `check-errors.ts` refuses a
fix built at run time: a provider's error is a detail, not an instruction. The instruction is
the same whatever the mailer said.

## What this costs

One more field on one refusal, and a page that switched on the old `message` text switches on
`code` instead, which is what `code` is for.

## What would reverse this

A second route refusal that needs a `detail`: then `Refusal` in `core` grows the two optional
fields and every route's reasons carry them, rather than one module's interface extending it.
