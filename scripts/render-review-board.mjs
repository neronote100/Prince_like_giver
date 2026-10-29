import { mkdir, readFile, writeFile } from 'node:fs/promises';

const ARTICLE_URL = /^https:\/\/note\.com\/[a-z0-9_-]{1,64}\/n\/n[a-f0-9]{8,32}$/i;
const PROFILE_URL = /^https:\/\/note\.com\/[a-z0-9_-]{1,64}$/i;

export function reviewItems(report) {
  if (!Array.isArray(report?.candidates)) throw new Error('No candidate list');
  return report.candidates.filter(item =>
    ARTICLE_URL.test(String(item?.articleUrl ?? '')) &&
    PROFILE_URL.test(String(item?.profileUrl ?? '')) &&
    item?.liked === false &&
    item?.status === 'review_only'
  ).map(item => ({
    user: String(item.user ?? '').slice(0, 64),
    name: String(item.name ?? '').slice(0, 120),
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
  // JSON in an HTML script element must not permit a literal closing tag.
  const json = JSON.stringify({
    generatedAt: String(report.generatedAt ?? ''),
    items
  }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  return [
    '<!doctype html>',
    '<html lang="ja"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    '<title>王子の候補レビュー 🌙</title>',
    '<style>',
    ':root{font-family:system-ui,-apple-system,sans-serif;color-scheme:light dark}',
    'body{max-width:880px;margin:0 auto;padding:20px 14px 70px;line-height:1.7}',
    'header{padding:18px 0}h1{font-size:1.6rem}p{margin:.6rem 0}',
    '.muted{opacity:.73;font-size:.9rem}',
    '.summary{display:flex;flex-wrap:wrap;gap:12px;margin:14px 0 22px}',
    '.pill{border:1px solid #8888;border-radius:30px;padding:5px 13px}',
    '.item{border:1px solid #8886;border-radius:16px;padding:18px;margin:12px 0}',
    '.item.done{opacity:.55}.item h2{font-size:1.13rem;margin:0 0 4px}',
    '.item a{overflow-wrap:anywhere}',
    '.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}',
    'button,.open{border-radius:12px;padding:9px 13px;cursor:pointer;border:1px solid #8888;font:inherit}',
    '.open{background:#122947;color:white;text-decoration:none}',
    '.warn{border-left:4px solid #a47b20;padding:8px 14px;background:#8881}',
    '</style></head><body>',
    '<header><h1>🌙 王子の候補レビュー</h1>',
    '<p>抽出結果からスキ済み判定が false の記事だけを表示。記事を読んで判断するための確認画面です。</p>',
    '<p class="warn">この画面はスキを送信しません。実際のスキはリンク先のnoteで自分で押してください。記録ボタンは確認済みの管理用です。</p>',
    '<p class="muted" id="generated"></p></header>',
    '<section class="summary" id="summary"></section>',
    '<main id="items"></main>',
    '<script id="board-data" type="application/json">' + json + '</script>',
    '<script>',
    '(function(){',
    '"use strict";',
    'const info=JSON.parse(document.getElementById("board-data").textContent);',
    'const key="prince-like-review-status-v1";let saved={};',
    'try{saved=JSON.parse(localStorage.getItem(key)||"{}");if(!saved||typeof saved!=="object"||Array.isArray(saved))saved={};}catch{saved={};}',
    'const main=document.getElementById("items"),summary=document.getElementById("summary");',
    'document.getElementById("generated").textContent="抽出日時: "+info.generatedAt+"（日本時間表示ではありません）";',
    'function element(tag,text,cls){const x=document.createElement(tag);if(text!==undefined)x.textContent=text;if(cls)x.className=cls;return x;}',
    'function save(){try{localStorage.setItem(key,JSON.stringify(saved));}catch{}}',
    'function button(text,cb){const b=element("button",text);b.type="button";b.addEventListener("click",cb);return b;}',
    'function render(){',
    'main.replaceChildren();summary.replaceChildren();',
    'const done=info.items.filter(x=>saved[x.articleUrl]==="done").length;',
    'const skipped=info.items.filter(x=>saved[x.articleUrl]==="skip").length;',
    'for(const label of ["候補 "+info.items.length+"件","確認済み "+done+"件","見送り "+skipped+"件"]){summary.append(element("span",label,"pill"));}',
    'for(const [i,x] of info.items.entries()){',
    'const current=saved[x.articleUrl];',
    'const box=element("article",undefined,"item"+(current?" done":""));',
    'const title=element("h2",(i+1)+". "+x.name);box.append(title);',
    'const profile=element("a","プロフィール: "+x.user);profile.href=x.profileUrl;profile.target="_blank";profile.rel="noopener noreferrer";box.append(profile);',
    'box.append(element("p","フォロー "+x.following+" / フォロワー "+x.followers));',
    'const link=element("a",x.articleTitle||"記事を開く","open");link.href=x.articleUrl;link.target="_blank";link.rel="noopener noreferrer";',
    'const area=element("div",undefined,"actions");area.append(link);',
    'area.append(button("noteでスキ後に記録",()=>{if(confirm("noteの記事を実際に読んで、スキを押しましたか？\\nこの操作自体はスキ送信しません。")){saved[x.articleUrl]="done";save();render();}}));',
    'area.append(button("スキ済み・見送り",()=>{saved[x.articleUrl]="skip";save();render();}));',
    'if(current)area.append(button("記録を戻す",()=>{delete saved[x.articleUrl];save();render();}));',
    'box.append(area);if(current)box.append(element("p",current==="done"?"確認済み（手動で記録）":"見送り（手動で記録）","muted"));',
    'main.append(box);',
    '}',
    '}render();',
    '})();',
    '</script></body></html>'
  ].join('\n');
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  const report = JSON.parse(await readFile('.tmp/candidates.json','utf8'));
  await mkdir('.tmp', { recursive:true });
  await writeFile('.tmp/candidate-review.html', renderBoard(report),'utf8');
  console.log('Review board generated: '+reviewItems(report).length+' articles');
}
