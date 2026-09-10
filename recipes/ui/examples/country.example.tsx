// Country and Region: a button each, a dialog with a search box over a grid, and a form that posts
// the two codes (designs 250 and 251).
//
// The data is read once, here, from the optional peer. A page that does not want the peer builds a
// `CountryData` of its own instead; the shape is three fields.
//
// The form is a real one, with a real submit: what it posts is written into the block under it, so
// what this page shows is what a server would receive.

import { mutable } from '@aweftjs/core';
import { Countries, Country, Region, h } from '@aweftjs/ui';
import { countryData } from '@aweftjs/ui/countries';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

const data = await countryData();

export const name = 'Country';
export const order = 18;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const country = mutable<unknown>(null);
	const region = mutable<unknown>(null);
	const posted = mutable('');

	const chosen = mutable<unknown>('GB');

	return (
		<Countries value={data}>
			<div theme="column">
				<form
					id={at('country-form')}
					theme="field_group"
					onSubmit={(event: unknown) => {
						(event as { preventDefault(): void }).preventDefault();
						const form = (event as { target: unknown }).target;
						posted.set([...new FormData(form)].map(([key, held]) => `${key}=${String(held)}`).join(' '));
					}}
				>
					<Country
						id={at('country')}
						label="Country"
						value={country}
						name="country"
						autocomplete="country"
						placeholder="Pick a country"
						priority={['CA', 'US', 'GB']}
						description="Typing uk, usa or cote finds one."
					/>
					<Region
						id={at('region')}
						label="Province or state"
						value={region}
						country={country}
						name="region"
						placeholder="Pick one"
					/>
					{/* A bare element on the `button` entry: `Button` writes `type="button"` on whatever
					    it is given, so a form's own submit is the element and the theme. */}
					<button theme="button" type="submit" id={at('country-send')}>Send it</button>
				</form>
				<pre theme={['text', 'sm']} id={at('country-posted')}>{posted}</pre>

				<p theme={['text', 'sm', 'muted']}>Chosen, no flags, and one that cannot be opened</p>
				<Country id={at('country-chosen')} label="Where you are" value={chosen} flags={false} suggest={false} />
				<Country id={at('country-off')} label="Locked" disabled={true} placeholder="Pick a country" />
				<Country
					id={at('country-error')}
					label="Country"
					placeholder="Pick a country"
					error="We do not ship there yet"
				/>

				<p theme={['text', 'sm', 'muted']}>Sizes</p>
				<Country id={at('country-sm')} aria-label="Small country" size="sm" placeholder="Small" />
				<Country id={at('country-md')} aria-label="Default country" placeholder="Default" />
				<Country id={at('country-lg')} aria-label="Large country" size="lg" placeholder="Large" />
			</div>
		</Countries>
	);
};
