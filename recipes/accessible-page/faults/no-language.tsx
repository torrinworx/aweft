// A page with no `lang`. The mount throws before anything is on the page, and `main.ts` reads
// the throw off the browser as a page error.

import { h, mount } from '@aweftjs/ui';

const page = globalThis as unknown as { document: { body: unknown } };

mount(page.document.body as never, <p>never shown</p>);
