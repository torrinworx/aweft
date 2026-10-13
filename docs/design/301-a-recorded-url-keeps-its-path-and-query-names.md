# 301: A recorded URL keeps its path and its query's names

Amends design 261 (the logs battery).

## Decision

The client half's `url` entry records the router's URL as its path and the names of its query
parameters, in order, with every value and the fragment dropped. `/reset?token=abc&next=/x#top` is
recorded as `/reset?token&next`. A URL with no query is recorded as its path.

## Why

A query carries values, and a value is what the battery says it never stores (design 261, What it
never does). The auth battery's mail links carry their token in the query (`?token=`), so a person
who opened a reset or verify link wrote a live token into a visit document that every reader of
the store can see, for a reset link's hour and a verify link's day. The fragment carries values the
same way: an OAuth implicit flow answers with `#access_token=`.

The server half already records a request's `pathname` and nothing after it (`logs/Observe`, the
`request` event), so the two halves now agree on what a URL is. The names stay because they are
shape, the way a commit is recorded as its paths and never its values: `/search?q` says a search
ran without saying what for.

A list of sensitive parameter names was the other shape. Design 261 holds no list of sensitive
names on purpose, and a list misses the parameter an application names `t` or `code`.

## What it costs

A visit no longer says which page of results or which filter a person was on. An application that
needs a value in its record writes it with `log.write`, which is a decision that application makes
about that one value.

## What would reverse it

Replay of a visit (design 261, Why) needing the full URL. Then the values would be recorded under
the same rule design 259 gives slot values: only where the application marked them safe.
