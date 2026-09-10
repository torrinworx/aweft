// Region: the subdivisions of one country, in the same dialog with the same search (design 251).
//
// A page of its own because it is a field of its own: an address form that already knows the country
// asks for the province and nothing else. The pair driven together is on the Country page.

import { mutable } from '@aweftjs/core';
import { Countries, Region, h } from '@aweftjs/ui';
import { countryData } from '@aweftjs/ui/countries';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

const data = await countryData();

export const name = 'Region';
export const order = 19;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const state = mutable<unknown>('NY');
	const province = mutable<unknown>(null);
	const council = mutable<unknown>(null);

	return (
		<Countries value={data}>
			<div theme="column">
				<Region id={at('region-us')} label="State" value={state} country="US" name="state" />
				<Region
					id={at('region-ca')}
					label="Province or territory"
					value={province}
					country="CA"
					placeholder="Pick one"
					description="Thirteen of them, searched by name or short code."
				/>
				{/* The longest subdivision list the data has: 217 rows, which is the case a dropdown
				    cannot serve and the reason this field is the searched dialog (design 251). */}
				<Region
					id={at('region-gb')}
					label="Council area"
					value={council}
					country="GB"
					placeholder="Pick one"
				/>

				<p theme={['text', 'sm', 'muted']}>With no country there is nothing to open</p>
				<Region id={at('region-none')} label="Province" placeholder="Pick a country first" />
				<Region
					id={at('region-error')}
					label="State"
					country="US"
					error="We do not ship to that state"
				/>

				<p theme={['text', 'sm', 'muted']}>Sizes</p>
				<Region id={at('region-sm')} aria-label="Small region" country="CA" size="sm" placeholder="Small" />
				<Region id={at('region-md')} aria-label="Default region" country="CA" placeholder="Default" />
				<Region id={at('region-lg')} aria-label="Large region" country="CA" size="lg" placeholder="Large" />
			</div>
		</Countries>
	);
};
