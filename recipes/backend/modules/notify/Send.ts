// The mailer, for the notify battery this application loads beside the auth mail flows. A real
// application configures Resend here; this one keeps every mail in memory so the checks can
// read the links out of them.

export interface Mail { readonly to: string; readonly subject: string; readonly text: string; readonly html: string }

export const mails: Mail[] = [];

export const config = {
	email: async (mail: Mail): Promise<{ ok: true }> => { mails.push(mail); return { ok: true }; },
};
