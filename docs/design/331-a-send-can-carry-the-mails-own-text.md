# 331: A send can carry the mail's own text

Amends design 268 (the notify battery). Asked for by an application whose newsletter reached
readers of the plain-text part cut off after 2000 characters, about a fifth of an issue, with no
footer and no unsubscribe line.

## Decision

`send` takes an optional `text`, a string, which reaches the email channel only, beside `html`.
The mail a sender is handed carries it as its `text`, whole. With no `text` the mail's text part is
the body, as before. A `text` that is not a string is `invalid-notification`. The body is
unchanged: it is still cut at 2000, and it is still what the inbox item and a push carry.

## Why

A mail has two parts, and a send could name only one of them. `html` has been the mail's own since
design 268, with no limit, because it reaches no document. The text part had no field of its own,
so an application put its mail's text in `body`, the one string that reaches the mail as text. The
body is a notice: it is stored in the inbox document and sent through a push, and it is cut at 2000
for those. A long mail's text was cut with it, and nothing said so: the send answered `ok` and the
provider delivered a text part that stopped in the middle of a sentence.

The other shape was a longer limit on the body when the send goes to email alone. It would have
made one field mean two things by its channels, and a send to the inbox and email together would
still cut the mail's text.

## What it costs

One more optional field on `SendOptions`. `Mail` is unchanged, since it has always had `text`.
`text` has no limit, like `html`: its size is the application's to bound, and a provider refuses a
mail it finds too large, which lands in the delivery record. An application that passes its mail's
text as `body` is still cut at 2000 until it passes `text`.

## What would reverse it

A channel beside email that needs a long text of its own. Then the parts of a mail would be named
together, as one `mail: { html, text }` on the send, and `text` here would move into it.
