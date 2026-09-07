// What the browser runs. The rows come first, from the file the build wrote beside the pages, so
// the page renders what the server rendered and the hydration finds the two agreeing.

import { createRouter } from '@aweftjs/dom/router';
import { attach } from '@aweftjs/ssg/client';
import { h } from '@aweftjs/ui';

import { Site } from './site.tsx';
import type { Post } from './site.tsx';

const posts = await fetch('/posts.json').then((answer) => answer.json()) as Post[];

attach(document.body as never, <Site router={createRouter()} posts={posts} />);
