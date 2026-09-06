// What the compiler resolves a JSX element against.
//
// `build` compiles JSX to a plain `h` call resolved by ordinary scope (design 092), so the
// types cannot know which `h` a file means and do not try to. An element is whatever `h`
// returns, which is `unknown`, and a component is any function.

declare global {
	namespace JSX {
		type Element = unknown;
		// `undefined` is in the list because `mark.name` is an index signature and
		// `noUncheckedIndexedAccess` widens every read of one. `h` refuses a null tag at runtime,
		// with a message naming what to pass.
		type ElementType = string | ((...args: never[]) => unknown) | undefined;
		// JSX children become the rest arguments of `h`, not a prop, so no prop receives them.
		// Naming `children` here instead would have the compiler refuse a component given one
		// child, on the grounds that a prop typed as an array wants several.
		interface ElementChildrenAttribute { readonly childrenGoToTheRestArguments: object }
		interface IntrinsicElements { [tag: string]: Record<string, unknown> }
		interface IntrinsicAttributes { [prop: string]: unknown }
	}
}

export {};
