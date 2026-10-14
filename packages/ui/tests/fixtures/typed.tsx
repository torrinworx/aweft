// Call sites written the way an application writes them, read by the root typecheck (design 308).
//
// Each refusal is pinned with `@ts-expect-error`, so a refusal that stops happening is itself a
// type error. A refused call sits in a function `types.test.ts` never calls.

import { type Cell, mutable } from '@aweftjs/core';
import { type Act, type ActProps, type Component, type StageValue, h } from '@aweftjs/ui';

export interface Item {
	readonly id: string;
	readonly label: string;
}

export const items: readonly Item[] = [{ id: 'a', label: 'Apples' }, { id: 'b', label: 'Bread' }];

/** A row typed by its item, called with the list. */
export const Row = (props: { each: Item; picked: Cell<string | null> }): unknown =>
	<li data-id={props.each.id}><button type="button" onClick={() => props.picked.set(props.each.id)}>{props.each.label}</button></li>;

/** A component written before the item had a type keeps working. */
const Loose = (props: { each?: unknown }): unknown => <li>{String(props.each)}</li>;

export const List = (props: { picked: Cell<string | null>; extra: Cell<string[]> }): unknown => (
	<ul>
		<Row each={items} picked={props.picked} />
		<Row each={new Set(items)} picked={props.picked} />
		{/* Written against the old type, which took a list only cast to its item: still compiles. */}
		<Row each={items as unknown as Item} picked={props.picked} />
		<Loose each={props.extra} />
	</ul>
);

/** The same rows through `h`, with an inline callback whose parameter is typed by the prop. */
const Picker = (props: { each: Item; onPick(item: Item): void }): unknown =>
	h('button', { type: 'button', onClick: () => props.onPick(props.each) }, props.each.label);

export const picker = (seen: string[]): unknown =>
	h('div', null, h(Picker, { each: items, onPick: (item) => seen.push(item.id.toUpperCase()) }));

/** Acts that declare what the stage hands them. */
const Home = (props: { stage: StageValue }): unknown => <main>{props.stage.current}</main>;
const Post = (props: ActProps & { readonly note?: string }): unknown =>
	<main>{props.stage.params.map((held) => held['id'] ?? '')}{props.note ?? ''}</main>;
const Retry = (props: { stage: StageValue; refusal: unknown; retry: () => void }): unknown =>
	<main><button type="button" onClick={props.retry}>{String(props.refusal)}</button></main>;

interface FailedProps extends ActProps {
	readonly refusal: Error;
}
const Failed = (props: FailedProps): unknown => <main>{props.refusal.message}</main>;

export const acts: Readonly<Record<string, Act>> = { '': Home, 'posts/:id': Post, retry: Retry, failed: Failed, about: 'site/About' };

/** A component that takes any component as a prop takes one with props of its own. */
const Holder = (props: { act: Component }): unknown => <section>{h(props.act, null)}</section>;
export const held = (): unknown => h(Holder, { act: Home });

export const open: Cell<boolean> = mutable(false);

const picked = mutable<string | null>(null);

export const refused = {
	// @ts-expect-error a list of numbers where the row declares an Item
	numbers: () => <Row each={[1, 2]} picked={picked} />,
	// @ts-expect-error a cell of the wrong item
	cell: () => <Row each={mutable([1])} picked={picked} />,
	// @ts-expect-error a prop the row does not declare, through h, where JSX lets any attribute through
	extra: () => h(Row, { each: items, picked, colour: 'red' }),
	// @ts-expect-error h checks a component's props as JSX does
	direct: () => h(Picker, { each: items, onPick: (item: number) => item }),
	// @ts-expect-error and its required ones
	missing: () => h(Picker, { each: items }),
	// @ts-expect-error a cell typed for one value is not a cell for another
	mistyped: (): Cell<number> => mutable('one'),
};

const Wrong = (props: { stage: number }): unknown => props.stage;
// @ts-expect-error an act whose stage is not a StageValue
export const wrongAct: Act = Wrong;
