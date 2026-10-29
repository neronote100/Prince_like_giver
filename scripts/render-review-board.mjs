import { mkdir, readFile, writeFile } from 'node:fs/promises';

const ARTICLE_URL = /^https:\/\/note\.com\/[a-z0-9_-]{1,64}\/n\/n[a-f0-9]{8,32}$/i;
const PROFILE_URL = /^https:\/\/note\.com\/[a-z0-9_-]{1,64}$/i;

export function reviewItems(report) {
  if (!Array.isArray(report?.candidates)) throw new Error('No candidate list');
  const seen = new Set();
  return report.candidates.filter(item => {
    const user = String(item?.user ?? '').toLowerCase();
    if (!ARTICLE_URL.test(String(item?.articleUrl ?? '')) ||
        !PROFILE_URL.test(String(item?.profileUrl ?? '')) ||
        item?.liked !== false || item?.status !== 'review_only' ||
        !/^[a-z0-9_-]{1,64}$/i.test(user) ||
        new URL(item.profileUrl).pathname.slice(1).toLowerCase() !== user ||
        new URL(item.articleUrl).pathname.split('/')[1].toLowerCase() !== user ||
        seen.has(user)) return false;
    seen.add(user);
    return true;
  }).slice(0, 15).map(item => ({
    user: String(item.user).toLowerCase(),
    name: String(item.name ?? item.user).slice(0, 120),
    articleTitle: String(item.articleTitle ?? '').slice(0, 200),
    articleUrl: item.articleUrl,
    profileUrl: item.profileUrl,
    following: Number(item.following) || 0,
    followers: Number(item.followers) || 0,
    publishedAt: String(item.publishedAt ?? '')
  }));
}

export function renderBoard(report) {
  const items = reviewItems(report);
  const json = JSON.stringify({
    generatedAt: String(report.generatedAt ?? ''),
    items
  }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  return [
    '<!doctype html>',
    '<html lang="ja"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<meta name="referrer" content="no-referrer">',
    '<title>🌙 スキ候補15人 | 王子</title>',
    '<style>',
    ':root { color-scheme: light dark; font-family: system-ui, -apple-system, "Noto Sans JP", sans-serif;',
    '  --row-height: clamp(34px, calc((100dvh - 84px) / 15), 44px); }',
    '*{box-sizing:border-box}body{margin:0;background:#0f1422;color:#f5f6fa}',
    '.shell{max-width:580px;margin:0 auto;min-height:100dvh}',
    '.top{height:53px;display:flex;align-items:center;justify-content:space-between;',
    '  padding:0 12px;border-bottom:1px solid #353f55;gap:8px}',
    'h1{font-size:16px;line-height:1.2;margin:0;white-space:nowrap}',
    '.count{font-size:12px;color:#c8d3e9;white-space:nowrap;font-variant-numeric:tabular-nums}',
    '.hint{height:26px;display:flex;align-items:center;justify-content:space-between;',
    '  padding:0 10px;color:#aeb9ca;font-size:10px;white-space:nowrap;overflow:hidden}',
    '.hint span{overflow:hidden;text-overflow:ellipsis}',
    '#items{display:block}',
    '.item{height:var(--row-height);width:100%;display:grid;',
    '  grid-template-columns:22px minmax(0,1fr) 53px 34px 34px;',
    '  gap:4px;align-items:center;padding:0 5px;',
    '  border-bottom:1px solid #2b3547;background:#161d2d}',
    '.item:nth-child(even){background:#192235}',
    '.item.done{background:#10271d}.item.skip{opacity:.52}',
    '.ordinal{text-align:center;font-size:10px;font-variant-numeric:tabular-nums;color:#8f9eb7}',
    '.identity{min-width:0;display:flex;flex-direction:column;justify-content:center;',
    '  overflow:hidden;line-height:1.12;gap:1px;text-decoration:none;color:inherit}',
    '.name{font-size:12px;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.article{font-size:10px;color:#abb8ce;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.open{display:flex;height:calc(var(--row-height) - 6px);max-height:38px;',
    '  align-items:center;justify-content:center;border-radius:7px;',
    '  font-weight:750;font-size:11px;color:#fff;background:#315b9b;text-decoration:none}',
    '.open:focus-visible,.mark:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid #ffdb7d;outline-offset:1px}',
    '.mark{width:34px;height:calc(var(--row-height) - 6px);max-height:38px;',
    '  border:1px solid #54657c;border-radius:7px;color:#dce8f8;',
    '  background:#253249;font-size:16px;cursor:pointer;line-height:1}',
    '.item.done .done-btn{background:#23664a;color:#fff;border-color:#4ba782}',
    '.item.skip .skip-btn{background:#665035;color:#fff;border-color:#c69a5b}',
    '.extras{padding:10px 12px 24px;color:#bbc5d4;font-size:12px;line-height:1.6}',
    'details{border:1px solid #35425b;border-radius:9px;padding:6px 10px}',
    'summary{cursor:pointer;color:#e5e7eb;font-weight:600}',
    '.extras p{margin:8px 0}.extras button{padding:9px 12px;border:1px solid #657186;',
    '  background:#28354d;color:#fff;border-radius:8px;font:inherit}',
    '@media (prefers-reduced-motion:no-preference){.item{transition:background .12s,opacity .12s}}',
    '@media(min-width:680px){:root{--row-height:46px}.top{height:58px}}',
    '</style></head><body><div class="shell">',
    '<header class="top">',
    '<h1>🌙 王子の候補 <span id="total">0</span>人</h1>',
    '<div class="count" id="count" aria-live="polite"></div>',
    '</header>',
    '<div class="hint"><span>記事を読む → noteでスキ → ✓で記録 / ×で見送り</span></div>',
    '<main id="items" aria-label="記事候補"></main>',
    '<div class="extras"><details><summary>使い方・記録のリセット</summary>',
    '<p>「記事↗」でnoteを開いて記事を読んでください。スキはnote側で押します。',
    'このページの ✓ はスキ後の記録、× は既にスキ済み・見送りの管理用です。',
    'この画面はスキを送信しません。✓/×は管理用の記録ボタンです。</p>',
    '<p id="updated"></p>',
    '<button type="button" id="reset">15人の記録をリセット</button>',
    '</details></div>',
    '<script id="board-data" type="application/json">' + json + '</script>',
    '<script>',
    '(function(){',
    '"use strict";',
    'const info=JSON.parse(document.getElementById("board-data").textContent);',
    'const key="prince-like-review-status-v3";let statuses={};',
    'try{const old=JSON.parse(localStorage.getItem(key)||"{}");',
    '  if(old && typeof old==="object" && !Array.isArray(old))statuses=old;}catch{}',
    'const main=document.getElementById("items");',
    'document.getElementById("total").textContent=String(info.items.length);',
    'document.getElementById("updated").textContent="候補取得: "+info.generatedAt;',
    'function node(tag,cls,txt){const n=document.createElement(tag);if(cls)n.className=cls;',
    '  if(txt!==undefined)n.textContent=txt;return n;}',
    'function store(){try{localStorage.setItem(key,JSON.stringify(statuses));}catch{}}',
    'function setStatus(user,status){if(statuses[user]===status)delete statuses[user];',
    '  else statuses[user]=status;store();render();}',
    'function render(){',
    '  const fragment=document.createDocumentFragment();',
    '  let done=0,skip=0;',
    '  info.items.forEach(function(x,i){',
    '    const status=statuses[x.user];if(status==="done")done++;else if(status==="skip")skip++;',
    '    const row=node("article","item"+(status==="done"?" done":status==="skip"?" skip":""));',
    '    const ordinal=node("span","ordinal",String(i+1).padStart(2,"0"));row.append(ordinal);',
    '    const identity=node("a","identity");identity.href=x.profileUrl;',
    '    identity.target="_blank";identity.rel="noopener noreferrer";',
    '    identity.title="プロフィール: "+x.name;',
    '    identity.append(node("span","name",x.name||x.user));',
    '    identity.append(node("span","article",x.articleTitle||"記事タイトルなし"));row.append(identity);',
    '    const open=node("a","open","記事↗");open.href=x.articleUrl;',
    '    open.target="_blank";open.rel="noopener noreferrer";',
    '    open.setAttribute("aria-label",x.name+"の記事をnoteで読む");row.append(open);',
    '    const doneBtn=node("button","mark done-btn","✓");doneBtn.type="button";',
    '    doneBtn.title="noteでスキした後に記録／解除";',
    '    doneBtn.setAttribute("aria-label",x.name+"：noteでスキ後に記録（押すだけでは送信しません）");',
    '    doneBtn.setAttribute("aria-pressed",String(status==="done"));',
    '    doneBtn.addEventListener("click",()=>setStatus(x.user,"done"));row.append(doneBtn);',
    '    const skipBtn=node("button","mark skip-btn","×");skipBtn.type="button";',
    '    skipBtn.title="スキ済み・見送りの記録／解除";',
    '    skipBtn.setAttribute("aria-label",x.name+"：スキ済み・見送りの記録");',
    '    skipBtn.setAttribute("aria-pressed",String(status==="skip"));',
    '    skipBtn.addEventListener("click",()=>setStatus(x.user,"skip"));row.append(skipBtn);',
    '    fragment.append(row);',
    '  });',
    '  main.replaceChildren(fragment);',
    '  document.getElementById("count").textContent="✓ "+done+"  × "+skip+"  残 "+(info.items.length-done-skip);',
    '}',
    'document.getElementById("reset").addEventListener("click",function(){',
    '  if(!confirm("この一覧の記録をリセットしますか？"))return;',
    '  for(const item of info.items)delete statuses[item.user];store();render();',
    '});',
    'render();',
    '})();',
    '</script></div></body></html>'
  ].join('\n');
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  const report = JSON.parse(await readFile('.tmp/candidates.json','utf8'));
  await mkdir('.tmp',{recursive:true});
  await writeFile('.tmp/candidate-review.html',renderBoard(report),'utf8');
  console.log('Review board generated: '+reviewItems(report).length+' articles');
}
