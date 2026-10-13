# 301: A recorded URL keeps its path and its query's names

Amends design 261 (the logs battery).

## Decision

The client half's `url` entry records the router's URL as its path and the names of its query
parameters, in order, with every value and the fragment dropped. `/reset?token=abc&next=/x#top` is
recorded as `/reset?token&next`. A URL with no query is recorded as its path.

## Why

A query holds values, and design 261 says the battery never stores a value (What it never does).
The auth battery puts its token in a mail link's query (`?token=`). So a person who opened a reset
or verify link wrote a live token into a visit document, where every reader of the store could see
it: for an hour for a reset link, and a day for a verify link. The fragment holds values too: an
OAuth implicit flow puts `#access_token=` there.

The server half already records a request's `pathname` and nothing after it (`logs/Observe`, the
`request` event), so the two halves now agree on what a URL is. The parameter names stay, because
they say what kind of page it was without holding a value: `/search?q` says a search ran without
saying what for. A commit is recorded the same way, as the paths it touched and never their values.

A list of sensitive parameter names was the other shape. Design 261 holds no list of sensitive
names on purpose, and a list misses the parameter an application names `t` or `code`.

## What it costs

A visit no longer says which page of results or which filter a person was on. An application that
needs a value in its record writes it with `log.write`, which is a decision that application makes
about that one value.

## What would reverse it

If replaying a visit (design 261, Why) needs the full URL, the values would be recorded under the
rule design 259 gives slot values: only where the application marked them safe.
