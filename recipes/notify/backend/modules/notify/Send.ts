// The battery's configuration, the way any battery module is configured: a same-named file in
// the application's own source exporting `config`. Where the two services are comes from the
// environment, so a run against the real ones and a run against fakes differ by two variables.

export const config = {
	email: { resend: { key: process.env.RESEND_KEY ?? 'recipe', from: 'Shop <shop@example.test>', endpoint: process.env.RESEND_URL } },
	push: process.env.FCM_ACCOUNT === undefined ? null : {
		fcm: { account: process.env.FCM_ACCOUNT, endpoint: process.env.FCM_URL, tokenUrl: process.env.FCM_TOKEN_URL },
	},
};
