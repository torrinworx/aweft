// What the browser runs, for a page this build wrote and for the plain shell alike.
//
// `attach` reads the stamp on the body: a generated page is taken over in place, and the shell an
// unenumerated URL is served is mounted live. One entry, both cases.

import { createRouter } from '@aweftjs/dom/router';
import { attach } from '@aweftjs/ssg/client';
import { h } from '@aweftjs/ui';

import { Page } from './page.tsx';

const router = createRouter();

// The recipe's browser run reads this measurement off the page. A real entry that never measures
// anything drops the two marks and keeps the line between them.
performance.mark('attach-start');
attach(document.body as never, <Page router={router} />);
performance.mark('attach-end');
performance.measure('attach', 'attach-start', 'attach-end');

router.links(document.body as never);
