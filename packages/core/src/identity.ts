// Reading an observable's identity and where it lives.

import { codecError, type ObservableKind } from '@aweftjs/codec';

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
 */
export const parentOf = (observable: unknown): object | undefined => need(observable).parent?.proxy;
