// What the browser runs: mount the preview into the page.

import { mount } from '@aweftjs/ui';

import { Preview } from './preview.tsx';

mount(document.body as never, <Preview />);
