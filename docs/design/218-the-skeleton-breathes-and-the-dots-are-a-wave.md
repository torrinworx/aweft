# 218: The skeleton breathes, the dots are a wave, and the two stop sharing one block

Amends design 199's "One `pulse` definition, shared": there are two definitions now, one per
animation, each still named after the entry that owns it (design 111). Everything else design 199
says about `Skeleton` stands.

## Decision

**A skeleton breathes over 2 seconds.** The `pulse` entry keeps its name and its job, and is what
`skeleton` extends:

```
pulse: {
    $pulseCycle: '2s',
    _keyframes_pulse: '0%, 100% { opacity: 1 } 50% { opacity: 0.5 }',
    '_media_(prefers-reduced-motion: no-preference)': {
        animation: '$pulse $pulseCycle ease-in-out infinite',
    },
}
```

Opacity 1 down to 0.5 and back, on `ease-in-out`, with no flat stretch anywhere in the cycle. It
was 240ms between 0.35 and 1 on a curve that held the low value for four fifths of the cycle.

**The dots are a wave over 1 second.** `dot` owns its own keyframes now and no longer extends
`pulse`:

```
dot: {
    $dotCycle: '1s',
    _keyframes_wave: '0%, 100% { opacity: 0.35 } 50% { opacity: 1 }',
    '_media_(prefers-reduced-motion: no-preference)': {
        animation: '$wave $dotCycle ease-in-out infinite',
    },
}
dot_second: { …: { animationDelay: 'calc($dotCycle / 3)' } }
dot_third:  { …: { animationDelay: 'calc($dotCycle / 3 * 2)' } }
```

Three dots one third of a cycle apart, each rising and falling smoothly, so the bright point
travels along the row and comes back. The delays are worked out from the cycle in the stylesheet
rather than written twice, so changing the cycle is one edit, which is the same reason
`slider`'s thumb offset is a `calc`.

The block is `_keyframes_wave` rather than `_keyframes_dot` because `$dot` is already a name in
this theme: `radio` defines it as the size of its centre dot. The two never meet in one chain, and
a reader who has to work that out is a reader the naming failed.

**Both stay inside `prefers-reduced-motion: no-preference`**, so a person who asked for less motion
gets three still dots and a still grey box, and no rule to override (design 118).

**Two keyframes blocks, not one.** The sheet compiler names a block after the definition that owns
it and emits it once however many chains reach it (design 111), so a page holding both a skeleton
and a set of dots emits `@keyframes pulse-<hash>` and `@keyframes wave-<hash>`, one each. Design
199's "one definition" argument was about a chain not emitting a second copy, and that still holds;
what changed is that there are two animations to define.

## Why

At the old timing the dots ran far too fast and choppy, and the skeleton read as flashing.

Both were literally one animation. `0%, 80%, 100% { opacity: 0.35 } 40% { opacity: 1 }` over 240ms
spends 192ms of every cycle at the low value and 48ms travelling, which is a strobe and not a
pulse, and at four cycles a second it is fast enough to be hard to look at. On a full-width grey
box that reads as flashing; on three dots offset by 120ms and 240ms, which is half a cycle and a
whole one, it reads as flicker rather than as a sequence, because a delay of one whole cycle puts
the third dot back in step with the first.

So the two wanted opposite things and could not have them from one block. A skeleton stands in for
a block of content and should barely move: slow, shallow, symmetric. Loading dots are meant to be
read as a sequence, which needs the three of them out of phase by a third of a cycle rather than
by a whole one, and needs the cycle long enough to see. The two cycles are 2 seconds and 1 second.

`ease-in-out` rather than `$ease`: `$ease` is the curve for a change that arrives and stops, and
these are cycles that turn around at both ends. It is the CSS keyword rather than a token because
the theme's two easings are both one-way curves and a third name that means the standard keyword
would be a name for nothing.

## Evidence

`packages/ui/tests/look.test.ts`:

- "a skeleton breathes and the dots are a wave, and each owns its own block": one render reaching
  both chains emits exactly two `@keyframes`, `pulse-` and `wave-`; the skeleton's animation names
  the first at 2s on `ease-in-out` and the dot's the second at 1s; both keyframes hold their two
  stops and neither has a flat stretch; nothing animates outside the reduced-motion query.
- "the three dots are a third of a cycle apart": the second and third delays compile to
  `calc(1s / 3)` and `calc(1s / 3 * 2)` inside the query, and the first declares no delay.

`packages/ui/tests/browser.test.ts`, measured in Chromium: "the pulse and the wave run at the
durations they say": a skeleton's computed `animation-duration` is `2s` and its
`animation-timing-function` `ease-in-out`; a dot's is `1s`; the second and third dots report
`animation-delay` of about 0.333s and 0.667s; under
`page.emulateMedia({ reducedMotion: 'reduce' })` every one of them reports `animation-name: none`.
The box read `0.24s` at the old cycle.

## What this costs

A skeleton is now half as contrasty at its dimmest, 0.5 rather than 0.35, so on a `$muted` fill in
dark mode the movement is quieter than it was. That is the intent: a stand-in for content that
draws the eye is a stand-in doing the wrong job.

A page showing dots waits up to a second to see the whole sequence, where before it saw four a
second. A person who reads a spinner as "is this still working" gets that answer more slowly, and
gets it from three dots that are never all dark rather than from a strobe.

Two keyframes blocks instead of one: about forty more bytes in the sheet on a page that holds
both.

## What would reverse this

The 1 second cycle reading as sluggish, which is one value in one entry. Nothing about the wire,
the surface or an application's stored state touches either number.
