// What every other module here writes a line to on its way out, so the recipe can count the
// stops that ran. A real application would have a logger; the shape is the same.
//
// It is a dependency of the modules that write to it, so the loader builds it first and
// unloads it last, which is exactly why their `stop` can still reach it.

export default () => {
	const lines: string[] = [];
	return {
		public: true,
		note: (line: string): void => { lines.push(line); },
		call: (): readonly string[] => [...lines],
	};
};
