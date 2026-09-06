// One abort signal per call, torn down by one function.

/**
 * Turn a function that wants an abort signal into one that hands back its abort.
 *
 * Params:
 *   fn: called with a fresh `AbortSignal` and whatever else the caller passed
 *
 * Returns: a function that runs `fn` and answers the abort, so it can go straight into
 * `cleanup`. Every listener registered with `{ signal }` inside comes off in one call.
 *
 * Example:
 *   const listen = useAbort((signal, node) => {
 *     node.addEventListener('scroll', onScroll, { signal });
 *     node.addEventListener('resize', onResize, { signal });
 *   });
 *   cleanup(listen(element));
 */
export const useAbort = <A extends unknown[]>(
	fn: (signal: AbortSignal, ...args: A) => void,
): ((...args: A) => () => void) => (...args) => {
	const controller = new AbortController();
	fn(controller.signal, ...args);
	return () => { controller.abort(); };
};
