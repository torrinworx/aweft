// What the browser runs: one router, the site mounted, and the anchors handed to the router.

import { createRouter } from '@aweftjs/dom/router';
import { h, mount } from '@aweftjs/ui';

import { Site } from './site.tsx';

const router = createRouter();
mount(document.body as never, <Site router={router} />);
router.links(document.body as never);
