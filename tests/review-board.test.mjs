import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewItems, renderBoard } from '../scripts/render-review-board.mjs';

const row = {
  user:'abc',name:'<script>alert("x")</script>',articleTitle:'test',
  profileUrl:'https://note.com/abc',
  articleUrl:'https://note.com/abc/n/n123456789abc',
  following:110,followers:50,liked:false,status:'review_only'
};
test('review only accepts valid note links, no already-liked rows',()=>{
  const list=reviewItems({candidates:[
    row,
    {...row,user:'bad',liked:true},
    {...row,articleUrl:'https://evil.example/n/n123456789abc'},
    {...row,status:'auto_like'},
  ]});
  assert.equal(list.length,1);
  assert.equal(list[0].user,'abc');
});
test('board does not render untrusted markup and has no API mutation',()=>{
  const html=renderBoard({generatedAt:'2026-10-30',candidates:[row]});
  assert.ok(html.includes('\\u003cscript\\u003e'));
  assert.ok(!html.includes('<script>alert("x")</script>'));
  assert.ok(html.includes('この画面はスキを送信しません'));
  assert.ok(!html.includes('fetch('));
  assert.ok(html.includes('noopener noreferrer'));
});


test('15 rows are represented in a compact smartphone-first layout',()=>{
  const candidates=Array.from({length:15},(_,i)=>({
    ...row,user:'person'+i,name:'書き手'+i,
    profileUrl:'https://note.com/person'+i,
    articleUrl:'https://note.com/person'+i+'/n/n123456789abc'
  }));
  const html=renderBoard({generatedAt:'2026-10-30',candidates});
  assert.ok(html.includes('--row-height: clamp(34px'));
  assert.ok(html.includes('grid-template-columns:22px minmax(0,1fr) 53px 34px 34px'));
  assert.ok(html.includes('記事↗'));
  assert.ok(html.includes('スキ済み・見送りの記録'));
  assert.ok(html.includes('noteでスキした後に記録'));
  assert.ok(html.includes('items.length'));
  assert.ok(html.includes('prince-like-review-status-v3'));
  assert.ok(!html.includes('fetch('));
  assert.equal(reviewItems({candidates}).length,15);
});

test('same author is not presented twice, and list stops at fifteen',()=>{
  const many=Array.from({length:20},(_,i)=>({
    ...row,user:'writer'+i,
    profileUrl:'https://note.com/writer'+i,
    articleUrl:'https://note.com/writer'+i+'/n/n123456789abc'
  }));
  assert.equal(reviewItems({candidates:many}).length,15);
  assert.equal(reviewItems({candidates:[many[0],many[0]]}).length,1);
});
