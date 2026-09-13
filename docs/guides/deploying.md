# Deploying

One Node process is the whole deployment: it serves the pages the build wrote and answers the
health check a deploy polls. This is how this site is deployed, and it is one shape among
several; the stack decides none of it.

## The server

```ts
import { health } from '@aweftjs/health';
import { fromBundle } from '@aweftjs/modules';
import { createServer, open } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { files } from '@aweftjs/static';

const own = fromBundle({
	'./health/Check.ts': { config: { info: { build } } },
	'./static/Files.ts': { config: { dir, unknown: '404', headers: { '': 'no-cache', 'assets/': 'public, max-age=31536000, immutable' } } },
});

const server = createServer({ sources: [own, health, files], store: undefined, gate: open, listener: node({ port }) });
await server.start();
```

`@aweftjs/static` answers every request no route matched with a file from `dir`: the path, then
`index.html` under it, then the `404.html` the site wrote. `@aweftjs/health` answers
`GET /api/health` with `ok` and whatever `info` the application put beside it. A site with no
users takes the `open` gate; one with users lists `auth` and names its gate. The configuration
of a module the application did not write is a file exporting `config`, or an entry in a bundle
listed ahead of the batteries, so the application's word wins the merge.
`packages/static/README.md` and `packages/health/README.md` say what each answers and never
decides.

## The build

Three steps, in order: the page bundle and the shell (`vite build`), then every page written
out as a file beside it (`@aweftjs/ssg`), then the directory that ships. What ships is a trimmed
copy of the repository laid out as it is in development, so every relative path in the server
means the same thing on the droplet. A build is stamped with the commit it came from and when,
in a file beside the server, and the health answer carries the stamp.

```sh
NODE_ENV=production npx vite build
node --import @aweftjs/build/loader pages.ts
printf '{ "build": "%s" }\n' "$BUILD_ID" > build/build.json
```

An application that carries the stack as a submodule ships the packages' source and manifests,
and asks for the source by name with `--conditions=aweft-source` wherever a bare `node` runs;
`packages/build/README.md` has the loader, and `recipes/static/` is a site built, written and
served by one program.

## The deploy, verified

Ship the build, restart the service, and poll the health route until the build answering is
the one you sent. A 200 is not enough: the old process answers 200 too, and so does a shell
served for an unknown URL. Read the body and compare the stamp.

```sh
for attempt in $(seq 1 90); do
	live="$(curl -s -m 5 https://example.com/api/health | node -e '
		let raw = ""; for await (const chunk of process.stdin) raw += chunk;
		const body = JSON.parse(raw); console.log(body.ok === true ? body.info.build : "")')"
	[[ "$live" == "$BUILD_ID" ]] && exit 0
	sleep 2
done
exit 1
```

`recipes/health/` is that poll, with the two states it must not mistake for health. Nothing here
rolls back: a failed verification is a build still in place and a message saying so.

## What this does not decide

A reverse proxy and a certificate in front of the process, a process manager that restarts it,
where the logs go, a database for a site that has one. Those are the host's, and
`docs/security.md` says which of them the operator owns.
