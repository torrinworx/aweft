// Cells: reactive values outside the document (design 024).
//
// A cell produces no deltas and joins no commit. It is interface state: local by
// construction, with the same value surface as everything else. `toCell` refuses to put one
// in a document slot, which is where the two lifetimes are kept from blurring.

import { dispatch } from './transaction.ts';
import { type Derived, type Source, chain, sourceOf } from './derived.ts';

// Every subscriber is marked before anything settles, in one job, so a burst source cannot
// let a combined value compute against half its subscribers told (design 023).
const markAll = (marks: Set<() => void>): void => {
	dispatch([() => {
		for (const mark of [...marks]) mark();
	}]);
};

/**
 * A standalone reactive value.
 *
 * Params:
 *   initial: the value it starts with
 *
 * Returns: a chain whose `set` writes the cell. A write to an equal value (`Object.is`)
 * changes nothing and notifies nobody. Cells are not observables: assigning one into a
 * document slot is refused, because a cell does not replicate and a document does.
 *
 * Example:
 *   const open = mutable(false);
 *   open.watch((now) => menu.hidden = !now);
 *   open.set(true);
 */
export const mutable = <T>(initial: T): Derived<T> => {
	let value = initial;
	const marks = new Set<() => void>();

	const source: Source = {
		read: () => value,
		attach: (mark) => {
			marks.add(mark);
			return () => marks.delete(mark);
		},
		write: (next) => {
			if (Object.is(next, value)) return;
			value = next as T;
			markAll(marks);
		},
		immutable: () => false,
	};

	return chain<T>(source);
};

/**
 * A read-only view.
 *
 * Params:
 *   value: a chain, cell or scope to wrap read-only, or any plain value to carry as a
 *          constant
 *
 * Returns: a chain that reads what `value` reads and can never be written. Wrapping a chain
 * keeps its changes flowing; wrapping a plain value never delivers one.
 *
 * Example:
 *   const label = immutable('untitled');
 *   const width = immutable(observer(doc).path('width'));
 */
export function immutable<T>(value: Derived<T>): Derived<T>;
export function immutable<T>(value: T): Derived<T>;
export function immutable(value: unknown): Derived<unknown> {
	const source = sourceOf(value);
	if (source !== undefined) {
		return chain({ read: source.read, attach: source.attach, immutable: () => true });
	}
	return chain({
		read: () => value,
		attach: () => () => undefined,
		immutable: () => true,
	});
}

/**
 * A cell that counts up while something observes it.
 *
 * Params:
 *   ms: milliseconds between ticks
 *
 * Returns: a chain of the tick count. The interval runs only while the chain is observed;
 * an abandoned timer holds nothing. Map over it for a clock:
 *
 * Example:
 *   timer(1000).map(() => new Date().toLocaleTimeString()).effect(show);
 */
export const timer = (ms: number): Derived<number> => {
	let ticks = 0;
	const marks = new Set<() => void>();
	let handle: ReturnType<typeof setInterval> | null = null;

	const source: Source = {
		read: () => ticks,
		attach: (mark) => {
			marks.add(mark);
			if (handle === null) {
				handle = setInterval(() => {
					ticks += 1;
					markAll(marks);
				}, ms);
			}
			return () => {
				marks.delete(mark);
				if (marks.size === 0 && handle !== null) {
					clearInterval(handle);
					handle = null;
				}
			};
		},
	};

	return chain<number>(source);
};

/** Anything events can be heard from. Structural on purpose: core knows no DOM. */
export interface EventEmitting<E> {
	addEventListener(type: string, listener: (event: E) => void): void;
	removeEventListener(type: string, listener: (event: E) => void): void;
}

/**
 * A cell of the last event of a type, or undefined before the first one.
 *
 * Params:
 *   target: anything with addEventListener and removeEventListener
 *   type: the event type to hear
 *
 * Returns: a chain of the most recent event. The listener is registered only while the
 * chain is observed.
 *
 * Example:
 *   fromEvent(window, 'resize').wait(100).effect(relayout);
 */
export const fromEvent = <E>(target: EventEmitting<E>, type: string): Derived<E | undefined> => {
	let last: E | undefined;
	const marks = new Set<() => void>();
	let listening = false;

	const handler = (event: E): void => {
		last = event;
		markAll(marks);
	};

	const source: Source = {
		read: () => last,
		attach: (mark) => {
			marks.add(mark);
			if (!listening) {
				listening = true;
				target.addEventListener(type, handler);
			}
			return () => {
				marks.delete(mark);
				if (marks.size === 0 && listening) {
					listening = false;
					target.removeEventListener(type, handler);
				}
			};
		},
	};

	return chain<E | undefined>(source);
};
