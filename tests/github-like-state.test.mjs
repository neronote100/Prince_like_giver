import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { GitHubLikeState, validateLikeLedger } from '../src/github-like-state.mjs';

const TOKEN = 'ghs_PRIVATE_TEST_TOKEN';
const SECRET = 'PRIVATE_PROVIDER_DETAIL';
const API = 'https://api.github.com/repos/neronote100/Prince_like_giver';
const REF = '/git/ref/heads/automation/note-like-state';
const PATCH = '/git/refs/heads/automation/note-like-state';
const hash = value => createHash('sha1').update(value).digest('hex');
const blobHash = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const empty = () => ({ version: 1, owner: 'nero_notelover', attempts: [] });
const marker = () => ({ ...empty(), attempts: [{ key: 'n123456789abc', runId: '123', day: '2026-10-30', attemptedAt: '2026-10-29T21:00:00.000Z', status: 'attempting' }] });
const code = expected => error => error.code === expected && !/PRIVATE|ghs_|https:/.test(error.message);

function fixture() {
  const calls = [], blobs = new Map(), trees = new Map(), commits = new Map();
  const main = hash('main');
  let current = null, serial = 0;
  const state = { lostAck: false, raceAtPatch: false, raceAtCreate: false, corruptBlob: null, badConfirm: false };
  const ref = branch => ({ ref: 'refs/heads/' + branch, object: { type: 'commit', sha: branch === 'main' ? main : current } });
  const fetcher = async (url, options) => {
    assert.ok(url.startsWith(API + '/git/'), 'every request must use the fixed repository API');
    assert.equal(new URL(url).origin, 'https://api.github.com');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer ' + TOKEN);
    assert.equal(options.headers['X-GitHub-Api-Version'], '2022-11-28');
    assert.ok(options.signal instanceof AbortSignal);
    const path = url.slice(API.length), method = options.method;
    const body = options.body === undefined ? undefined : JSON.parse(options.body);
    calls.push({ path, method, body });
    assert.ok(!String(options.body).includes(TOKEN), 'credentials cannot enter a Git object');
    const json = value => Response.json(value);
    if (method === 'GET' && path === REF) return current === null ? new Response(SECRET, { status: 404 }) : json(ref('automation/note-like-state'));
    if (method === 'GET' && path === '/git/ref/heads/main') return json(ref('main'));
    if (method === 'POST' && path === '/git/blobs') {
      const bytes = Buffer.from(body.content, 'base64'), sha = blobHash(bytes);
      blobs.set(sha, bytes); return json({ sha });
    }
    if (method === 'POST' && path === '/git/trees') {
      assert.deepEqual(Object.keys(body), ['tree'], 'state trees must not include source code or inherit a main tree');
      const sha = hash('tree-' + ++serial); trees.set(sha, body.tree); return json({ sha });
    }
    if (method === 'POST' && path === '/git/commits') {
      const sha = hash('commit-' + ++serial);
      commits.set(sha, { sha, tree: { sha: body.tree }, parents: body.parents.map(sha => ({ sha })) });
      return json({ sha });
    }
    if (method === 'POST' && path === '/git/refs') {
      if (state.raceAtCreate) current = hash('concurrent-creator');
      if (current !== null) return new Response(SECRET, { status: 422 });
      assert.equal(body.ref, 'refs/heads/automation/note-like-state');
      current = body.sha;
      if (state.lostAck) throw new Error(SECRET + TOKEN);
      if (state.badConfirm) current = hash('unconfirmed-writer');
      return json(ref('automation/note-like-state'));
    }
    if (method === 'PATCH' && path === PATCH) {
      assert.equal(body.force, false);
      if (state.raceAtPatch) current = hash('concurrent-writer');
      if (commits.get(body.sha)?.parents[0]?.sha !== current) return new Response(SECRET, { status: 422 });
      current = body.sha;
      if (state.lostAck) throw new Error(SECRET + TOKEN);
      if (state.badConfirm) current = hash('unconfirmed-writer');
      return json(ref('automation/note-like-state'));
    }
    if (method === 'GET' && path.startsWith('/git/commits/')) return json(commits.get(path.slice('/git/commits/'.length)));
    if (method === 'GET' && path.startsWith('/git/trees/')) {
      const sha = path.slice('/git/trees/'.length);
      return json({ sha, truncated: false, tree: trees.get(sha) });
    }
    if (method === 'GET' && path.startsWith('/git/blobs/')) {
      const sha = path.slice('/git/blobs/'.length), bytes = blobs.get(sha);
      return json(state.corruptBlob?.({ sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') }) ??
        { sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') });
    }
    assert.fail('Unexpected fixed test endpoint');
  };
  return { store: new GitHubLikeState({ token: TOKEN, fetcher }), calls, state, blobs, trees, commits, main,
    get head() { return current; }, set head(value) { current = value; } };
}

test('missing state is read-only and requires no source tree or credentials in output', async () => {
  const f = fixture();
  assert.deepEqual(await f.store.read(), { revision: null, value: null });
  assert.deepEqual(f.calls.map(x => [x.method, x.path]), [['GET', REF]]);
});

test('an attempt is durably published in its own branch before final status is updated', async () => {
  const f = fixture(), value = marker();
  const first = await f.store.write(value, null);
  assert.equal(first, f.head);
  assert.equal(f.commits.get(first).parents[0].sha, f.main);
  assert.deepEqual(await f.store.read(), { revision: first, value });
  assert.deepEqual([...f.trees.values()][0].map(x => x.path), ['note-likes.json']);
  const final = structuredClone(value);
  final.attempts[0].status = 'liked'; final.attempts[0].httpStatus = 201;
  const second = await f.store.write(final, first);
  assert.notEqual(first, second);
  assert.equal(f.commits.get(second).parents[0].sha, first);
  assert.deepEqual(await f.store.read(), { revision: second, value: final });
  assert.ok(f.calls.some(x => x.method === 'PATCH' && x.body.force === false));
  assert.ok(!JSON.stringify(await f.store.read()).includes(TOKEN));
});

test('stale revisions and concurrent branch creation stop without forcing history', async () => {
  const f = fixture(), first = await f.store.write(marker(), null);
  const count = f.calls.length;
  await assert.rejects(f.store.write(marker(), hash('stale')), code('LIKE_STATE_CONFLICT'));
  assert.deepEqual(f.calls.slice(count).map(x => x.method), ['GET']);
  assert.equal(f.head, first);
  const race = fixture(); race.state.raceAtCreate = true;
  await assert.rejects(race.store.write(marker(), null), code('LIKE_STATE_UNAVAILABLE'));
  assert.equal(race.calls.filter(x => x.path === '/git/refs').length, 1);
  assert.equal(race.calls.some(x => x.method === 'PATCH'), false);
});

test('a concurrent writer after preflight is rejected by non-fast-forward update', async () => {
  const f = fixture(), first = await f.store.write(marker(), null);
  f.state.raceAtPatch = true;
  await assert.rejects(f.store.write(marker(), first), code('LIKE_STATE_UNAVAILABLE'));
  assert.notEqual(f.head, first);
  const patches = f.calls.filter(x => x.method === 'PATCH');
  assert.equal(patches.length, 1);
  assert.equal(patches[0].body.force, false);
});

test('a lost acknowledgement never returns success or retries even when the marker persisted', async () => {
  const f = fixture(); f.state.lostAck = true;
  await assert.rejects(f.store.write(marker(), null), code('LIKE_STATE_UNAVAILABLE'));
  assert.equal(f.calls.filter(x => x.method === 'POST' && x.path === '/git/refs').length, 1);
  assert.ok(f.head);
  f.state.lostAck = false;
  assert.deepEqual((await f.store.read()).value, marker(), 'the uncertain attempt must remain visible to later runs');
  const revision = f.head;
  f.state.lostAck = true;
  await assert.rejects(f.store.write(marker(), revision), code('LIKE_STATE_UNAVAILABLE'));
  assert.equal(f.calls.filter(x => x.method === 'PATCH').length, 1);
});

test('the final ref must confirm the exact published commit before success is returned', async () => {
  const f = fixture(); f.state.badConfirm = true;
  await assert.rejects(f.store.write(marker(), null), code('LIKE_STATE_UNCONFIRMED'));
});

test('invalid public ledger schemas cannot send anything to GitHub', async () => {
  const f = fixture();
  for (const value of [
    { ...marker(), token: TOKEN },
    { ...marker(), owner: 'different-account' },
    { ...marker(), attempts: [{ ...marker().attempts[0], password: TOKEN }] },
    { ...marker(), attempts: [{ ...marker().attempts[0], day: '2026-10-29' }] },
    { ...marker(), attempts: [{ ...marker().attempts[0], runId: TOKEN }] },
    { ...marker(), attempts: [{ ...marker().attempts[0], attemptedAt: '2026-02-30T00:00:00.000Z' }] },
    { ...marker(), attempts: [{ ...marker().attempts[0], httpStatus: 999 }] },
    { ...marker(), attempts: [marker().attempts[0], marker().attempts[0]] },
    { ...marker(), attempts: Array(5001).fill(marker().attempts[0]) },
  ]) await assert.rejects(f.store.write(value, null), code('LIKE_STATE_INVALID'));
  assert.equal(f.calls.length, 0);
  assert.deepEqual(validateLikeLedger({ ...empty(), pausedUntil: null }), { ...empty(), pausedUntil: null });
});

test('corrupted, oversized or non-JSON blobs are rejected with no secret-bearing diagnostics', async () => {
  const f = fixture(); await f.store.write(marker(), null);
  for (const corrupt of [
    blob => ({ ...blob, content: Buffer.from(SECRET).toString('base64') }),
    blob => ({ ...blob, size: 2 * 1024 * 1024 + 1 }),
    blob => ({ ...blob, encoding: 'utf-8' }),
    blob => ({ ...blob, content: '!!!PRIVATE!!!' }),
    blob => ({ ...blob, sha: hash('unexpected') }),
  ]) {
    f.state.corruptBlob = corrupt;
    await assert.rejects(f.store.read(), code('LIKE_STATE_INVALID'));
  }
});

test('network errors, redirects and oversized API responses remain bounded and redacted', async () => {
  for (const fetcher of [
    async () => { throw new Error(SECRET + TOKEN); },
    async () => new Response(SECRET + TOKEN, { status: 302, headers: { Location: 'https://untrusted.example/' + TOKEN } }),
    async () => new Response('x'.repeat(3 * 1024 * 1024 + 1)),
    async () => new Response(SECRET + TOKEN, { status: 403 }),
  ]) {
    const state = new GitHubLikeState({ token: TOKEN, fetcher });
    await assert.rejects(state.read(), error => ['LIKE_STATE_INVALID', 'LIKE_STATE_UNAVAILABLE'].includes(error.code) &&
      !error.message.includes(TOKEN) && !error.message.includes(SECRET));
  }
  assert.throws(() => new GitHubLikeState({ token: '' }), code('LIKE_STATE_CONFIGURATION'));
});
