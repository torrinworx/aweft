// Accordion: a stack of disclosures sharing one name, which is what makes the platform keep one of
// them open (design 202). Nothing here watches anything.

import { Accordion, DropDown, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Accordion';
export const order = 47;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);

	return (
		<div theme="column">
			<p theme={['text', 'sm', 'muted']}>Three sections, one of them open at a time</p>
			<Accordion
				id={at('accordion')}
				type="quiet"
				items={[
					{ label: 'Shipping', content: <p theme={['text', 'sm']}>By post, in two days.</p> },
					{ label: 'Returns', content: <p theme={['text', 'sm']}>Within thirty days.</p> },
					{ label: 'Warranty', content: <p theme={['text', 'sm']}>One year on parts.</p> },
				]}
			/>

			<p theme={['text', 'sm', 'muted']}>The same, written out as drop-downs of your own</p>
			<Accordion id={at('accordion-own')} name={at('facts')}>
				<DropDown name={at('facts')} label="One" type="quiet" theme="accordion_item">
					<p theme={['text', 'sm']}>The first.</p>
				</DropDown>
				<DropDown name={at('facts')} label="Two" type="quiet" theme="accordion_item">
					<p theme={['text', 'sm']}>The second.</p>
				</DropDown>
			</Accordion>
		</div>
	);
};
