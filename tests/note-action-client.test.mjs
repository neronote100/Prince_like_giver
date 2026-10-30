import test from 'node:test';
import assert from 'node:assert/strict';
import { NoteActionClient, NoteActionError } from '../src/note-action-client.mjs';

const PRIVATE = 'PRIVATE_NOTE_RESPONSE_OR_COOKIE';
const KEY = 'n123456789abc';
const ARTICLE = 'https://note.com/writer/n/' + KEY;
const OWNER = { data: { urlname: 'nero_notelover', key: 'a'.repeat(32) } };
const failure = code => error => error instanceof NoteActionError && error.code === code &&
  !error.message.includes(PRIVATE) && !error.message.includes('https:');

function fixture({ payload = OWNER, status = 200, bytes, cookies = [], networkError } = {}) {
  const calls = [];
  let disposed = 0, cookieReads = 0;
  const context = {
    cookies: async origin => { assert.equal(origin, 'https://note.com'); cookieReads++; return cookies; },
    request: {
      async fetch(url, options) {
        calls.push({ url, options });
        if (networkError) throw networkError;
        return {
          status: () => status,
          body: async () => bytes ?? Buffer.from(JSON.stringify(payload)),
          dispose: async () => { disposed++; },
        };
      },
    },
  };
  return { client: new NoteActionClient(context), calls,
    get disposed() { return disposed; }, get cookieReads() { return cookieReads; } };
}

test('owner verification requires the expected account and an authenticated account key', async () => {
  for (const payload of [OWNER, { data: { user: OWNER.data } }, { user: OWNER.data }, OWNER.data]) {
    const f = fixture({ payload });
    assert.deepEqual(await f.client.owner(), { account: 'nero_notelover' });
    assert.equal(f.calls[0].url, 'https://note.com/api/v1/current_user');
    assert.equal(f.disposed, 1);
  }
  for (const payload of [
    { data: { ...OWNER.data, urlname: 'different_account' } },
    { data: { ...OWNER.data, is_me: false } },
    { data: { urlname: 'nero_notelover' } },
    { data: { ...OWNER.data, key: PRIVATE } },
  ]) {
    const f = fixture({ payload });
    await assert.rejects(f.client.owner(), failure('NOTE_OWNER_MISMATCH'));
    assert.equal(f.calls.length, 1);
  }
});

test('like state must be an explicit boolean in the verified API response field', async () => {
  for (const liked of [true, false]) {
    const f = fixture({ payload: { data: { extra_fields: { is_liked_by_current_user: liked } } } });
    assert.equal(await f.client.likedState(KEY), liked);
    assert.equal(f.calls[0].url, 'https://note.com/api/v3/notes/' + KEY + '/likes');
  }
  for (const liked of [undefined, null, 0, 1, 'true', 'false', {}]) {
    const f = fixture({ payload: { data: { extra_fields: { is_liked_by_current_user: liked } } } });
    await assert.rejects(f.client.likedState(KEY), failure('NOTE_LIKE_STATE_UNKNOWN'));
  }
});

test('one like call sends exactly one nonredirecting nonretrying POST with the article referrer and decoded CSRF', async () => {
  const f = fixture({ status: 201, payload: { private: PRIVATE }, cookies: [
    { name: '_note_session_v5', value: PRIVATE, domain: '.note.com' },
    { name: 'XSRF-TOKEN', value: 'test%2Bcsrf%3D', domain: 'note.com' },
    { name: 'XSRF-TOKEN', value: PRIVATE, domain: 'untrusted.example' },
  ] });
  assert.deepEqual(await f.client.like(KEY, ARTICLE), { status: 201 });
  assert.equal(f.calls.length, 1);
  const { url, options } = f.calls[0];
  assert.equal(url, 'https://note.com/api/v3/notes/' + KEY + '/likes');
  assert.equal(options.method, 'POST');
  assert.equal(options.data, '{}');
  assert.equal(options.maxRetries, 0);
  assert.equal(options.maxRedirects, 0);
  assert.equal(options.timeout, 15_000);
  assert.equal(options.failOnStatusCode, false);
  assert.equal(options.headers.Origin, 'https://note.com');
  assert.equal(options.headers.Referer, ARTICLE);
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.equal(options.headers['X-Requested-With'], 'XMLHttpRequest');
  assert.equal(options.headers['X-XSRF-TOKEN'], 'test+csrf=');
  assert.equal(options.headers.Cookie, undefined, 'the authenticated Playwright context owns its cookie jar');
  assert.equal(options.headers.Authorization, undefined);
  assert.ok(!JSON.stringify(options).includes(PRIVATE));
  assert.equal(f.disposed, 1);
});

test('known POST rejection stays a status-only result without leaking response bodies or retrying', async () => {
  for (const status of [401, 403, 429, 500, 302]) {
    const f = fixture({ status, bytes: Buffer.from(PRIVATE) });
    assert.deepEqual(await f.client.like(KEY, ARTICLE), { status });
    assert.equal(f.calls.length, 1);
    assert.equal(f.disposed, 1);
  }
});

test('read refusals and redirects retain only HTTP status and never expose provider details', async () => {
  for (const status of [401, 403, 429, 302]) {
    const f = fixture({ status, bytes: Buffer.from(PRIVATE) });
    await assert.rejects(f.client.owner(), error => failure('NOTE_HTTP_REJECTED')(error) && error.status === status);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].options.maxRedirects, 0);
    assert.equal(f.calls[0].options.maxRetries, 0);
    assert.equal(f.disposed, 1);
  }
});

test('raw network failures and invalid or oversized JSON bodies are sanitized and not retried', async () => {
  const network = fixture({ networkError: new Error(PRIVATE + ' token=PRIVATE') });
  await assert.rejects(network.client.like(KEY, ARTICLE), failure('NOTE_NETWORK_ERROR'));
  assert.equal(network.calls.length, 1);
  for (const bytes of [Buffer.from(PRIVATE), Buffer.alloc(1024 * 1024 + 1, 120)]) {
    const f = fixture({ bytes });
    await assert.rejects(f.client.owner(), failure('NOTE_RESPONSE_INVALID'));
    assert.equal(f.calls.length, 1);
    assert.equal(f.disposed, 1);
  }
});

test('invalid article URLs and mismatched keys are rejected before cookies or network are accessed', async () => {
  for (const article of [
    'https://untrusted.example/writer/n/' + KEY,
    'http://note.com/writer/n/' + KEY,
    ARTICLE + '?private=' + PRIVATE,
    ARTICLE + '#' + PRIVATE,
    'https://user:PRIVATE@note.com/writer/n/' + KEY,
    'https://note.com/writer/n/nabcdef123456',
    'https://note.com/writer/../n/' + KEY,
    'javascript:' + PRIVATE,
  ]) {
    const f = fixture();
    await assert.rejects(f.client.like(KEY, article), failure('NOTE_INPUT_INVALID'));
    assert.equal(f.calls.length, 0);
    assert.equal(f.cookieReads, 0);
  }
});

test('ambiguous or malformed CSRF cookies stop before POST without exposing their values', async () => {
  for (const cookies of [
    [{ name: 'XSRF-TOKEN', value: '%0d%0a' + PRIVATE, domain: '.note.com' }],
    [{ name: 'XSRF-TOKEN', value: '%PRIVATE', domain: '.note.com' }],
    [{ name: 'XSRF-TOKEN', value: '', domain: '.note.com' }],
    [
      { name: 'XSRF-TOKEN', value: 'one', domain: '.note.com' },
      { name: 'XSRF-TOKEN', value: 'two', domain: 'note.com' },
    ],
  ]) {
    const f = fixture({ cookies });
    await assert.rejects(f.client.like(KEY, ARTICLE), failure('NOTE_SESSION_INVALID'));
    assert.equal(f.calls.length, 0);
  }
});

test('the client accepts only GET and the narrowly scoped like POST, never arbitrary mutation methods', async () => {
  const f = fixture();
  await assert.rejects(f.client.request('/api/v3/notes/' + KEY + '/likes', { method: 'DELETE' }), failure('NOTE_INPUT_INVALID'));
  await assert.rejects(f.client.request('/api/v3/notes/' + KEY + '/likes', { method: 'PATCH' }), failure('NOTE_INPUT_INVALID'));
  await assert.rejects(f.client.profile('writer?private=' + PRIVATE), failure('NOTE_INPUT_INVALID'));
  assert.equal(f.calls.length, 0);
});
