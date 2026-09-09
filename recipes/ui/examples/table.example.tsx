// Table: rows of data in the element the platform has for them, inside a box that scrolls.
//
// The entries are usable on their own, so the second table here is written as markup rather than as
// a component, which is what an application with its own shape does (design 201).

import { mutableArray } from '@aweftjs/core';
import { Badge, Table, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Table';
export const order = 67;

const FILES = [
	{ name: 'shot.png', kind: 'image', size: '1.2 MB' },
	{ name: 'notes.md', kind: 'text', size: '4 kB' },
	{ name: 'talk.pdf', kind: 'document', size: '820 kB' },
];

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const rows = mutableArray([...FILES]);

	return (
		<div theme="column">
			<p theme={['text', 'sm', 'muted']}>Columns, rows and a cell function</p>
			<Table
				id={at('table')}
				columns={[
					{ key: 'name', label: 'Name' },
					{ key: 'kind', label: 'Kind' },
					{ key: 'size', label: 'Size', align: 'right' },
				]}
				rows={rows}
				cell={(row: unknown, column: { key: string }) => {
					const file = row as { name: string; kind: string; size: string };
					return column.key === 'kind'
						? h(Badge, { label: file.kind, type: 'quiet', size: 'sm' })
						: file[column.key as 'name' | 'size'];
				}}
				caption="Everything in this folder"
				foot="3 files"
			/>

			<p theme={['text', 'sm', 'muted']}>Striped and tight, with the columns written as strings</p>
			<Table id={at('table-striped')} columns={['name', 'size']} rows={FILES} striped={true} tight={true} />

			<p theme={['text', 'sm', 'muted']}>The entries on their own, with no component at all</p>
			<div theme="table_scroll" tabindex="0">
				<table theme="table" id={at('table-markup')} aria-label="Written as markup">
					<thead theme="table_head">
						<tr>
							<th scope="col" theme="table_heading">Name</th>
							<th scope="col" theme={['table_heading', 'right']}>Size</th>
						</tr>
					</thead>
					<tbody>
						<tr theme="table_line">
							<td theme="table_cell">shot.png</td>
							<td theme={['table_cell', 'right']}>1.2 MB</td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>
	);
};
