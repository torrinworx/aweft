# recipes/full-stack

A page and a server in one directory, with the seam between them wired the way development needs.

This is where an application starts. A session cookie belongs to an origin, so the page and the
socket it opens have to share one. In development the page comes from vite's dev server, so the
backend goes behind it: the dev server forwards `/api` to the backend for the session routes, and
`/ws` to it for the socket. The page then names no host at all: `createAuth` takes its default,
the page's own origin, and `createClient` is given that origin with the socket's path.

```
page/entry.tsx  ──▶  vite dev server  ──▶  backend/main.ts
                     one origin            /api  HTTP
                                           /ws   the socket, ws: true
```

An application that loads the uploads battery adds `/files` beside `/api`, the path its files
are served at (`recipes/uploads/page/vite.config.ts`).

## Run it by hand

Two terminals, and the backend goes first.

```
PORT=8080 node recipes/full-stack/backend/main.ts
AWEFT_BACKEND_PORT=8080 npx vite --config recipes/full-stack/page/vite.config.ts
```

`PORT` is what the backend listens on. `AWEFT_BACKEND_PORT` is what the page's proxy forwards to,
and it defaults to 8080, so with the ports above the second command needs nothing in front of it.
Open what vite prints, sign up with any email and password, and the page tells you who it is.

## What the gate does with it

```
AWEFT_DEFAULT_H=@aweftjs/ui AWEFT_TEXT=1 node --import @aweftjs/build/loader recipes/full-stack/main.ts
```

It starts the backend on port 0, starts the dev server against that port programmatically, and
drives the page in Chromium. Every check can only pass through the proxy: the board's title is on a
document the server holds and reaches the browser over the socket, the public ask is answered on the
same socket, and signing up sets a cookie on the dev server's origin that the socket after the
reconnect carries to the gated module. It exits nonzero when a check fails.

## The text a page shows

`page/vite.config.ts` turns the transform's `text` option on, so a build writes `page/text/source.json`
with every string the page shows, and the page is ready for a second language the day it needs one: a
catalog beside it and `context({ locale, catalog })` at the mount (`packages/ui/README.md`, The text
a page shows). A process that renders these pages on a server says the same thing with `AWEFT_TEXT=1`
beside `AWEFT_DEFAULT_H`, or the two sides compile one file differently and the page will not hydrate.

## The one decision in here

**The socket gets a path of its own, `/ws`, rather than the client's default of `/`.** A vite proxy
entry matches a URL by prefix, so an entry for `/` takes every upgrade, including the dev server's
own hot-reload socket, and the page then does not load at all. So `page/vite.config.ts` proxies
`/ws`, and `page/entry.tsx` asks for that path:

```ts
const socket = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
const client = createClient({ url: socket });
```

The server accepts an upgrade on any path, so nothing on the backend changes for this. Moving the
dev server's own socket instead does not help: the prefix match is on the proxy entry, so `/` still
takes whatever path hot reload is moved to.

## The application's own files

`package.json`. This application carries the stack as a git submodule, so each `@aweftjs/*` name
resolves to a directory inside it and a fix to the stack is live on the next run. An application
that only uses the stack installs the packages it imports from npm instead, and skips the
submodule, the `.npmrc` and the `customConditions` line below.

Every package is listed, not only the ones the application imports, because each linked package's
own `@aweftjs/*` dependencies resolve through the application's `node_modules` and nowhere else.

```
git submodule add <this repo's url> aweft
npm install
```

`.npmrc`. A published package carries compiled JavaScript and the submodule carries TypeScript,
and one `exports` map serves both: whoever wants the source asks for it by name (design 256).
This is that ask, for every script npm runs.

```
node-options=--conditions=aweft-source
```

```json
{
	"name": "your-app",
	"private": true,
	"type": "module",
	"scripts": {
		"backend": "PORT=8080 node backend/main.ts",
		"dev": "vite --config page/vite.config.ts",
		"build": "vite build --config page/vite.config.ts",
		"test": "node --import @aweftjs/build/loader --test tests/*.test.ts",
		"typecheck": "tsc -p tsconfig.json && tsc -p page/tsconfig.json"
	},
	"dependencies": {
		"@aweftjs/auth": "file:aweft/packages/auth",
		"@aweftjs/build": "file:aweft/packages/build",
		"@aweftjs/client": "file:aweft/packages/client",
		"@aweftjs/codec": "file:aweft/packages/codec",
		"@aweftjs/core": "file:aweft/packages/core",
		"@aweftjs/debug": "file:aweft/packages/debug",
		"@aweftjs/dom": "file:aweft/packages/dom",
		"@aweftjs/icons": "file:aweft/packages/icons",
		"@aweftjs/jobs": "file:aweft/packages/jobs",
		"@aweftjs/modules": "file:aweft/packages/modules",
		"@aweftjs/sandbox": "file:aweft/packages/sandbox",
		"@aweftjs/schema": "file:aweft/packages/schema",
		"@aweftjs/server": "file:aweft/packages/server",
		"@aweftjs/ssg": "file:aweft/packages/ssg",
		"@aweftjs/store": "file:aweft/packages/store",
		"@aweftjs/sync": "file:aweft/packages/sync",
		"@aweftjs/testing": "file:aweft/packages/testing",
		"@aweftjs/ui": "file:aweft/packages/ui"
	},
	"devDependencies": { "@types/node": "^24", "typescript": "^5.9", "vite": "^8" }
}
```

`tsconfig.base.json`, which both halves extend. `erasableSyntaxOnly` and `verbatimModuleSyntax` are
what let Node run the `.ts` files with no build step, and `jsx: "preserve"` leaves the JSX for
`aweft()`.

```json
{
	"compilerOptions": {
		"target": "es2023",
		"module": "nodenext",
		"moduleResolution": "nodenext",
		"strict": true,
		"noUncheckedIndexedAccess": true,
		"exactOptionalPropertyTypes": true,
		"erasableSyntaxOnly": true,
		"verbatimModuleSyntax": true,
		"isolatedModules": true,
		"jsx": "preserve",
		"allowImportingTsExtensions": true,
		"customConditions": ["aweft-source"],
		"noEmit": true,
		"skipLibCheck": true
	}
}
```

`customConditions` is the compiler's half of the `.npmrc` line: without it the compiler reads the
declarations a published package ships while Node runs the submodule's source, and the two
disagree the moment the submodule is ahead of the last release.

Two tsconfigs over it, because the two halves see different globals. The Node half has `process` and
no `document`, and the config file vite runs belongs to it. The page half is the other way around.
Any file that writes JSX needs `jsx.d.ts` in view, which is what tells the compiler what a JSX
element is.

```json
// tsconfig.json, the Node half
{
	"extends": "./tsconfig.base.json",
	"compilerOptions": { "lib": ["es2023"], "types": ["node"] },
	"include": ["backend", "page/vite.config.ts"]
}

// page/tsconfig.json, the browser half
{
	"extends": "../tsconfig.base.json",
	"compilerOptions": { "lib": ["es2023", "dom", "dom.iterable"], "types": [] },
	"include": ["entry.tsx", "../aweft/packages/ui/src/jsx.d.ts"]
}
```

`page/vite.config.ts` is the file in this directory, unchanged.

The two skills under the stack's `.claude/skills/`, `aweft-app` for building with it and
`aweft-stack` for changing it, load from the application's own skills directory and not from
inside the submodule, so link them:

```
mkdir -p .claude/skills
ln -s ../../aweft/.claude/skills/aweft-app .claude/skills/aweft-app
ln -s ../../aweft/.claude/skills/aweft-stack .claude/skills/aweft-stack
```

Tests for the application are `node --test` files run under the loader, which is what the `test`
script above does; `@aweftjs/testing` is for a driver or a listener of your own.

## What is in here

`backend/main.ts` is the whole boot: the store, the listener, the sources and the gate. Everything
the server does is a module in `backend/modules/`: `board/Board` holds one document and shares it
with every connection, `board/Notice` is a public call, and `board/Mine` declares no `public` and so
answers only a signed-in connection, with who asked.

`page/entry.tsx` is the whole page: a client on this origin, an auth over it, the shared document
rendered with `@aweftjs/ui`, and a form that calls `enter`. `enter` signs up when nobody has the
email, so there is one form rather than two.

## What it does not do for you

**Production serving.** The proxy is development only. In production the page is built
(`vite build`) and something serves the files on the same origin as the socket: the server itself,
through a module whose `routes` answer the built files, which is what `recipes/client/main.ts`
does under the name `site/Files`, or a static host with the backend behind the same name. Get
that wrong and the symptom is a page that renders and a sign-in that never sticks, because the
cookie went to an origin the socket never visits.

**A gate of your own.** `auth/Gate` reads `public: true` and nothing else. Any rule past "is this
somebody" is a module of yours that `deps` on it, which `packages/server/README.md` shows.

**Password reset, email verification, a session lifetime.** The first two wait for the email
battery. The third is one line of config on `auth/Session`, and none ships.

**Routing.** One page, no router and no stage. `recipes/routed-site` is URLs, and `recipes/client`
is a routed application whose every part is a module.

**Anything the store keeps past this process.** `memoryDriver` forgets everything when the backend
stops, accounts included.
