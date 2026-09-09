// What the browser runs: one router over this page's hash, and the catalogue mounted on it.
//
// The base is the page's own path with a `#` on the end, so what the router reads as its path is
// the hash and the server only ever sees `catalogue.html` (design 226).

import { createRouter } from '@aweftjs/dom/router';
import { h, mount } from '@aweftjs/ui';

import { Catalogue } from './catalogue.tsx';

const router = createRouter({ base: `${location.pathname}#` });
mount(document.body as never, <Catalogue router={router} />);
