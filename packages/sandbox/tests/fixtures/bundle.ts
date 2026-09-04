// A library bundle map, the shape a bundler's glob import produces.
export default {
	'./lib/Upper.ts': { default: () => ({ up: (s: string) => s.toUpperCase() }) },
};
