const ORIGIN = 'https://note.com';
const OWNER = 'nero_notelover';
const KEY = /^n[a-f0-9]{8,32}$/;
const USER = /^[a-z0-9_-]{1,64}$/;

export class NoteActionError extends Error {
  constructor(code, status) {
    super('noteの応答を確認できませんでした。');
    this.name = 'NoteActionError'; this.code = code;
    if (Number.isInteger(status) && status >= 100 && status <= 599) this.status = status;
  }
}
const fail = (code, status) => { throw new NoteActionError(code, status); };

// All requests use the authenticated Playwright context already used by the
// candidate collector. No redirects, connection retries or raw responses leak.
export class NoteActionClient {
  constructor(context) {
    if (!context?.request?.fetch || typeof context.cookies !== 'function') fail('NOTE_CONFIGURATION');
    this.context = context;
  }
  async request(path, { method = 'GET', articleUrl } = {}) {
    if (!['GET', 'POST'].includes(method) || !/^\/api\/v[123]\/[A-Za-z0-9_/?=&-]+$/.test(path) || path.includes('..')) fail('NOTE_INPUT_INVALID');
    const headers = { Accept: 'application/json', Origin: ORIGIN, Referer: ORIGIN + '/',
      'Cache-Control': 'no-cache', 'X-Requested-With': 'XMLHttpRequest' };
    if (method === 'POST') {
      let article;
      try { article = new URL(articleUrl); } catch { fail('NOTE_INPUT_INVALID'); }
      if (article.origin !== ORIGIN || article.username || article.password || article.search || article.hash ||
          !/^\/[a-z0-9_-]{1,64}\/n\/n[a-f0-9]{8,32}$/.test(article.pathname) ||
          path !== '/api/v3/notes/' + article.pathname.split('/').at(-1) + '/likes') fail('NOTE_INPUT_INVALID');
      headers.Referer = article.href;
      headers['Content-Type'] = 'application/json';
      let cookies;
      try { cookies = await this.context.cookies(ORIGIN); } catch { fail('NOTE_SESSION_INVALID'); }
      const xsrf = cookies.filter(cookie => cookie.name === 'XSRF-TOKEN' && ['note.com', '.note.com'].includes(cookie.domain));
      if (xsrf.length > 1) fail('NOTE_SESSION_INVALID');
      if (xsrf.length) {
        let value;
        try { value = decodeURIComponent(xsrf[0].value); } catch { fail('NOTE_SESSION_INVALID'); }
        if (!value || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) fail('NOTE_SESSION_INVALID');
        headers['X-XSRF-TOKEN'] = value;
      }
    }
    let response;
    try {
      response = await this.context.request.fetch(ORIGIN + path, {
        method, headers, timeout: 15_000, maxRedirects: 0, maxRetries: 0,
        failOnStatusCode: false, ...(method === 'POST' ? { data: '{}' } : {}),
      });
      const status = response.status();
      if (method === 'POST') return { status };
      if (status !== 200) fail('NOTE_HTTP_REJECTED', status);
      const bytes = await response.body();
      if (bytes.length > 1024 * 1024) fail('NOTE_RESPONSE_INVALID');
      try { return JSON.parse(bytes.toString('utf8')); } catch { fail('NOTE_RESPONSE_INVALID'); }
    } catch (error) {
      if (error instanceof NoteActionError) throw error;
      fail('NOTE_NETWORK_ERROR');
    } finally { try { await response?.dispose(); } catch { /* never log response details */ } }
  }
  async owner() {
    const payload = await this.request('/api/v1/current_user');
    const user = payload?.data?.user ?? payload?.data ?? payload?.user ?? payload;
    if (user?.urlname !== OWNER || user.is_me === false || !/^[a-f0-9]{24,40}$/i.test(String(user.key ?? ''))) fail('NOTE_OWNER_MISMATCH');
    return { account: OWNER };
  }
  async profile(user) {
    if (!USER.test(user) || user === OWNER) fail('NOTE_INPUT_INVALID');
    return this.request('/api/v2/creators/' + user);
  }
  async articles(user) {
    if (!USER.test(user) || user === OWNER) fail('NOTE_INPUT_INVALID');
    return this.request('/api/v2/creators/' + user + '/contents?kind=note&disabled_pinned=true&page=1');
  }
  async likedState(key) {
    if (!KEY.test(key)) fail('NOTE_INPUT_INVALID');
    const result = await this.request('/api/v3/notes/' + key + '/likes');
    const liked = result?.data?.extra_fields?.is_liked_by_current_user;
    if (typeof liked !== 'boolean') fail('NOTE_LIKE_STATE_UNKNOWN');
    return liked;
  }
  async like(key, articleUrl) {
    if (!KEY.test(key)) fail('NOTE_INPUT_INVALID');
    return this.request('/api/v3/notes/' + key + '/likes', { method: 'POST', articleUrl });
  }
}
