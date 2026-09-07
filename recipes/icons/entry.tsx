// What the browser runs: mount the page, with the icon route beside it.

import { fromUrl } from '@aweftjs/icons';
import { mount } from '@aweftjs/ui';

import { Site } from './page.tsx';

mount(document.body as never, <Site icons={fromUrl('/icons')} />);
