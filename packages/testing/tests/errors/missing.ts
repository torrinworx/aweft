// Fixture: a refusal with no remedy. The reader must refuse this rather than index it.

const codecError = (reason: string, detail: string, fix?: string): Error =>
	Object.assign(new Error(reason + ': ' + detail), { reason, fix });

export const noFix = (): never => {
	throw codecError('no-remedy', 'what was seen');
};
