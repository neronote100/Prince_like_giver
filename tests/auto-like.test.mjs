import test from 'node:test';
import assert from 'node:assert/strict';
import { runAutoLike } from '../src/auto-like.mjs';

const NOW = Date.parse('2026-10-30T01:00:00.000Z');
const OWNER = 'nero_notelover';
const PRIVATE = 'NEVER_ECHO_COOKIE_OR_PROVIDER_DETAILS';
const key = index => 'n' + (index + 1).toString(16).padStart(12, '0');
const candidate = (index = 0) => ({
  user: 'writer' + index, name: 'Writer', profileUrl: 'https://note.com/writer' + index,
  following: 115, followers: 100, gap: 15, articleTitle: 'Recent article',
  publishedAt: new Date(NOW - 60_000).toISOString(),
  articleUrl: 'https://note.com/writer' + index + '/n/' + key(index), liked: false, status: 'review_only',
});
const report = (candidates = [candidate()], extra = {}) => ({ owner: OWNER, generatedAt: new Date(NOW).toISOString(), rateLimited: false, candidates, ...extra });
const profile = user => ({ data: { urlname: user, followingCount: 115, followerCount: 100, isFollowing: false, isFollowed: false } });
const articles = user => ({ data: { contents: [{ key: key(Number(user.replace('writer', ''))), name: 'Recent article', publishAt: new Date(NOW - 60_000).toISOString(), isLiked: false }] } });
const day = time => new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const entry = (index, { at = NOW - 60_000, status = 'liked', runId = String(1000 + index) } = {}) => ({ key: key(index), runId, day: day(at), attemptedAt: new Date(at).toISOString(), status });
const ledger = (attempts = [], extra = {}) => ({ version: 1, owner: OWNER, attempts, ...extra });

function fixture(options = {}) {
  let clock = options.time ?? NOW, state = structuredClone(options.ledger ?? null), rev = state === null ? null : 'r0', writes = 0;
  const events = [], sent = [];
  const store = {
    async read() {
      events.push('read-state');
      if (options.readError) throw Error(PRIVATE);
      return { value: structuredClone(state), revision: rev };
    },
    async write(value, expected) {
      writes++;
      events.push('write-' + writes);
      assert.equal(expected, rev);
      if (options.write) {
        const effect = await options.write({ writeNumber: writes, value, expected, persist });
        if (effect === 'throw') throw Error(PRIVATE);
        if (effect === 'unconfirmed') return undefined;
      }
      return persist(value);
    },
  };
  function persist(value) { state = structuredClone(value); rev = 'r' + writes; return rev; }
  let ownerReads = 0, likeReads = 0;
  const note = {
    async owner() { events.push('owner'); ownerReads++; return options.owner ? options.owner(ownerReads) : { account: OWNER }; },
    async profile(user) { events.push('profile'); return options.profile ? options.profile(user) : profile(user); },
    async articles(user) { events.push('articles'); return options.articles ? options.articles(user) : articles(user); },
    async likedState(article) { events.push('liked-state'); likeReads++; return options.likedState ? options.likedState(article, likeReads) : likeReads > 1; },
    async like(article, url) {
      events.push('post'); sent.push({ key: article, url });
      const intent = state?.attempts?.at(-1);
      assert.equal(intent?.status, 'attempting', 'a durable intent must exist before note POST');
      assert.equal(intent?.key, article);
      return options.like ? options.like(article, url) : { status: 201 };
    },
  };
  return {
    events, sent, store, note,
    run(extra = {}) { return runAutoLike({ report: options.report ?? report(), note, store, runId: options.runId ?? '10', now: () => clock, ...extra }); },
    get state() { return structuredClone(state); },
    get writes() { return writes; },
    setTime(time) { clock = time; },
  };
}
function sanitized(value) {
  const text = JSON.stringify(value);
  assert.doesNotMatch(text, /NEVER_ECHO|note\.com|writer|n000000|gho_|Cookie|access_token/);
  for (const [name, item] of Object.entries(value)) {
    if (name === 'code') assert.match(item, /^[A-Z_]+$/);
    else assert.ok(Number.isInteger(item) && item >= 0, 'only aggregate counts may leave the engine');
  }
}

test('one run durably reserves one article, checks owner immediately before POST and confirms its like', async () => {
  const f = fixture({ report: report([candidate(), candidate(1)]) });
  const result = await f.run();
  assert.equal(result.code, 'LIKE_CONFIRMED');
  assert.equal(result.attempted, 1); assert.equal(result.posted, 1); assert.equal(result.liked, 1);
  assert.equal(f.sent.length, 1); assert.equal(f.state.attempts.length, 1);
  assert.equal(f.state.attempts[0].status, 'liked');
  assert.deepEqual(f.events.slice(f.events.indexOf('write-1'), f.events.indexOf('post') + 1), ['write-1', 'owner', 'post']);
  sanitized(result);
});

test('rerunning a logical Actions run never POSTs again, including with a different candidate', async () => {
  const f = fixture();
  await f.run();
  const result = await f.run({ report: report([candidate(1)]) });
  assert.equal(result.code, 'RUN_ALREADY_ATTEMPTED');
  assert.equal(f.sent.length, 1);
  assert.equal(f.writes, 2);
});

test('durable tombstones of every outcome block the same article after process reconstruction', async () => {
  for (const status of ['attempting', 'liked', 'refused', 'unknown']) {
    const f = fixture({ ledger: ledger([entry(0, { status })]) });
    const result = await f.run();
    assert.equal(result.code, 'NO_ELIGIBLE_CANDIDATE');
    assert.equal(result.skipped, 1); assert.equal(f.sent.length, 0); assert.equal(f.writes, 0);
  }
});

test('daily admission counts all attempted outcomes using the Japan midnight boundary', async () => {
  const before = Date.parse('2026-10-29T14:59:59.000Z'), after = Date.parse('2026-10-29T15:00:01.000Z');
  const publishedAt = new Date(before - 60_000).toISOString();
  const dated = { ...candidate(), publishedAt };
  const datedArticles = user => ({ data: { contents: articles(user).data.contents.map(article => ({ ...article, publishAt: publishedAt })) } });
  const attempts = Array.from({ length: 15 }, (_, i) => entry(i + 1, { at: before, status: ['liked', 'unknown', 'attempting', 'refused'][i % 4] }));
  const blocked = fixture({ time: before, ledger: ledger(attempts), articles: datedArticles, report: report([dated], { generatedAt: new Date(before).toISOString() }) });
  const stopped = await blocked.run();
  assert.equal(stopped.code, 'DAILY_LIMIT'); assert.equal(blocked.sent.length, 0);
  const resumed = fixture({ time: after, ledger: ledger(attempts), articles: datedArticles, report: report([dated], { generatedAt: new Date(after).toISOString() }) });
  const result = await resumed.run();
  assert.equal(result.code, 'LIKE_CONFIRMED');
  assert.equal(resumed.state.attempts.at(-1).day, '2026-10-30');
});

test('zero disables sending and a caller cannot exceed the hard daily cap', async () => {
  const f = fixture();
  assert.equal((await f.run({ dailyLimit: 0 })).code, 'DAILY_LIMIT');
  for (const dailyLimit of [16, -1, 1.5, '15']) assert.equal((await f.run({ dailyLimit })).code, 'CONFIG_INVALID');
  assert.equal(f.sent.length, 0); assert.equal(f.writes, 0);
});

test('invalid, stale and rate-limited reports cause no note calls or writes', async () => {
  const invalids = [
    null, report([], { owner: 'someone_else' }), report(Array.from({ length: 16 }, (_, i) => candidate(i))),
    report([candidate(), candidate()]), report([{ ...candidate(), articleUrl: 'https://evil.example/' + key(0) }]),
    report([{ ...candidate(), articleUrl: candidate().articleUrl + '?PRIVATE' }]),
    report([{ ...candidate(), profileUrl: 'https://note.com/writer1' }]),
    report([{ ...candidate(), liked: true }]), report([{ ...candidate(), following: 114, gap: 14 }]),
    report([{ ...candidate(), publishedAt: new Date(NOW + 1).toISOString() }]),
  ];
  for (const value of invalids) {
    const f = fixture();
    assert.equal((await f.run({ report: value })).code, 'REPORT_INVALID');
    assert.deepEqual(f.events, []);
  }
  for (const generatedAt of [new Date(NOW - 2 * 60 * 60 * 1000 - 1).toISOString(), new Date(NOW + 30_001).toISOString()]) {
    const f = fixture(); assert.equal((await f.run({ report: report([], { generatedAt }) })).code, 'REPORT_STALE'); assert.deepEqual(f.events, []);
  }
  const f = fixture(); assert.equal((await f.run({ report: report([], { rateLimited: true }) })).code, 'DISCOVERY_PAUSED'); assert.deepEqual(f.events, []);
});

test('fresh profile and article evidence must still satisfy the original screening conditions', async () => {
  const variants = [
    { profile: user => ({ data: { ...profile(user).data, isFollowing: true } }) },
    { profile: user => ({ data: { ...profile(user).data, isFollowed: undefined } }) },
    { profile: user => ({ data: { ...profile(user).data, followingCount: 114 } }) },
    { profile: user => ({ data: { ...profile(user).data, followerCount: null } }) },
    { profile: user => ({ data: { ...profile(user).data, urlname: 'other_writer' } }) },
    { articles: user => ({ data: { contents: articles(user).data.contents.map(a => ({ ...a, isLiked: true })) } }) },
    { articles: user => ({ data: { contents: articles(user).data.contents.map(a => ({ ...a, isLiked: undefined })) } }) },
    { articles: () => ({ data: { contents: [{ key: key(99), publishAt: new Date(NOW).toISOString(), isLiked: false }] } }) },
    { articles: () => ({ data: { contents: [{ key: key(0), publishAt: new Date(NOW - 31 * 86400000).toISOString(), isLiked: false }] } }) },
  ];
  for (const options of variants) {
    const f = fixture(options), result = await f.run();
    assert.equal(result.code, 'NO_ELIGIBLE_CANDIDATE'); assert.equal(f.sent.length, 0); assert.equal(f.writes, 0);
  }
});

test('already liked is skipped and non-boolean like state stops without POST', async () => {
  const liked = fixture({ likedState: () => true });
  assert.equal((await liked.run()).code, 'NO_ELIGIBLE_CANDIDATE');
  for (const value of [undefined, null, 0, 'false', {}]) {
    const f = fixture({ likedState: () => value });
    assert.equal((await f.run()).code, 'READ_FAILED'); assert.equal(f.sent.length, 0); assert.equal(f.writes, 0);
  }
});

test('wrong owner before screening never writes or POSTs; a changed owner after intent remains blocked', async () => {
  const wrong = fixture({ owner: () => ({ account: 'someone_else' }) });
  assert.equal((await wrong.run()).code, 'OWNER_REQUIRED'); assert.equal(wrong.writes, 0); assert.equal(wrong.sent.length, 0);
  const changed = fixture({ owner: n => ({ account: n === 1 ? OWNER : 'someone_else' }) });
  const result = await changed.run();
  assert.equal(result.code, 'OWNER_CHANGED'); assert.equal(result.posted, 0);
  assert.equal(changed.state.attempts[0].status, 'refused');
  assert.equal(changed.state.pausedUntil, new Date(NOW + 86400000).toISOString());
});

test('failed or unconfirmed intent writes never send, even if the store actually persisted the intent', async () => {
  for (const persistFirst of [false, true]) {
    const f = fixture({ write: ({ writeNumber, value, persist }) => {
      if (writeNumber === 1) { if (persistFirst) persist(value); return 'unconfirmed'; }
    } });
    const result = await f.run();
    assert.equal(result.code, 'STATE_WRITE_UNCONFIRMED'); assert.equal(f.sent.length, 0);
    if (persistFirst) assert.equal(f.state.attempts[0].status, 'attempting');
  }
  const f = fixture({ write: () => 'throw' });
  assert.equal((await f.run()).code, 'STATE_WRITE_UNCONFIRMED'); assert.equal(f.sent.length, 0);
});

test('a failed outcome save preserves the durable attempting tombstone and cannot be resent', async () => {
  const f = fixture({ write: ({ writeNumber }) => writeNumber === 2 ? 'throw' : undefined });
  const result = await f.run();
  assert.equal(result.code, 'OUTCOME_SAVE_UNCONFIRMED'); assert.equal(f.sent.length, 1);
  assert.equal(f.state.attempts[0].status, 'attempting');
  assert.equal((await f.run()).code, 'RUN_ALREADY_ATTEMPTED'); assert.equal(f.sent.length, 1);
});

test('known POST refusals pause for 24 hours and never retry', async () => {
  for (const status of [401, 403, 429]) {
    const f = fixture({ like: () => ({ status }) });
    const result = await f.run();
    assert.equal(result.code, 'LIKE_REFUSED'); assert.equal(result.refused, 1); assert.equal(f.sent.length, 1);
    assert.equal(f.state.attempts[0].httpStatus, status); assert.equal(f.state.attempts[0].status, 'refused');
    assert.equal(f.state.pausedUntil, new Date(NOW + 86400000).toISOString());
    assert.equal((await f.run({ runId: '11', report: report([candidate(1)]) })).code, 'PAUSED');
    assert.equal(f.sent.length, 1);
    sanitized(result);
  }
});

test('uncertain POST results and unverifiable confirmations remain unknown with exactly one POST', async () => {
  const cases = [
    { like: () => { throw Error(PRIVATE); } },
    ...[200, 202, 400, 500, undefined].map(status => ({ like: () => ({ status }) })),
    { likedState: () => false },
    { likedState: (_key, n) => { if (n > 1) throw Error(PRIVATE); return false; } },
    { likedState: (_key, n) => n > 1 ? 'true' : false },
  ];
  for (const options of cases) {
    const f = fixture(options), result = await f.run();
    assert.equal(result.code, 'LIKE_OUTCOME_UNKNOWN'); assert.equal(result.unknown, 1);
    assert.equal(f.sent.length, 1); assert.equal(f.state.attempts[0].status, 'unknown');
    assert.equal((await f.run()).code, 'RUN_ALREADY_ATTEMPTED'); assert.equal(f.sent.length, 1); sanitized(result);
  }
});

test('HTTP refusals during owner/read/confirmation stop and pause without exposing private error details', async () => {
  for (const status of [401, 403, 429]) {
    const error = () => { throw Object.assign(Error(PRIVATE), { status }); };
    for (const options of [{ owner: error }, { profile: error }, { articles: error }, { likedState: error }]) {
      const f = fixture(options), result = await f.run();
      assert.equal(result.code, 'READ_REFUSED'); assert.equal(f.sent.length, 0);
      assert.equal(f.state.pausedUntil, new Date(NOW + 86400000).toISOString()); sanitized(result);
    }
    const f = fixture({ likedState: (_key, n) => n === 1 ? false : error() });
    const result = await f.run();
    assert.equal(result.code, 'LIKE_OUTCOME_UNKNOWN'); assert.equal(f.state.attempts[0].status, 'unknown');
    assert.equal(f.state.pausedUntil, new Date(NOW + 86400000).toISOString()); assert.equal(f.sent.length, 1); sanitized(result);
  }
});

test('unreadable or corrupt durable state fails closed, including unknown extra data and wrong JST dates', async () => {
  const variants = [ledger([], { privateCookie: PRIVATE }), ledger([entry(0), entry(0, { runId: '1001' })]), ledger([{ ...entry(0), day: '2026-10-29' }]), ledger([{ ...entry(0), status: 'mystery' }]), ledger([{ ...entry(0), runId: 'unsafe' }]), ledger([{ ...entry(0), httpStatus: 999 }])];
  for (const value of variants) {
    const f = fixture({ ledger: value }), result = await f.run();
    assert.equal(result.code, 'STATE_INVALID'); assert.equal(f.sent.length, 0); assert.equal(f.writes, 0); sanitized(result);
  }
  const f = fixture({ readError: true });
  assert.equal((await f.run()).code, 'STATE_READ_FAILED'); assert.equal(f.sent.length, 0);
});

test('candidate screening may skip to another eligible person but never sends a second POST', async () => {
  const f = fixture({ report: report([candidate(), candidate(1), candidate(2)]), profile: user => ({ data: { ...profile(user).data, isFollowing: user === 'writer0' } }) });
  const result = await f.run();
  assert.equal(result.code, 'LIKE_CONFIRMED'); assert.equal(result.checked, 2); assert.equal(result.skipped, 1); assert.equal(f.sent.length, 1); assert.equal(f.sent[0].key, key(1));
});
