# 244: A refused act has a home

## Decision

`refused` on `StageContext` is an act name, shown when loading a named act rejects with a
refusal, the way `fallback` is shown when nothing matched.

```tsx
<StageContext acts={{ notes: 'notes/Page', join: 'auth/SignIn' }} refused="join" ... />
```

**What counts as a refusal.** The stage asks the loader for the act, and the loader wraps a
factory that threw as a `ModulesError` with reason `failed` carrying the throw as its `cause`
(design 063). So: a rejection whose reason is `failed` and whose `cause` carries a string
`reason` is a refusal, and the cause is what the refused act is given. Everything else
propagates: a `missing` name, a `cycle`, an `ambiguous-import`, and a factory that threw a plain
`Error` with no reason on it. Those are defects in the page rather than answers to the visitor,
and turning a typo in an act name into a sign-in form is the failure this rule exists to avoid.

**`refused` absent: the rejection propagates**, exactly as it does today, through `suspend`'s
failed component or, with none, onto a fresh task where the host reports it.

**The refused act reads the error off its own props, as `refusal`, and the way back as `retry`.**

```tsx
const SignIn = (props: { refusal?: unknown; retry?: () => void }) => (
	<p>{String((props.refusal as { reason?: string })?.reason ?? '')}</p>
);
```

Both are written after the open's props, so an open cannot shadow either. A prop rather than a
field on the stage value because the refusal belongs to one showing of one act, not to the stage:
two acts in a row can be refused for different reasons, and a cell on the stage would make the
second one's message readable from the first one's cleanup.

**`retry` builds the act the URL chose again, in place.** The act is rebuilt when its signature
changes, and the signature is the act name, the parameters it matched and which open it is, so a
push of the URL the page is already on changes nothing and rebuilds nothing. `retry` bumps a
counter the signature carries, so the act loads afresh with the URL exactly where it was. It is
what the visitor's own act calls when the reason has stopped holding: `auth/SignIn` calls it after
`enter` succeeds and does nothing else with it.

**The refused act may itself be a module name**, and usually is: `refused: 'join'` over
`acts: { join: 'auth/SignIn' }` is the shape the battery is written for. It loads the same way
any named act does, and its own `stop` runs when the stage leaves it.

**The refusal is not a route.** The URL does not move, `current` still reads the act the URL
named, and a reload shows the same thing. What changed is what that act rendered, which is what
the application's own gate module decided. So a test that asks what a refused page is showing
reads the page, not `current`.

**A `refused` name whose key takes parameters is a loud assert**, checked where `fallback` and
`initial` are, and naming the rule. The refused act renders under the refusing URL, so a key like
`join/:from` would be handed the `:from` of whatever act was refused, which is another act's
parameter under this act's name.

## Why

Each of four applications carries the same hand-written wrapper around a private page: wait for
the auth packet, bounce to sign-in, wait for the synced state, check the role, else 404. Two of
them carry it twice. The bounce is the part with no home: a page cannot render "you are not
allowed" and also be the page, so the wrapper redirects, and the redirect loses the URL the
visitor asked for.

With acts as modules the check has a home already: the application writes a gate module, the
page `deps` on it, and the gate's factory throws `anonymous` or `not-admin`. `refused` is the
one thing missing, which is where that throw lands. Nothing in the library decides who may see a
page: the server's gate is the only trust boundary, and this is what the page shows while the
server is refusing to answer.

## What it costs

**A refusal shows the same act for every reason.** One name, not a map from reason to act. A page
that wants a different view for `not-admin` than for `anonymous` branches inside the refused act,
which has the error. A map would be the beginning of a second routing table.

**Nothing retries on its own.** The stage watches nothing: when the reason stops holding, the page
changes only because the refused act said so by calling `retry`. An application that wants it to
happen with no click at all watches whatever its gate watches and calls `retry` from there, which
is the act's own business rather than the stage's.

**A reason-carrying error thrown by accident is caught.** Any factory in the act's dependency
closure that throws something with a `reason` string is read as a refusal. Every refusal this
stack raises carries one (design 101), so a store error, a codec error and a module error all
qualify. The reasons are the vocabulary, and the refused act sees which one it was.

## What would reverse this

A page that has to route on a refusal rather than render one, or one that needs a different act
per reason often enough that branching inside the refused act stops being enough. A refused act
that has to rebuild something other than the act the URL chose would reopen what `retry` takes.

## Evidence

`packages/ui/tests/stage.test.ts`: an act whose dependency throws a refusal showing the act
`refused` names, with the reason readable off the `refusal` prop; the URL and `current`
unchanged by it; the refused act's `retry` building the act the URL chose once the gate allows it,
at the same address and with the refused act built once; a `refused` naming a key with a `:name`
or `*name` segment refused at mount; a factory that throws an error with no reason propagating to
`suspend`'s failed component rather than showing the refused act; a `missing` act name propagating
the same way; and, with no `refused` named, a refusal propagating.

`packages/auth/tests/client-modules.test.ts`: `auth/SignIn` calling the `retry` it was handed once
`enter` succeeds, and not when `enter` is refused.

`recipes/client` visits a gated URL while anonymous, gets the battery's sign-in form, signs up
through it, and the gated act appears at that same URL with no navigation.
