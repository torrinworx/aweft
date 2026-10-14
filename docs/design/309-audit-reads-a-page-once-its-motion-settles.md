# 309: `audit` reads a page once its motion settles

Amends design 267 (the two checks a driven page gets).

## Decision

Before axe runs, `audit` waits for every animation and transition on the page that has an end to
reach it, for at most five seconds. One that never ends (a spinner, a pulse) is not waited for.
Each look at the page comes two frames after the last, so the events of what just ended are sent
and a transition one of their handlers starts is already running. The wait repeats until a look
finds nothing with an end, so that transition is waited for too.

## Why

`ui` transitions `color` and `background-color` on every themed element for a person who has not
asked for reduced motion. A test that switches the colour mode and audits straight after can catch
text halfway between its light and its dark colour, over a background that has already arrived,
and axe reports the contrast of that frame. One application's gate failed this way on two runs of
nine, on the same heading, and passed on the rest. The page was right, and the reading was early.

Waiting inside `audit` puts the fix where every caller gets it. A caller cannot wait for the right
thing from outside without knowing which transitions the page runs, and a fixed sleep is either
too short on a slow machine or a cost on every run.

## What this costs

An audit of a page in motion takes as long as the motion has left, up to five seconds. A finite
animation longer than that is read where it is at five seconds.

## Evidence

`packages/testing/tests/browser.test.ts` switches a page to dark, with its text easing over two
seconds, and audits at once: nothing is reported and the text has landed. Without the wait the same
fresh page reports `color-contrast` (3 runs of 3). A second page starts its colour transition only
from the end of its background's, and the audit waits for both. A page with an endless animation is
audited in well under a second.

## What would reverse this

axe reading computed colours at their transition's end itself.
