// Names: the one kind of thing a person can hold, and the check over them (design 289).
//
// Pure, and shared by both planes: the server module reads the store and hands the list here,
// the page reads the shared document and does the same, so one function is the answer.

/** A table from a name to the names it implies. */
export type Implies = Readonly<Record<string, readonly string[]>>;

/** Non-empty text with no whitespace in it. */
export const isName = (value: unknown): value is string =>
	typeof value === 'string' && value !== '' && !/\s/.test(value);

/** Does holding `held` cover `name`: the same, everything, or a dotted parent of it. */
const covers = (held: string, name: string): boolean =>
	held === '*' || held === name || name.startsWith(`${held}.`);

/**
 * Does a person who was granted `granted` hold `name`.
 *
 * True when a granted name covers it, or a name the table says a granted name implies does,
 * transitively. Holding a name covers every name under it: `products` covers
 * `products.abc123.read`, and `*` covers everything. The table is keyed by the exact name held,
 * so holding `admin.super` implies what `admin.super` lists and not what `admin` does.
 *
 * Params:
 *   granted: the names the person was granted
 *   implies: the table, from a name to the names it implies; a cycle in it is fine
 *   name: the name asked about
 *
 * Returns: whether the person holds it.
 *
 * Example:
 *   holds(['admin'], { admin: ['*'] }, 'posts.delete');            // true
 *   holds(['products.abc123'], {}, 'products.abc123.read');        // true
 *   holds(['products.abc123'], {}, 'products.def456.read');        // false
 */
export const holds = (granted: readonly string[], implies: Implies, name: string): boolean => {
	const seen = new Set<string>();
	const queue = [...granted];
	while (queue.length > 0) {
		const held = queue.pop()!;
		if (seen.has(held)) continue;
		seen.add(held);
		if (covers(held, name)) return true;
		const more = Object.hasOwn(implies, held) ? implies[held]! : [];
		for (const implied of more) queue.push(implied);
	}
	return false;
};
