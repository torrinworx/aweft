// The one HTTP helper the two routes share.

export const json = (status: number, body: unknown): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
