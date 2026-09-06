// Fixture: a reason assembled at runtime. A token nobody can branch on is not a token.

const codecError = (reason: string, detail: string, fix: string): Error =>
	Object.assign(new Error(reason), { reason, detail, fix });

export const builtReason = (part: string): never => {
	throw codecError(`built-${part}`, 'what was seen', 'Name the reason outright.');
};
