// The two adapters against a server on localhost: what each sends, what it makes of an answer,
// a timeout named as one, and the push token exchanged once.

import test from 'node:test';
import assert from 'node:assert/strict';

import { FCM_ENDPOINT, FCM_TOKEN_URL, fcm, forgetTokens, parseAccount } from '../src/fcm.ts';
import { RESEND_ENDPOINT, resend } from '../src/resend.ts';

import { fake, fakeFcm, serviceAccount } from './helpers.ts';

test('resend posts the mail with the bearer key and answers the id', async () => {
	const service = await fake();
	service.answer(200, { id: 'abc' });
	const send = resend({ key: 'secret', from: 'Site <site@example.com>', endpoint: service.url }, 1000);
	assert.deepEqual(await send({ to: 'ada@example.com', subject: 'hi', text: 'plain', html: '<p>rich</p>', replyTo: 'visitor@example.com' }), { ok: true, id: 'abc' });
	assert.equal(service.calls[0]!.headers.authorization, 'Bearer secret');
	assert.deepEqual(service.calls[0]!.body, { from: 'Site <site@example.com>', to: 'ada@example.com', subject: 'hi', text: 'plain', html: '<p>rich</p>', reply_to: 'visitor@example.com' });
	assert.deepEqual(await send({ to: 'ada@example.com', subject: 'hi', text: 'plain', html: '<p>rich</p>' }), { ok: true, id: 'abc' });
	assert.equal('reply_to' in (service.calls[1]!.body as object), false, 'no reply_to when none was given');
	service.answer(200, 'not json at all');
	assert.deepEqual(await send({ to: 'a@b.co', subject: 's', text: 't', html: 'h' }), { ok: true, id: null });
	await service.stop();
});

test('resend\'s own message is carried on a refusal, and a timeout is named as one', async () => {
	const service = await fake();
	const send = resend({ key: 'k', from: 'f@x.co', endpoint: service.url }, 100);
	service.answer(422, { name: 'validation_error', message: 'The from address is not verified' });
	assert.deepEqual(await send({ to: 'a@b.co', subject: 's', text: 't', html: 'h' }), { ok: false, error: 'resend answered 422: The from address is not verified' });
	service.answer(401, { name: 'unauthorized' });
	assert.deepEqual(await send({ to: 'a@b.co', subject: 's', text: 't', html: 'h' }), { ok: false, error: 'resend answered 401: unauthorized' });
	service.answer(500, 'plain text');
	assert.deepEqual(await send({ to: 'a@b.co', subject: 's', text: 't', html: 'h' }), { ok: false, error: 'resend answered 500' });
	service.answer(200, { id: 'late' }, 300);
	assert.deepEqual(await send({ to: 'a@b.co', subject: 's', text: 't', html: 'h' }), { ok: false, error: 'resend timed out after 100 ms' });
	await service.stop();
	const gone = resend({ key: 'k', from: 'f@x.co', endpoint: service.url }, 1000);
	const unreachable = await gone({ to: 'a@b.co', subject: 's', text: 't', html: 'h' });
	assert.equal((unreachable as { ok: boolean }).ok, false);
	assert.equal(RESEND_ENDPOINT, 'https://api.resend.com/emails');
});

test('fcm signs a JWT, exchanges it once, and posts a data-only message per endpoint at HIGH priority', async () => {
	forgetTokens();
	const service = await fakeFcm();
	const account = serviceAccount();
	const push = fcm({ account, endpoint: service.endpoint, tokenUrl: service.tokenUrl }, 1000);
	service.answer(200, { name: 'projects/test-project/messages/1' });
	const outcomes = await push({ n: '1', t: 'hi' }, ['tok-a', 'tok-b']);
	assert.deepEqual(outcomes, [{ ok: true, name: 'projects/test-project/messages/1' }, { ok: true, name: 'projects/test-project/messages/1' }]);
	assert.equal(service.exchanges(), 1);
	const exchange = service.calls[0]!;
	assert.equal(exchange.headers['content-type'], 'application/x-www-form-urlencoded');
	const form = new URLSearchParams(exchange.body as string);
	assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
	const [header, claims, signature] = form.get('assertion')!.split('.');
	assert.deepEqual(JSON.parse(Buffer.from(header!, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
	const parsed = JSON.parse(Buffer.from(claims!, 'base64url').toString()) as Record<string, unknown>;
	assert.equal(parsed.iss, 'push@test.iam.gserviceaccount.com');
	assert.equal(parsed.aud, service.tokenUrl);
	assert.equal(parsed.scope, 'https://www.googleapis.com/auth/firebase.messaging');
	assert.ok(typeof signature === 'string' && signature.length > 100);
	const sends = service.sends();
	assert.equal(sends.length, 2);
	assert.equal(sends[0]!.path, '/v1/projects/test-project/messages:send');
	assert.equal(sends[0]!.headers.authorization, 'Bearer token-1');
	assert.deepEqual(sends[0]!.body, { message: { token: 'tok-a', data: { n: '1', t: 'hi' }, android: { priority: 'HIGH' } } });
	assert.equal((sends[1]!.body as { message: { token: string } }).message.token, 'tok-b');
	// A second push reuses the token; a second account does not.
	await push({ n: '2' }, ['tok-a']);
	assert.equal(service.exchanges(), 1);
	await fcm({ account: serviceAccount().replace('push@test', 'other@test'), endpoint: service.endpoint, tokenUrl: service.tokenUrl }, 1000)({ n: '3' }, ['tok-a']);
	assert.equal(service.exchanges(), 2);
	await service.stop();
	assert.equal(FCM_ENDPOINT, 'https://fcm.googleapis.com/v1/projects/{project}/messages:send');
	assert.equal(FCM_TOKEN_URL, 'https://oauth2.googleapis.com/token');
});

test('fcm marks a dead endpoint stale, carries the service\'s message otherwise, and names a timeout', async () => {
	forgetTokens();
	const service = await fakeFcm();
	const push = fcm({ account: serviceAccount(), endpoint: service.endpoint, tokenUrl: service.tokenUrl }, 100);
	service.answer(404, { error: { status: 'NOT_FOUND', message: 'Requested entity was not found.', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } });
	assert.deepEqual(await push({}, ['dead']), [{ ok: false, error: 'fcm answered 404 UNREGISTERED: Requested entity was not found.', stale: true }]);
	// INVALID_ARGUMENT is what a message too large gets too, so it never forgets a device.
	service.answer(400, { error: { status: 'INVALID_ARGUMENT', message: 'The registration token is not a valid FCM registration token' } });
	assert.deepEqual(await push({}, ['bad']), [{ ok: false, error: 'fcm answered 400 INVALID_ARGUMENT: The registration token is not a valid FCM registration token', stale: false }]);
	service.answer(400, { error: { status: 'INVALID_ARGUMENT', message: 'Request contains an invalid argument.', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'SENDER_ID_MISMATCH' }] } });
	assert.deepEqual(await push({}, ['elsewhere']), [{ ok: false, error: 'fcm answered 400 SENDER_ID_MISMATCH: Request contains an invalid argument.', stale: true }]);
	service.answer(503, { error: { status: 'UNAVAILABLE', message: 'try later' } });
	assert.deepEqual(await push({}, ['fine']), [{ ok: false, error: 'fcm answered 503 UNAVAILABLE: try later', stale: false }]);
	service.answer(500, 'nothing useful');
	assert.deepEqual(await push({}, ['fine']), [{ ok: false, error: 'fcm answered 500: no detail', stale: false }]);
	service.answer(200, {}, 300);
	assert.deepEqual(await push({}, ['slow']), [{ ok: false, error: 'fcm timed out after 100 ms' }]);
	await service.stop();
});

test('a token exchange that fails is one error per endpoint, and so is an account that cannot sign', async () => {
	forgetTokens();
	const service = await fake((call, reply) => {
		if (call.path === '/token') { reply(400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }); return true; }
		return false;
	});
	const push = fcm({ account: serviceAccount(), endpoint: `${service.url}/send`, tokenUrl: `${service.url}/token` }, 1000);
	assert.deepEqual(await push({}, ['a', 'b']), [
		{ ok: false, error: 'the token exchange answered 400: Invalid JWT Signature.' },
		{ ok: false, error: 'the token exchange answered 400: Invalid JWT Signature.' },
	]);
	assert.equal(service.calls.length, 2, 'nothing was sent, and the exchange was tried per endpoint');
	await service.stop();

	const broken = fcm({ account: 'not json' }, 1000);
	assert.deepEqual(await broken({}, ['a']), [{ ok: false, error: 'the push account is not valid JSON; give the whole service account key file on one line, as JSON or base64' }]);
	assert.throws(() => parseAccount(JSON.stringify({ client_email: 'x', project_id: 'p' })), /missing private_key/);
	assert.throws(() => parseAccount(JSON.stringify({ client_email: 'x', project_id: 'p', private_key: 'nnnnot a pem' })), /does not load/);
	const parsed = parseAccount(Buffer.from(serviceAccount()).toString('base64'));
	assert.equal(parsed.project_id, 'test-project');
});
