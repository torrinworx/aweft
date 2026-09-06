// What the browser runs: mount the gallery into the page.

import { mount } from '@aweftjs/ui';

import { App } from './page.tsx';

mount(document.body as never, <App />);
