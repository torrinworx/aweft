// Where the reset mail points.

export const config = { url: (token: string): string => `http://127.0.0.1/reset?token=${token}` };
