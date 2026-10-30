import { evaluateProfile, qualifiesByFollowRatio } from '../scripts/candidates.mjs';

const OWNER = 'nero_notelover';
const DAY = 86_400_000;
const REPORT_AGE = 2 * 60 * 60 * 1000;
const KEY = /^n[a-f0-9]{8,32}$/;
const RUN = /^[1-9][0-9]{0,31}$/;
const STATES = new Set(['attempting', 'liked', 'refused', 'unknown']);
const REFUSALS = new Set([401, 403, 429]);
const dayInJapan = time => new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const exactKeys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isoTime = value => {
  if (typeof value !== 'string') return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
};
const revision = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const httpStatus = error => Number.isInteger(error?.status) ? error.status : Number.isInteger(error?.httpStatus) ? error.httpStatus : null;

function candidates(report, time) {
  if (!object(report) || report.owner !== OWNER || !Array.isArray(report.candidates) || report.candidates.length > 15) return null;
  const users = new Set(), keys = new Set(), safe = [];
  for (const item of report.candidates) {
    if (!object(item) || typeof item.user !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(item.user) ||
        item.user === OWNER || users.has(item.user) || item.liked !== false || item.status !== 'review_only' ||
        !qualifiesByFollowRatio(item.following, item.followers) || item.gap !== item.following - item.followers) return null;
    let profile, article;
    try { profile = new URL(item.profileUrl); article = new URL(item.articleUrl); } catch { return null; }
    const key = article.pathname.split('/').at(-1);
    if (profile.href !== 'https://note.com/' + item.user || article.href !== 'https://note.com/' + item.user + '/n/' + key ||
        !KEY.test(key) || keys.has(key)) return null;
    const published = Date.parse(item.publishedAt);
    if (!Number.isFinite(published) || published > time || time - published > 30 * DAY) return null;
    users.add(item.user); keys.add(key);
    safe.push({ user: item.user, key, articleUrl: article.href });
  }
  return safe;
}

function validLedger(value, time) {
  if (!object(value) || !exactKeys(value, ['version', 'owner', 'attempts', 'pausedUntil']) || value.version !== 1 ||
      value.owner !== OWNER || !Array.isArray(value.attempts) || value.attempts.length > 5000) return false;
  if (value.pausedUntil !== undefined && value.pausedUntil !== null && !Number.isFinite(isoTime(value.pausedUntil))) return false;
  const keys = new Set(), runs = new Set();
  for (const item of value.attempts) {
    if (!object(item) || !exactKeys(item, ['key', 'runId', 'day', 'attemptedAt', 'status', 'httpStatus']) ||
        !KEY.test(item.key) || !RUN.test(item.runId) || !STATES.has(item.status) || keys.has(item.key) || runs.has(item.runId)) return false;
    const at = isoTime(item.attemptedAt);
    if (!Number.isFinite(at) || at > time + 30_000 || item.day !== dayInJapan(at) ||
        item.httpStatus !== undefined && (!Number.isInteger(item.httpStatus) || item.httpStatus < 100 || item.httpStatus > 599)) return false;
    keys.add(item.key); runs.add(item.runId);
  }
  return true;
}

/**
 * At most one note POST per logical Actions run. Every possible POST has a
 * durable, compare-and-swap intent first; unknown outcomes are never retried.
 * The return value contains fixed codes and aggregate counts only. HTTP error
 * details, creator names, article IDs and credentials never cross this boundary.
 */
export async function runAutoLike({ report, note, store, runId, now = Date.now, dailyLimit = 15 } = {}) {
  const counts = { checked: 0, skipped: 0, attempted: 0, posted: 0, liked: 0, refused: 0, unknown: 0 };
  const done = code => ({ code, ...counts });
  const timestamp = () => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0 || value > 8.64e15 - 2 * DAY) throw Error();
    return value;
  };
  if (typeof now !== 'function' || typeof runId !== 'string' || !RUN.test(runId) ||
      !Number.isInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > 15 ||
      !note || ['owner', 'profile', 'articles', 'likedState', 'like'].some(name => typeof note[name] !== 'function') ||
      !store || ['read', 'write'].some(name => typeof store[name] !== 'function')) return done('CONFIG_INVALID');
  let time;
  try { time = timestamp(); } catch { return done('CONFIG_INVALID'); }
  let selected;
  try { selected = candidates(report, time); } catch { return done('REPORT_INVALID'); }
  if (!selected || !Number.isFinite(isoTime(report.generatedAt))) return done('REPORT_INVALID');
  const fresh = at => at - isoTime(report.generatedAt) <= REPORT_AGE && isoTime(report.generatedAt) <= at + 30_000;
  if (!fresh(time)) return done('REPORT_STALE');
  if (report.rateLimited !== false) return done('DISCOVERY_PAUSED');
  let ledger, currentRevision;
  try {
    const saved = await store.read();
    if (!object(saved) || !exactKeys(saved, ['revision', 'value'])) return done('STATE_INVALID');
    if (saved.value === null && saved.revision === null) ledger = { version: 1, owner: OWNER, attempts: [] };
    else {
      if (!revision(saved.revision) || !validLedger(saved.value, time)) return done('STATE_INVALID');
      ledger = structuredClone(saved.value);
    }
    currentRevision = saved.revision;
  } catch { return done('STATE_READ_FAILED'); }
  if (ledger.attempts.some(item => item.runId === runId)) return done('RUN_ALREADY_ATTEMPTED');
  if (ledger.pausedUntil && isoTime(ledger.pausedUntil) > time) return done('PAUSED');
  const used = at => ledger.attempts.filter(item => item.day === dayInJapan(at)).length;
  if (used(time) >= dailyLimit) return done('DAILY_LIMIT');
  if (ledger.attempts.length >= 5000) return done('STATE_LIMIT');
  async function write(value) {
    try {
      const next = await store.write(structuredClone(value), currentRevision);
      if (!revision(next)) return false;
      currentRevision = next; ledger = structuredClone(value);
      return true;
    } catch { return false; }
  }
  async function pause() {
    let at;
    try { at = timestamp(); } catch { return false; }
    return write({ ...ledger, pausedUntil: new Date(at + DAY).toISOString() });
  }
  async function refusal(error, fallback) {
    if (REFUSALS.has(httpStatus(error))) return done(await pause() ? 'READ_REFUSED' : 'STATE_WRITE_UNCONFIRMED');
    return done(fallback);
  }
  try { if ((await note.owner())?.account !== OWNER) return done('OWNER_REQUIRED'); }
  catch (error) { return refusal(error, 'OWNER_REQUIRED'); }
  for (const item of selected) {
    if (ledger.attempts.some(attempt => attempt.key === item.key)) { counts.skipped++; continue; }
    counts.checked++;
    let profile, articles, verdict;
    try {
      profile = await note.profile(item.user);
      articles = await note.articles(item.user);
      const data = profile?.data ?? profile;
      // evaluateProfile's numeric coercion must not turn absent counts into 0.
      if (typeof data?.urlname !== 'string' || data.urlname.toLowerCase() !== item.user ||
          !qualifiesByFollowRatio(data.followingCount, data.followerCount)) { counts.skipped++; continue; }
      verdict = evaluateProfile(profile, articles, timestamp());
      if (!verdict.candidate || verdict.candidate.articleUrl !== item.articleUrl) { counts.skipped++; continue; }
      const liked = await note.likedState(item.key);
      if (liked === true) { counts.skipped++; continue; }
      if (liked !== false) return done('READ_FAILED');
    } catch (error) { return refusal(error, 'READ_FAILED'); }
    try { time = timestamp(); } catch { return done('CONFIG_INVALID'); }
    if (!fresh(time)) return done('REPORT_STALE');
    if (used(time) >= dailyLimit) return done('DAILY_LIMIT');
    const intent = { key: item.key, runId, day: dayInJapan(time), attemptedAt: new Date(time).toISOString(), status: 'attempting' };
    if (!await write({ ...ledger, attempts: [...ledger.attempts, intent] })) return done('STATE_WRITE_UNCONFIRMED');
    counts.attempted++;
    let status = 'unknown', responseStatus, resultCode = 'LIKE_OUTCOME_UNKNOWN', pauseAfter = false;
    // The owner's identity is checked again after the durable intent and
    // immediately before POST. There are no intervening note operations.
    try {
      if ((await note.owner())?.account !== OWNER) {
        status = 'refused'; pauseAfter = true; resultCode = 'OWNER_CHANGED';
      } else {
        counts.posted++;
        const response = await note.like(item.key, item.articleUrl);
        responseStatus = Number.isInteger(response?.status) && response.status >= 100 && response.status <= 599 ? response.status : undefined;
        if (REFUSALS.has(responseStatus)) {
          status = 'refused'; pauseAfter = true; resultCode = 'LIKE_REFUSED';
        } else if (responseStatus === 201) {
          const confirmed = await note.likedState(item.key);
          if (confirmed === true) { status = 'liked'; resultCode = 'LIKE_CONFIRMED'; }
        }
      }
    } catch (error) {
      pauseAfter = REFUSALS.has(httpStatus(error));
      // A thrown POST or failed verification never proves that a like failed.
      // Retain unknown even when a subsequent read has a known HTTP refusal.
      if (!counts.posted && pauseAfter) { status = 'refused'; resultCode = 'OWNER_CHANGED'; }
    }
    counts[status]++;
    const final = { ...intent, status, ...(responseStatus === undefined ? {} : { httpStatus: responseStatus }) };
    const next = { ...ledger, attempts: [...ledger.attempts.slice(0, -1), final] };
    if (pauseAfter) {
      try { next.pausedUntil = new Date(timestamp() + DAY).toISOString(); }
      catch { return done('OUTCOME_SAVE_UNCONFIRMED'); }
    }
    if (!await write(next)) return done('OUTCOME_SAVE_UNCONFIRMED');
    return done(resultCode);
  }
  return done('NO_ELIGIBLE_CANDIDATE');
}
