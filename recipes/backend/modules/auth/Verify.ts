// Where the verification mail points. A battery never picks a URL; this application does.

export const config = { url: (token: string): string => `http://127.0.0.1/verify?token=${token}` };
