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
