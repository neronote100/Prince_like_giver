import { chromium } from 'playwright-core';
import { sessionValue } from './auth-smoke.mjs';

const OWNER = 'nero_notelover';
const NAME = /^[A-Za-z0-9_-]{1,64}$/;

function profileNames(links) {
  const skip = new Set(['login','signup','terms','policy','info','about','topics','notifications','dashboard','search','magazines','help','settings','editor','all','members','likes']);
  const found = new Set();
  for (const href of links) {
    try {
      const url = new URL(href, 'https://note.com');
      if (url.origin !== 'https://note.com') continue;
      const match = url.pathname.match(/^\/([A-Za-z0-9_-]{1,64})\/?$/);
      if (match && !skip.has(match[1].toLowerCase()) && NAME.test(match[1])) found.add(match[1]);
    } catch {}
  }
  return [...found];
}

async function inspect(page, route) {
  const statuses = new Map();
  const shapeJobs = [];
  const observer = response => {
    try {
      const url = new URL(response.url());
      if (url.hostname === 'note.com' && url.pathname.startsWith('/api/')) {
        // Never log URL query strings, bodies or headers.
        statuses.set(url.pathname, response.status());
        if (/^\/api\/v3\/users\/[a-z0-9]+\/(followers|followings)$/.test(url.pathname)) {
          shapeJobs.push(response.json().then(payload => {
            const data = payload?.data ?? payload;
            const rows = Array.isArray(data) ? data : Array.isArray(data?.users) ? data.users :
              Array.isArray(data?.contents) ? data.contents : Array.isArray(data?.items) ? data.items : [];
            return {
              path: url.pathname,
              queryKeys: [...url.searchParams.keys()],
              topKeys: Object.keys(payload ?? {}).slice(0, 20),
              dataKeys: Array.isArray(data) ? ['array'] : Object.keys(data ?? {}).slice(0, 20),
              firstItemKeys: rows.length && rows[0] && typeof rows[0] === 'object' ? Object.keys(rows[0]).slice(0, 30) : [],
              rowCount: rows.length,
            };
          }).catch(() => ({ path: url.pathname, parseError: true })));
        }
      }
    } catch {}
  };
  page.on('response', observer);
  try {
    const res = await page.goto('https://note.com/' + OWNER + '/' + route, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForTimeout(2500);
    const result = await page.evaluate(() => ({
      links: [...document.querySelectorAll('a[href]')].map(a => a.href),
      contentLength: document.body?.innerText?.length || 0,
      title: document.title,
    }));
    const names = profileNames(result.links);
    const shapes = await Promise.all(shapeJobs);
    return {
      route,
      httpStatus: res?.status() || null,
      contentLength: result.contentLength,
      linkedProfileCount: names.length,
      apiResponses: [...statuses].map(([path, status]) => ({ path, status })).slice(0, 30),
      apiShapes: shapes,
    };
  } finally {
    page.off('response', observer);
  }
}

const cookie = sessionValue(process.env.NOTE_SESSION_COOKIE);
const browser = await chromium.launch({
  headless: true, executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
});
try {
  const context = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  await context.addCookies([{
    name: '_note_session_v5', value: cookie, domain: '.note.com', path: '/',
    httpOnly: true, secure: true, sameSite: 'Lax',
  }]);
  const verify = await context.request.get('https://note.com/api/v1/current_user',{timeout:20000});
  if (!verify.ok()) throw new Error('Auth rejected: ' + verify.status());
  const payload = await verify.json();
  const u = payload?.data?.user ?? payload?.data ?? payload?.user ?? payload;
  if (u?.urlname !== OWNER) throw new Error('Account mismatch');

  const page = await context.newPage();
  const report = [];
  for (const route of ['followers','followings']) {
    report.push(await inspect(page, route));
  }
  console.log('SAFE_FOLLOW_SURFACE_REPORT ' + JSON.stringify({ authenticated: true, owner: OWNER, report }));
} finally {
  await browser.close();
}
