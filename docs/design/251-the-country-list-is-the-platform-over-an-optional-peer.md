# 251: Country names are the platform's, codes and subdivisions are an optional peer's

## Decision

Three sources, and which one answers what is the design.

**The names are `Intl.DisplayNames`.** `new Intl.DisplayNames([locale], { type: 'region' }).of('KR')`
is `South Korea`, and in French it is `Corée du Sud`. The host ships CLDR and keeps it current, so
this package ships no list of country names in any language, and a page in French shows French
names without asking for them. `Country` takes a `locale`; with none it uses the host's own.

**The codes and the subdivisions are `country-region-data`, an optional peer** (design 140). It is
the one thing here that is not derivable: which 249 territories exist, and what the subdivisions of
each are, with the short code of each one. Its own country names are the formal ISO spellings, and
40 of its 249 differ from the name a person would type (`Korea, Republic of`,
`Russian Federation`), so its names are not read at all.

**The flag is the code.** Two regional indicator symbols, `String.fromCodePoint` of the two letters
plus the offset from `A` to `U+1F1E6`. No flag data ships either. A host with no flag glyphs draws
the two letters, which is a country code beside a country name and reads as one.

**The aliases are this package's**, because nothing else has them: `UK` for `GB`, `USA` and
`America` for `US`, `UAE`, `Holland`, `Burma`. 1,368 bytes over 48 codes, which is the ones a person
actually types.
They live on the data subpath, not the root entry, so a page with no country field carries none of
them.

### The handover is a context, not an import

`Country` and `Region` are in the root entry and the root entry never names the peer, so the data
cannot arrive by import. It arrives the way an icon pack does (design 144): a provider over the
components, holding the codes, the subdivisions and the aliases.

```tsx
import { Countries, Country, Region } from '@aweftjs/ui';
import { countryData } from '@aweftjs/ui/countries';

const data = await countryData();

<Countries value={data}>
	<Country label="Country" value={country} name="country" autocomplete="country" />
	<Region label="Province" value={region} country={country} name="region" />
</Countries>
```

`CountryData` is an interface, so an application that allows five countries hands over five codes
and its own `regions`, installs no peer, and needs nothing from the subpath. That is the same shape
as a pack handed to `Icons`, and it is what keeps "which countries a form allows" out of here.

**A component with no provider above it is a loud assert** naming the provider and the subpath. A
control that quietly drew an empty list would look as though the data were empty.

### Two derivations ship as well

`flagOf(code)` and `localeRegion()` are on the root entry beside the components. Neither is needed to
use a field, and both are exported for the same reason: they are the two derivations a page would
otherwise write again, and both are easy to write wrongly. A flag is arithmetic on two code points
that a hand-rolled version gets wrong for a lowercase code or a three-letter one; the guess is a walk
down `navigator.languages` with a `maximize()` behind it, and the version most pages would write
reads `navigator.language` alone and calls `en` American. A page that wants a flag beside a chosen
country, or a shipping default from the browser's settings, has them.

### The refusal, and where it actually lands

`countryData()` is async and reaches the peer through `await import('country-region-data')` in a
`try`, so a missing peer is `codecError('countries-not-installed', …)` carrying
`npm install country-region-data`, which is design 140's shape.

In Node that is the refusal a caller sees. In a bundler it is not: an import a bundler cannot
resolve fails the build before any of this runs, with the bundler's own message naming the same
package. Both name the package to install, and the run-time refusal is the one a program can catch.

## Why

The measurements that decided it:

- The host has a name for all 249 codes, and 40 of the peer's own names are not the name a person
  would type for that country. So the names come from the host: shipping a list of them would be
  shipping one language, out of date the year a country renames itself, and absent in every other
  language a page might be in.
- The subdivision counts are not what a dropdown assumes: `GB` has 217, `SI` 206, `LV` 119, the
  median country has 11, and 59 countries have more than 20. So the subdivision control is the same
  searched list as the country one, and no size threshold decides between two controls.
- `country-region-data` is 633 KB unpacked, which is why it is an optional peer and not a
  dependency. `allCountries` has the same shape in its 3 and 4 lines, so the peer range is both.

## What this costs

**A server and a browser whose CLDR data disagree refuse the hydration.** The two ends resolve the
same code through two ICU builds, and where those builds disagree about a name (`Türkiye` for
`Turkey`, `Czechia` for `Czech Republic`) `dom` refuses with both names in the message rather than
leaving the wrong one on the screen. That is `dom`'s rule for any text the two ends disagree about
and it is not softened here.

Two things keep the exposure small. The grid is drawn the first time the dialog opens, so a static
render emits the control, the dialog and the element a form posts, and none of the 249 rows: nobody
can read a row inside a closed dialog, and rows in the markup are 249 more chances to disagree. What
is left is the name of a country that was already chosen when the page was rendered. A form that
starts empty, which is what these do, has nothing there to disagree about.

`locale` pins the language. It cannot pin the data, and an application that renders a chosen country
statically and needs to be sure keeps its server and its browsers on ICU data that agrees, or hands
`Countries` a `CountryData` of its own.

The subdivision names are English, because that is what the peer has. `Intl.DisplayNames` has no
subdivision type to fall back to, so a page in French shows French country names and English
province names until an application hands over its own `regions`.
