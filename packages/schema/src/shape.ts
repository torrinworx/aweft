// The three words: what an object, an array and a map are allowed to hold.
//
// One word per observable kind and nothing else. Everything below a slot is either another
// one of the three or a leaf, and a leaf is somebody else's validator, so the description
// language stops here rather than growing a type system of its own.

import type { StandardSchema } from './standard.ts';

/** What a slot may hold: a leaf validator, or another observable described. */
export type Field = Shape | StandardSchema;

interface ShapeOf {
	readonly kind: 'object';
	readonly fields: Readonly<Record<string, Field>>;
}

interface ListOf {
	readonly kind: 'array';
	readonly item: Field;
}

interface TableOf {
	readonly kind: 'map';
	readonly value: Field;
}

/**
 * A described observable: an object, an array or a map, and what it may hold.
 *
 * The three factories below are the only way to make one, and `kind` is the observable kind
 * it describes, so a description and a document are compared by the same word.
 */
export type Shape = ShapeOf | ListOf | TableOf;

/** A leaf is anything carrying the Standard Schema property; everything else is a Shape. */
export const isLeaf = (field: Field): field is StandardSchema => '~standard' in field;

/**
 * Describe an object observable: the slots it may hold, by name.
 *
 * Params:
 *   fields: each slot the object may hold, as a leaf validator or another description
 *
 * Returns: the description. Every named field is expected to be there; a field that may be
 * absent is one whose validator accepts `undefined`, because that is the same question.
 *
 * A slot the description does not name is refused, so an object says exactly what it holds.
 *
 * Example:
 *   const Task = shape({ title: text, done: flag, tags: list(text) });
 */
export const shape = (fields: Readonly<Record<string, Field>>): Shape => ({ kind: 'object', fields });

/**
 * Describe an array observable: what every element must be.
 *
 * Params:
 *   item: the one description every element is held to
 *
 * Returns: the description. An array has no required length: an empty one is fine, and
 * removing an element is always fine.
 *
 * Example:
 *   const Tasks = list(shape({ title: text }));
 */
export const list = (item: Field): Shape => ({ kind: 'array', item });

/**
 * Describe a map observable: what every entry must be.
 *
 * Params:
 *   value: the one description every entry is held to
 *
 * Returns: the description. Entries are named by id, so the description says what is filed,
 * never which ids exist. Removing an entry is always fine.
 *
 * Example:
 *   const People = table(shape({ name: text }));
 */
export const table = (value: Field): Shape => ({ kind: 'map', value });
