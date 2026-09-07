// What the browser runs: mount the composites page.

import { mount } from '@aweftjs/ui';

import { Gallery } from './composites.tsx';

mount(document.body as never, <Gallery />);
