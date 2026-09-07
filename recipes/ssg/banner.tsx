// The file with no imports at all.
//
// It writes JSX and binds no `h`, so whichever package compiled it decides what `theme` means:
// `ui`'s `h` turns it into a generated class, and `dom`'s writes it out as an attribute nothing
// reads. The bundler is told in `vite.config.ts` and the server in the command that runs
// `main.ts`, and this page hydrates only if the two said the same thing.

export const Banner = (): unknown => (
	<p id="banner" theme="nav">Generated at build time, live in the browser.</p>
);
