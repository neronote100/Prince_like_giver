import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionValue, verifySession } from '../scripts/auth-smoke.mjs';

test('session cookie accepts raw token and full cookie string', () => {
  assert.equal(sessionValue('abc123'), 'abc123');
  assert.equal(sessionValue('Cookie: x=1; _note_session_v5=secret-value; y=2'), 'secret-value');
  assert.throws(() => sessionValue(''), /not configured/);
  assert.throws(() => sessionValue('abc;def'), /Invalid/);
});

test('verified owner account and cookie is never logged', async () => {
  let cookie;
  let closed = false;
  const launch = async () => ({
    newContext: async () => ({
      addCookies: async (cookies) => { cookie = cookies[0]; },
      request: {
        get: async () => ({
          ok: () => true,
          json: async () => ({ data: { user: { urlname: 'nero_notelover' } } }),
        }),
      },
    }),
    close: async () => { closed = true; },
  });
  const result = await verifySession({ rawCookie: '_note_session_v5=hidden', launch });
  assert.equal(result.account, 'nero_notelover');
  assert.equal(cookie.value, 'hidden');
  assert.equal(cookie.httpOnly, true);
  assert.ok(closed);
});

test('reject other user and close browser', async () => {
  let closed = false;
  const launch = async () => ({
    newContext: async () => ({
      addCookies: async () => {},
      request: { get: async () => ({ ok: () => true, json: async () => ({ data: { urlname: 'not_nero' } }) }) },
    }),
    close: async () => { closed = true; },
  });
  await assert.rejects(() => verifySession({ rawCookie: 'secret123', launch }), /mismatch/);
  assert.ok(closed);
});
