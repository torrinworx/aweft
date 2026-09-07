// What the browser runs: mount the controls page.

import { mount } from '@aweftjs/ui';

import { Gallery } from './controls.tsx';

mount(document.body as never, <Gallery />);
