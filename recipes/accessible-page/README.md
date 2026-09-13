# recipes/accessible-page

A page everyone can use, and the three places the stack says so.

`page.tsx` is a form with an image, a menu, a dialog and a status message, written the ordinary
way: the image says what it shows, every field has a label, the button that is only an icon has a
name, and the message lands in a live region. `main.ts` drives it in Chromium by keyboard, runs
`audit` over it in both colour schemes and `walk` over its controls, and then shows each guardrail
catching one page written wrong.

## See it

```
npx vite recipes/accessible-page
```

## What the gate does with it

```
node --import @aweftjs/build/loader recipes/accessible-page/main.ts
```

1. **The build.** One snippet per access rule goes through `transform()` and is refused with its
   reason and its fix (`@aweftjs/build`, The access rules). A spread passes, because the source
   cannot say what it carries.
2. **The page.** Built through `aweft()`, driven from the keyboard: Enter in a field sends, the
   icon-only button clears, the menu opens and picks and gives the focus back, the dialog names
   itself and Escape returns the focus. Then `audit` in light and in dark, and `walk` from the top.
3. **The page written wrong.** Three more pages built beside it, each carrying one fault the build
   cannot see: `faults/no-language.html` has no `lang`, and the mount throws; `faults/nameless-button.tsx`
   mounts a `Button` that is only an icon, and the mount throws; `faults/unreadable.tsx` paints grey
   on white and keeps the focus in a box, and `audit` reports the pair while `walk` reports the trap.

## Where each fault is caught

| the fault | caught by | what you see |
| --- | --- | --- |
| an `img` with no `alt`, an unlabelled control, a click on a `div`, a positive `tabindex`, a link with no `href`, an empty button, heading or frame | the build | a `TransformError` at the line, with the fix |
| a `Button` whose only content is an unlabelled `Icon` | the mount, in development | a throw with the three ways to name it |
| a page with no `lang` or no title | the first mount, in development | a throw with the fix |
| a colour pair under 4.5:1, a missing landmark, a role that contradicts its element, a duplicate id | `audit`, in a test | axe's rule, its WCAG tags, the node |
| a control Tab never reaches, a stop with no ring, a box that keeps the focus | `walk`, in a test | the reason, the fix, the element |

## What it does not do for you

The criteria that need a person: whether a colour is the only thing carrying a meaning (1.4.1),
whether the reading order is the meaning's order (1.3.2), a heading that describes its section
(2.4.6), a time limit someone can extend (2.2.1), navigation that stays put from page to page
(3.2.3), an error message that says what to do (3.3.3). Write those, then run the audit and the
walk over what you wrote.
