# Start

Install two packages, render a page, boot a server, then put the two in one directory. Each step
is a program you can run, and each one is the first half of something the recipes finish.

## Install

```sh
npm i @aweftjs/core @aweftjs/ui
```

Node 24.12 or later. Every package is `@aweftjs/<name>`; `packages/` lists them all with what
each is for, and an application installs only the ones it imports. A published package carries
compiled JavaScript, so nothing here needs a build step to run.

## The first page

A page is components, and a component is a function that returns markup. State a component
follows is a cell, `mutable(0)`, and writing the cell moves the page.

```tsx
import { mutable } from '@aweftjs/core';
import { h, mount } from '@aweftjs/ui';

const Counter = () => {
	const clicks = mutable(0);
	return <button theme="button" onClick={() => clicks.set(clicks.get() + 1)}>clicked {clicks} times</button>;
};

mount(document.body, <Counter />);
```

`theme="button"` is what makes it a button: the default theme ships in light and dark, and a
component of `@aweftjs/ui` is a native element on a theme entry. The JSX compiles to `h` through
the vite plugin from `@aweftjs/build`, which is the one plugin a page needs:

```ts
import { defineConfig } from 'vite';
import { aweft } from '@aweftjs/build';

export default defineConfig({ plugins: [aweft({ defaultH: '@aweftjs/ui' })] });
```

`defaultH` says which `h` a file with no import of its own compiles to, and `@aweftjs/ui`'s is
the one that knows about themes. `packages/ui/README.md` is every component and the theme;
`packages/build/README.md` is what the plugin does to a file.

## The first server

A server is a boot file and a directory of modules. The boot names the store, the listener, the
sources and the gate; everything the server does is a module.

```ts
import { auth, paths } from '@aweftjs/auth';
import { fromDirectory } from '@aweftjs/modules/node';
import { createServer } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { createStore, memoryDriver } from '@aweftjs/store';

const store = createStore({ driver: memoryDriver(), declare: { ...paths } });
const server = createServer({ sources: [fromDirectory('./modules'), auth], store, gate: 'auth/Gate', listener: node({ port: 8080 }) });
await server.start();
```

A module in `./modules` shares a document by name or answers a call. A page shares the same
name and holds the same object, over one socket that carries the documents and the calls.
`packages/server/README.md` is the hooks a module gets, `packages/modules/README.md` what a
module may return, and `packages/auth/README.md` the gate, the sessions and sign-in.

## The two halves in one directory

`recipes/full-stack/` is the scaffold: a page and a server in one directory, with the seam
between them wired the way development needs. The page comes from vite's dev server, and the
backend goes behind it, so the session cookie belongs to the one origin both share. Its README
carries the application's `package.json`, the `tsconfig` shape and the vite config with the
proxy, and `recipes/backend/` is the boot pattern with one module of each kind.

Copy the shape, not the files. Then read `three-ideas` on this site, and `building` for the five
rules an application trips on and the loop for a page.

## What this does not do for you

Production serving: the proxy is development only, and in production something serves the built
page on the same origin as the socket. `deploying` on this site is one way. A gate of your own,
past "is this somebody": a module that depends on `auth/Gate`. Anything the store keeps past the
process: `memoryDriver` forgets everything when the backend stops, and
`recipes/documents-on-postgres/` is the driver that does not.
