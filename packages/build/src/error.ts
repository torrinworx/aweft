// A fault in the source, reported where it is.
//
// The markup pass makes every refusal the runtime parser makes, but at build time, so the fault
// has a position in a file rather than a stack in a browser (design 096).

export class TransformError extends Error {
	/** The offset in the source the fault is at. */
	readonly at: number;

	constructor(message: string, at: number) {
		super(message);
		this.name = 'TransformError';
		this.at = at;
	}
}
