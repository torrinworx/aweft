// What the browser runs. `replay` hands the client the answers the server rendered this page
// with, so the hydration asks the server nothing. `attach` takes the server's markup over in place.

import { createClient } from '@aweftjs/client';
import { createRouter } from '@aweftjs/dom/router';
import { attach, replay } from '@aweftjs/ssg/client';
import { h } from '@aweftjs/ui';

import { Site } from './site.tsx';

const router = createRouter();
const client = replay(createClient());
const page = attach(document.body as never, <Site router={router} client={client} />);
router.links(document.body as never);

// The recipe's browser run waits on this. An entry that measures nothing leaves it out.
(globalThis as { hydrated?: Promise<void> | undefined }).hydrated = (page as { ready?: Promise<void> }).ready;
