const EXPECTED_ACCOUNT = 'nero_notelover';

export function sessionValue(raw) {
  const text = String(raw ?? '').replace(/^cookie:\s*/i, '').trim().replace(/^['"]|['"]$/g, '');
  if (!text) throw new Error('NOTE_SESSION_COOKIE is not configured');
  const pair = text.split(';').map(s => s.trim()).find(s => s.startsWith('_note_session_v5='));
  const value = (pair ? pair.slice('_note_session_v5='.length) : text).replace(/^['"]|['"]$/g, '');
  if (!value || /[\s;\r\n]/.test(value)) throw new Error('Invalid session cookie format');
  return value;
}

export async function verifySession({ rawCookie, chromePath, launch } = {}) {
  const value = sessionValue(rawCookie);
  if (!launch) {
    const { chromium } = await import('playwright-core');
    launch = options => chromium.launch(options);
  }
  const browser = await launch({
    headless: true,
    executablePath: chromePath || '/usr/bin/google-chrome',
  });
  try {
    const context = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    await context.addCookies([{
      name: '_note_session_v5', value, domain: '.note.com', path: '/',
      httpOnly: true, secure: true, sameSite: 'Lax',
    }]);
    const response = await context.request.get('https://note.com/api/v1/current_user', { timeout: 20000 });
    if (!response.ok()) throw new Error('Login verification failed: HTTP ' + response.status());
    const payload = await response.json();
    const user = payload?.data?.user ?? payload?.data ?? payload?.user ?? payload;
    const account = String(user?.urlname ?? '').toLowerCase();
    if (account !== EXPECTED_ACCOUNT) throw new Error('Session account mismatch (user name hidden)');
    console.log(JSON.stringify({ ok: true, account: EXPECTED_ACCOUNT, verifiedAt: new Date().toISOString() }));
    return { ok: true, account: EXPECTED_ACCOUNT };
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  verifySession({ rawCookie: process.env.NOTE_SESSION_COOKIE, chromePath: process.env.CHROME_BIN })
    .catch(error => { console.error('Auth smoke FAILED: ' + error.message); process.exitCode = 1; });
}

