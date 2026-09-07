// The browser half: one function, and nothing that reads a disk (design 151).
//
// Its own subpath, and the only values it imports are `ui`'s `mount` and `hydrate`, so a page
// bundle that reaches for it carries the walk, the document builder and `node:fs` nowhere.

import type { ParentLike, Remove } from '@aweftjs/dom';
import { type Render, hydrate, mount } from '@aweftjs/ui';

// The only file this half imports besides `ui`, and it holds one string. Nothing in it reads a
// disk, so a page bundle still carries no Node module through this door.
import { STAMP } from './stamp.ts';

/**
 * Take over a generated page, or mount a live one, whichever this document is.
 *
 * Params:
 *   target: the element the page lives in, `document.body` for a page `ssg` wrote
 *   item: the same item the site was rendered from
 *   render: the `ui` systems to use. Omitted, the document's shared render is used, as
 *           `mount` and `hydrate` do
 *
 * Returns: the removal, exactly as `mount` and `hydrate` answer it.
 *
 * A page `ssg` wrote carries `data-aweft-ssg` on its body and is hydrated: the server's elements
 * are adopted in place and nothing flashes. Anything else is mounted. The choice cannot be left to
 * the application, because both mistakes are silent in a different way: mounting over server
 * markup renders the page twice, and hydrating an empty body says the markup ran out.
 *
 * Example:
 *   const router = createRouter();
 *   attach(document.body, h(Site, { router }));
 *   router.links(document.body);
 */
export const attach = (target: ParentLike, item: unknown, render?: Render): Remove => {
	// A mount target is anything with the three node operations, and only an element can carry an
	// attribute, so a target that is not one is the mounting case by construction.
	const element = target as { hasAttribute?(name: string): boolean };
	const generated = typeof element.hasAttribute === 'function' && element.hasAttribute(STAMP);
	return generated ? hydrate(target, item, render) : mount(target, item, undefined, render);
};
