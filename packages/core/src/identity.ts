// Reading an observable's identity and where it lives.

import { codecError, idToText, type ObservableKind } from '@aweftjs/codec';

import { isReachable as reachable, lookup } from './node.ts';
import type { Node } from './types.ts';
import { nodeOf } from './value.ts';

const need = (observable: unknown): Node => {
	const node = nodeOf(observable);
	if (node === undefined) throw codecError('not-observable', 'this is not an observable');
	return node;
};

/**
 * An observable's id.
 *
 * Params:
 *   observable: any observable
 *
 * Returns: its 12 bytes of id. Two replicas agree on which observable a change is about by
 * this and nothing else. It is published to everyone who can read the document, so it is
 * never a credential.
 *
 * Example:
 *   const mirror = createObject(undefined, idOf(doc));
 */
export const idOf = (observable: unknown): Uint8Array => need(observable).id;

/**
 * The same id in text form.
 *
 * Params:
 *   observable: any observable
 *
 * Returns: sixteen base64url characters, safe in a URL, a log line, or a key in a plain
 * object. It is the form a map slot is named by.
 *
 * Example:
 *   history.set(textIdOf(entry), createObject({ opened: true }));
 */
export const textIdOf = (observable: unknown): string => need(observable).key;

/**
 * Which of the three kinds this is.
 *
 * Params:
 *   observable: any observable
 *
 * Returns: 'object', 'array' or 'map'. The kind never changes, and a commit that calls one
 * observable two kinds is refused.
 *
 * Example:
 *   if (kindOf(value) === 'array') count = (value as unknown[]).length;
 */
export const kindOf = (observable: unknown): ObservableKind => need(observable).kind;

/**
 * Where an observable lives.
 *
 * Params:
 *   observable: any observable
 *
 * Returns: the observable holding its one attach edge, or undefined when nothing does, which
 * is the case for a document root and for anything that has been detached.
 *
 * A reference from somewhere else is an alias and does not answer this question, which is the
 * point: where something lives is a walk up, never a search.
 *
 * Example:
 *   const list = parentOf(entry); // the array the entry sits in, or undefined
 */
export const parentOf = (observable: unknown): object | undefined => need(observable).parent?.proxy;

/**
 * Can this observable still be written to?
 *
 * Params:
 *   observable: any observable
 *
 * Returns: true while an attach path from the document root reaches it. Detaching an
 * observable takes that path away, and a write to it then throws `unreachable`, which is
 * exactly what a receiver does with the same delta.
 *
 * `parentOf` cannot answer this: it returns undefined both for a document root, which is
 * reachable, and for something detached, which is not. Ask here rather than by catching the
 * throw, because control flow through an error hides the ordinary case.
 *
 * Example:
 *   if (isReachable(task)) task.done = true;
 */
export const isReachable = (observable: unknown): boolean => reachable(need(observable));

/**
 * The observable in a document with a given id.
 *
 * Params:
 *   document: any observable in the document
 *   id: the twelve bytes a delta carries, or the same id in text form
 *
 * Returns: the observable, or undefined when the document holds nothing by that id. An
 * observable that lost its attach edge is not found: the commit that detached it took it out
 * of the document as it closed, and attaching it again re-sends its contents (design 084).
 * Hold the observable itself if you need it after a detach, and ask `isReachable` whether it
 * is still in the document.
 *
 * Example:
 *   const task = byId(board, delta.id);
 */
export const byId = (document: unknown, id: Uint8Array | string): object | undefined =>
	lookup(need(document).root, typeof id === 'string' ? id : idToText(id))?.proxy;

/**
 * The attach path from the document root down to an observable.
 *
 * Params:
 *   observable: any observable
 *
 * Returns: the slot names from the root down, spelled the way the format spells a slot: an
 * object key, a map id in text form, an array position in hex. Empty for the root, and
 * undefined for anything nothing attaches. A walk up the parent pointers, so it costs the
 * depth and never the document.
 *
 * Example:
 *   pathOf(task);   // ['tasks', '80a1c2e3']
 */
export const pathOf = (observable: unknown): readonly string[] | undefined => {
	const node = need(observable);
	const steps: string[] = [];
	let at = node;
	while (at.parent !== null) {
		steps.push(at.slot!);
		at = at.parent;
	}
	return at === node.root ? steps.reverse() : undefined;
};
