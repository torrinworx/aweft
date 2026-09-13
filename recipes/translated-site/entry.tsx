// What the browser runs, for a page in any of the site's languages (design 279).
//
// The language is read off the page, the catalog for it is one import, and the same entry takes
// over a generated page or mounts the plain shell. The stored act is compiled here too, against
// a bridge made from what this bundle already holds, because a module compiled at run time has
// no bundler to resolve `@aweftjs/ui` for it.

import { createRouter } from '@aweftjs/dom/router';
import { attach, languageOf } from '@aweftjs/ssg/client';
import { context, h, template, text } from '@aweftjs/ui';

import { Site, sourcesWith } from './site.tsx';
import { compileWith } from './stored.ts';

// The catalogs the bundle holds, one chunk each; the source language has none and needs none.
const catalogs: Record<string, () => Promise<{ default: Record<string, string> }>> = {
	fr: () => import('./text/fr.json'),
	uk: () => import('./text/uk.json'),
};
const { locale, base } = languageOf(document as never);
const catalog = (await catalogs[locale]?.())?.default;

// The bridge: a module whose exports are this bundle's own, reached by URL.
(globalThis as { aweftUi?: unknown }).aweftUi = { h, template, text };
const bridge = URL.createObjectURL(new Blob(['export const { h, template, text } = globalThis.aweftUi;'], { type: 'text/javascript' }));

const router = createRouter({ base });
performance.mark('attach-start');
attach(document.body as never, <Site router={router} sources={sourcesWith(compileWith(bridge))} />, context({ locale, catalog }));
performance.mark('attach-end');
performance.measure('attach', 'attach-start', 'attach-end');
router.links(document.body as never);
