// Fixture for the refusal index reader. Every shape the reader has to understand, in one file.
//
// `codecError` is declared locally so the fixture stands alone and still typechecks, including
// the sites that are deliberately wrong. The reader matches on the name, which is the point.

const codecError = (reason: string, detail: string, fix: string): Error =>
	Object.assign(new Error(reason + ': ' + detail + '. ' + fix), { reason, fix });

const REMOTE_FIX = 'Handle it where the call was made.';

// 1. A plain throw site: both parts written where they stand.
export const plain = (): never => {
	throw codecError('plain-refusal', 'what was seen', 'Do the plain thing instead.');
};

// 2. A helper that takes the remedy from its caller. The reason is its own.
const forwarding = (name: string, fix: string): never => {
	throw codecError('forwarded', name + ' cannot be done', fix);
};

export const one = (): never => forwarding('one', 'Do one thing instead.');
export const two = (): never => forwarding('two', 'Do two things instead.');

// 3. A package factory forwarding both parts. Note the inner `const error`, which must not
// take the name of the function it sits in.
const packageError = (reason: string, detail: string, fix: string): Error => {
	const error = codecError(reason, detail, fix);
	return Object.assign(error, { extra: true });
};

export const viaFactory = (): never => {
	throw packageError('through-a-factory', 'what was seen', 'Use the factory properly.');
};

// 4. A re-raiser: handed its reason, holding one remedy of its own.
const crossed = (reason: string, message: string): Error =>
	Object.assign(packageError(reason, message, REMOTE_FIX), { message });

export const reraise = (reason: string, message: string): never => {
	throw crossed(reason, message);
};

// 5. A function that merely throws a refusal is NOT a factory, and its own callers are not
// refusal sites.
export const merelyThrows = (bad: boolean): void => {
	if (bad) throw codecError('merely', 'this function only throws', 'Pass a good value.');
};

export const callsMerelyThrows = (): void => merelyThrows(true);
