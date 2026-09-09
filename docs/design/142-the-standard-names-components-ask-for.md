# 142: The standard names components ask for, and the `+standard` selection

## Decision

**A component asks for a name, never for a drawing.** Everything in `ui` that shows an icon names
one of a short list, and the application decides what that name draws by putting a pack in front
of whatever else is in `Icons`. That is what makes "define your own `left-chevron`" work: the
application's pack answers first and the component never knew.

**The list is `standardIcons`, exported by `ui`.** One frozen array, in the spelling the sets
already use:

```
chevron-down, chevron-up, chevron-left, chevron-right, check, x, triangle-alert, search, upload
```

`upload` is on the list because `FileDrop` shows one in its prompt; the two chevrons, `x` and
`triangle-alert` are there for the controls. It is one list rather than three, because the
components, an application checking its pack covers them, and the `+standard` selection all have
to be reading the same names.

The spelling is the one the sets use, not one of our own. A name a set already publishes means an
application can hand over `@aweftjs/icons/lucide` unchanged and every component works; a name of
our own would mean an alias table in every application.

**`@aweftjs/icons/<set>/+standard` is those names taken from one set.** It is an `IconPack` holding
only the standard names that set actually has, so `<Icons value={standard}>` costs about ten icons
instead of a whole set. A name the set lacks is left out rather than refused, and the application
adds it with a pack of its own in front.

**The spelling is `+standard`.** An Iconify icon name is lowercase letters, digits and dashes, so
a leading `+` is a name no set can publish and this path can never collide with an icon. Plain
`standard` was rejected: it is a legal icon name, and a set that published one could not then be
reached at all.

**`ui` publishes the same list on a subpath of its own, `@aweftjs/ui/icon-names`.** A build-time
tool cannot import `ui`'s main entry: `@aweftjs/build`'s Node loader runs on the hooks thread,
where its own transform does not apply, so pulling in `ui`'s `.tsx` files would be a syntax error
before the first icon resolved. The subpath is one plain `.ts` file with no imports, and
`standardIcons` is on `ui`'s main entry as well, for an application.

**`icons` imports `ui`.** It builds `IconData` and `IconPack` in `ui`'s shapes and reads
`standardIcons` to make the selection. Same tier, same plane, and `ui` knows nothing about
`icons`, so `boundaries.json` names the edge one way.

## Why

Components ask for standard names so that an application can define its own `chevron-left` once
and every component follows it.

The list is short on purpose. Every name on it is a name a component in this package actually
passes to `Icon`; a name nothing asks for is an application's business and belongs in its own
pack. A long list would make the `+standard` selection large and would put names in front of an
application that it has to answer for no reason.

`triangle-alert` rather than `alert`, because that is the name the sets publish for that drawing,
and a name that is nearly right is worse than one that is unfamiliar: it resolves to nothing and
the reader has to go looking.

## What this costs

A set whose names are not these needs a pack in front translating them, which is one object in the
application. Only the sets that follow the common spelling work with nothing.

`+standard` reads oddly in an import. That is the price of a segment that can never be an icon,
and it is paid once per application.

## What would reverse this

A set spelling that a majority of sets move to, which would change the list rather than the rule.
