// The session cookie: reading it off a request, and writing the header that sets or clears it.

/**
 * Every non-empty value of the cookies by that name, in the order the client sent them.
 *
 * Several, because a browser sends every cookie of that name whose scope matches, and one
 * from another path or another application on the host is not this battery's to refuse. An
 * empty value is what the battery's own clearing header leaves, and counts as absent.
 */
export const cookiesOf = (request: Request, name: string): string[] => {
	const header = request.headers.get('cookie');
	if (header === null) return [];
	const values: string[] = [];
	for (const part of header.split(';')) {
		const at = part.indexOf('=');
		if (at < 0 || part.slice(0, at).trim() !== name) continue;
		const value = part.slice(at + 1).trim();
		if (value !== '') values.push(value);
	}
	return values;
};

/**
 * The `Set-Cookie` value that sets the session cookie, or clears it for `null`.
 *
 * HttpOnly so script never reads it, SameSite=Lax so a cross-site form cannot present it,
 * Secure when the request itself came over TLS, and a lifetime only when one is configured.
 */
export const setCookie = (name: string, token: string | null, request: Request, maxAgeMs?: number): string => {
	const parts = [`${name}=${token ?? ''}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
	if (new URL(request.url).protocol === 'https:') parts.push('Secure');
	if (token === null) parts.push('Max-Age=0');
	else if (maxAgeMs !== undefined) parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
	return parts.join('; ');
};
