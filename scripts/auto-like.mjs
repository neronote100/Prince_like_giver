import { readFile, stat, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { sessionValue } from './auth-smoke.mjs';
import { runAutoLike } from '../src/auto-like.mjs';
import { GitHubLikeState } from '../src/github-like-state.mjs';
import { NoteActionClient } from '../src/note-action-client.mjs';

export async function main() {
  if (process.env.GITHUB_REPOSITORY !== 'neronote100/Prince_like_giver' || process.env.GITHUB_REF !== 'refs/heads/main' ||
      !['push', 'schedule', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME) ||
      !/^[1-9]\d{0,31}$/.test(process.env.GITHUB_RUN_ID ?? '')) throw Error('AUTOMATION_CONTEXT_REQUIRED');
  const rawCookie = sessionValue(process.env.NOTE_SESSION_COOKIE);
  if (rawCookie.length > 16384 || /[\x00-\x1f\x7f]/.test(rawCookie)) throw Error('NOTE_SESSION_INVALID');
  if ((await stat('.tmp/candidates.json')).size > 256 * 1024) throw Error('REPORT_INVALID');
  const report = JSON.parse(await readFile('.tmp/candidates.json', 'utf8'));
  const store = new GitHubLikeState({ token: process.env.GITHUB_TOKEN });
  const { chromium } = await import('playwright-core');
  let browser;
  try {
    // Chromium never needs either token in its child-process environment.
    const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['NOTE_SESSION_COOKIE', 'GITHUB_TOKEN', 'GH_TOKEN'].includes(key)));
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', env: childEnv });
    const context = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    await context.addCookies([{ name: '_note_session_v5', value: rawCookie, domain: '.note.com', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
    const result = await runAutoLike({ report, note: new NoteActionClient(context), store,
      runId: process.env.GITHUB_RUN_ID, dailyLimit: 15 });
    const safe = { code: /^[A-Z][A-Z0-9_]{0,63}$/.test(result?.code) ? result.code : 'AUTOMATION_FAILED' };
    for (const key of ['checked', 'skipped', 'attempted', 'posted', 'liked', 'refused', 'unknown']) {
      if (Number.isSafeInteger(result?.[key]) && result[key] >= 0) safe[key] = result[key];
    }
    console.log('AUTO_LIKE_SUMMARY ' + JSON.stringify(safe));
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, '\n### note自動巡回\n\n```json\n' + JSON.stringify(safe, null, 2) + '\n```\n');
    }
    // A recorded uncertain or refused operation stays visible as a failed job.
    const successful = new Set(['LIKE_CONFIRMED', 'NO_ELIGIBLE_CANDIDATE', 'DAILY_LIMIT', 'RUN_ALREADY_ATTEMPTED', 'PAUSED']);
    if (safe.unknown || safe.refused || !successful.has(safe.code)) process.exitCode = 1;
    return safe;
  } finally { try { await browser?.close(); } catch { /* runner cleanup; no raw exception */ } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('AUTO_LIKE_FAILED: 自動巡回を停止しました。認証情報や応答本文は表示しません。'); process.exitCode = 1; });
}
