// The room bundle: the entry the frame imports, plus one entry per bare name the acts import,
// built as one library so every entry shares one copy of `ui` and `core`. The frame's import map
// names the two, and the room entry reaches the same chunks by relative import, so an act and the
// stage it mounts under hold one `StageContext` and one theme registry.
//
// Build it by hand: npx vite build --config recipes/room/page/room.config.ts

import { defineConfig } from 'vite';

import { aweft } from '@aweftjs/build';

export default defineConfig({
	root: import.meta.dirname,
	// The output goes under the page's public directory, which this build does not read.
	publicDir: false,
	plugins: [aweft({ defaultH: '@aweftjs/ui' })],
	build: {
		outDir: 'public/room',
		emptyOutDir: true,
		lib: {
			entry: { room: 'room.tsx', ui: 'names/ui.ts', core: 'names/core.ts' },
			formats: ['es'],
			fileName: (_format, name) => `${name}.js`,
		},
		rollupOptions: { output: { chunkFileNames: 'chunk-[hash].js' } },
	},
});
