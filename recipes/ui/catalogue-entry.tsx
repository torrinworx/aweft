// What the browser runs: mount the catalogue.

import { mount } from '@aweftjs/ui';

import { Catalogue } from './catalogue.tsx';

mount(document.body as never, <Catalogue />);
