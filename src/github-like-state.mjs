import { createHash } from 'node:crypto';

const API = 'https://api.github.com';
const REPOSITORY = '/repos/neronote100/Prince_like_giver';
const BRANCH = 'automation/note-like-state';
const FILE = 'note-likes.json';
const SHA = /^[a-f0-9]{40}$/;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024;
const STATES = new Set(['attempting', 'liked', 'refused', 'unknown']);
const plain = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys, required = keys) => plain(value) &&
  Object.keys(value).every(key => keys.includes(key)) && required.every(key => Object.hasOwn(value, key));

export class LikeStateError extends Error {
  constructor(code = 'LIKE_STATE_UNAVAILABLE') {
    super('Automatic like history could not be confirmed; no new like may be sent.');
    this.name = 'LikeStateError';
    this.code = code;
  }
}
const fail = code => { throw new LikeStateError(code); };
const isoTime = value => typeof value === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const japanDay = value => new Date(Date.parse(value) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

// Rebuild an exact, public-metadata-only shape instead of serializing arbitrary
// caller objects. Credentials, candidate names and URLs never belong here.
export function validateLikeLedger(value) {
  if (!exact(value, ['version', 'owner', 'attempts', 'pausedUntil'], ['version', 'owner', 'attempts']) ||
      value.version !== 1 || value.owner !== 'nero_notelover' ||
      !Array.isArray(value.attempts) || value.attempts.length > 5000) fail('LIKE_STATE_INVALID');
  const keys = new Set(), runs = new Set();
  const attempts = value.attempts.map(attempt => {
    if (!exact(attempt, ['key', 'runId', 'day', 'attemptedAt', 'status', 'httpStatus'],
      ['key', 'runId', 'day', 'attemptedAt', 'status']) ||
        typeof attempt.key !== 'string' || !/^n[a-f0-9]{8,32}$/.test(attempt.key) ||
        typeof attempt.runId !== 'string' || !/^[1-9][0-9]{0,31}$/.test(attempt.runId) ||
        !isoTime(attempt.attemptedAt) || attempt.day !== japanDay(attempt.attemptedAt) ||
        !STATES.has(attempt.status) || keys.has(attempt.key) || runs.has(attempt.runId) ||
        Object.hasOwn(attempt, 'httpStatus') &&
          (!Number.isInteger(attempt.httpStatus) || attempt.httpStatus < 100 || attempt.httpStatus > 599)) fail('LIKE_STATE_INVALID');
    keys.add(attempt.key); runs.add(attempt.runId);
    return { key: attempt.key, runId: attempt.runId, day: attempt.day,
      attemptedAt: attempt.attemptedAt, status: attempt.status,
      ...(Object.hasOwn(attempt, 'httpStatus') ? { httpStatus: attempt.httpStatus } : {}) };
  });
  if (Object.hasOwn(value, 'pausedUntil') && value.pausedUntil !== null && !isoTime(value.pausedUntil)) fail('LIKE_STATE_INVALID');
  return { version: 1, owner: 'nero_notelover', attempts,
    ...(Object.hasOwn(value, 'pausedUntil') ? { pausedUntil: value.pausedUntil } : {}) };
}

const gitBlobSha = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');

export class GitHubLikeState {
  #token;
  #fetcher;
  constructor({ token, fetcher = globalThis.fetch } = {}) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_]{1,512}$/.test(token) || typeof fetcher !== 'function') fail('LIKE_STATE_CONFIGURATION');
    this.#token = token;
    this.#fetcher = fetcher;
  }

  async #request(path, { method = 'GET', body, missing = false } = {}) {
    let response;
    try {
      response = await this.#fetcher(API + REPOSITORY + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + this.#token,
          'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'prince-note-auto-patrol',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { fail('LIKE_STATE_UNAVAILABLE'); }
    if (missing && response.status === 404) {
      try { await response.body?.cancel(); } catch {}
      return null;
    }
    if (!response.ok || response.redirected || !response.body?.getReader) {
      try { await response.body?.cancel(); } catch {}
      fail('LIKE_STATE_UNAVAILABLE');
    }
    const reader = response.body.getReader();
    const chunks = []; let length = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > MAX_RESPONSE_BYTES) fail('LIKE_STATE_INVALID');
        chunks.push(Buffer.from(next.value));
      }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length)));
    } catch (error) {
      try { await reader.cancel(); } catch {}
      if (error instanceof LikeStateError) throw error;
      fail('LIKE_STATE_INVALID');
    } finally { reader.releaseLock(); }
  }

  async #ref(branch = BRANCH) {
    const result = await this.#request('/git/ref/heads/' + branch, { missing: branch === BRANCH });
    if (result === null) return null;
    if (result.ref !== 'refs/heads/' + branch || result.object?.type !== 'commit' || !SHA.test(result.object?.sha ?? '')) fail('LIKE_STATE_INVALID');
    return result.object.sha;
  }

  async read() {
    const revision = await this.#ref();
    if (revision === null) return { revision: null, value: null };
    const commit = await this.#request('/git/commits/' + revision);
    if (commit.sha !== revision || !SHA.test(commit.tree?.sha ?? '')) fail('LIKE_STATE_INVALID');
    const tree = await this.#request('/git/trees/' + commit.tree.sha);
    if (tree.sha !== commit.tree.sha || tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length !== 1) fail('LIKE_STATE_INVALID');
    const entry = tree.tree[0];
    if (entry.path !== FILE || entry.mode !== '100644' || entry.type !== 'blob' || !SHA.test(entry.sha ?? '')) fail('LIKE_STATE_INVALID');
    const blob = await this.#request('/git/blobs/' + entry.sha);
    if (blob.sha !== entry.sha || blob.encoding !== 'base64' || typeof blob.content !== 'string' ||
        !Number.isInteger(blob.size) || blob.size < 1 || blob.size > MAX_BYTES) fail('LIKE_STATE_INVALID');
    const encoded = blob.content.replaceAll('\n', '');
    if (encoded.length > Math.ceil(MAX_BYTES / 3) * 4 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) fail('LIKE_STATE_INVALID');
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length !== blob.size || bytes.toString('base64') !== encoded || gitBlobSha(bytes) !== entry.sha) fail('LIKE_STATE_INVALID');
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { fail('LIKE_STATE_INVALID'); }
    return { revision, value: validateLikeLedger(value) };
  }

  async write(value, expectedRevision) {
    if (expectedRevision !== null && !SHA.test(expectedRevision ?? '')) fail('LIKE_STATE_INVALID');
    const clean = validateLikeLedger(value);
    const bytes = Buffer.from(JSON.stringify(clean) + '\n', 'utf8');
    if (bytes.length > MAX_BYTES) fail('LIKE_STATE_INVALID');
    if (await this.#ref() !== expectedRevision) fail('LIKE_STATE_CONFLICT');
    const parent = expectedRevision ?? await this.#ref('main');
    const blob = await this.#request('/git/blobs', { method: 'POST', body: { encoding: 'base64', content: bytes.toString('base64') } });
    if (blob.sha !== gitBlobSha(bytes)) fail('LIKE_STATE_INVALID');
    const tree = await this.#request('/git/trees', { method: 'POST', body: {
      tree: [{ path: FILE, mode: '100644', type: 'blob', sha: blob.sha }],
    } });
    if (!SHA.test(tree.sha ?? '')) fail('LIKE_STATE_INVALID');
    const commit = await this.#request('/git/commits', { method: 'POST', body: {
      message: 'Record automatic note patrol state', tree: tree.sha, parents: [parent],
    } });
    if (!SHA.test(commit.sha ?? '')) fail('LIKE_STATE_INVALID');
    // A non-fast-forward update is rejected by GitHub. Never force or retry a
    // lost response: the caller must not send note's POST without proof here.
    if (expectedRevision === null) {
      await this.#request('/git/refs', { method: 'POST', body: { ref: 'refs/heads/' + BRANCH, sha: commit.sha } });
    } else {
      await this.#request('/git/refs/heads/' + BRANCH, { method: 'PATCH', body: { sha: commit.sha, force: false } });
    }
    if (await this.#ref() !== commit.sha) fail('LIKE_STATE_UNCONFIRMED');
    return commit.sha;
  }
}
