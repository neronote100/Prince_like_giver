import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/worker.mjs';
import dashboard from '../src/dashboard.mjs';

const origin='https://prince-like-review.example.workers.dev';
const token='a-very-long-private-dashboard-key-for-tests';
const env={DASHBOARD_TOKEN:token,NOTE_SESSION_COOKIE:'_note_session_v5=test-cookie-value'};
const key='n123456789abc';
const item={user:'alice',name:'Alice',articleUrl:'https://note.com/alice/n/'+key,
  profileUrl:'https://note.com/alice',liked:false,status:'review_only'};
const allow=new Map([[key,item]]);
const valid=(path,method='GET',body)=>new Request(origin+path,{
  method,headers:{'Authorization':'Bearer '+token,'Origin':origin,
    'Content-Type':'application/json'},
  body:body?JSON.stringify(body):undefined
});

test('dashboard has 15-row layout and explicit one-click button, no batch endpoint',()=>{
  assert.ok(dashboard.includes('calc((100dvh - 82px)/15)'));
  assert.ok(dashboard.includes('♡ スキ'));
  assert.ok(dashboard.includes('"/api/like"'));
  assert.ok(!dashboard.includes('/api/bulk'));
});

test('unauthenticated calls cannot retrieve targets or send likes',async()=>{
  const res=await handleApi(new Request(origin+'/api/candidates'),env,allow);
  assert.equal(res.status,401);
  const res2=await handleApi(new Request(origin+'/api/like',{method:'POST',
    headers:{'Content-Type':'application/json','Origin':origin},body:JSON.stringify({key})}),env,allow);
  assert.equal(res2.status,401);
});

test('POST rejects invalid Origin and articles outside known candidates',async()=>{
  const originBad=await handleApi(new Request(origin+'/api/like',{method:'POST',
    headers:{Authorization:'Bearer '+token,Origin:'https://evil.example','Content-Type':'application/json'},
    body:JSON.stringify({key})}),env,allow);
  assert.equal(originBad.status,403);
  const unknown=await handleApi(valid('/api/like','POST',{key:'nffffffffffff'}),env,allow);
  assert.equal(unknown.status,404);
});

test('explicit single click sends exactly one POST, confirms result, prevents repeat likes',async()=>{
  const previous=globalThis.fetch;
  let like=false,post=0,auth=0;
  globalThis.fetch=async(url,opts)=>{
    assert.equal(opts.headers.Cookie,'_note_session_v5=test-cookie-value');
    if(url.endsWith('/api/v1/current_user')){
      auth++;return new Response(JSON.stringify({data:{urlname:'nero_notelover'}}),{status:200});
    }
    if(url.endsWith('/api/v3/notes/'+key+'/likes')){
      if(opts.method==='POST'){post++;like=true;return new Response('{}',{status:201});}
      return new Response(JSON.stringify({data:{extra_fields:{is_liked_by_current_user:like}}}),{status:200});
    }
    throw Error('unexpected url: '+url);
  };
  try{
    const first=await handleApi(valid('/api/like','POST',{key}),env,allow);
    assert.equal(first.status,200);
    assert.equal((await first.json()).liked,true);
    assert.equal(post,1);
    const repeat=await handleApi(valid('/api/like','POST',{key}),env,allow);
    const repeatData=await repeat.json();
    assert.equal(repeatData.alreadyLiked,true);
    assert.equal(post,1);
    assert.equal(auth,2);
  }finally{globalThis.fetch=previous;}
});

test('unknown like state refuses to send and does not guess success',async()=>{
  const previous=globalThis.fetch;let posts=0;
  globalThis.fetch=async(url,opts)=>{
    if(opts.method==='POST')posts++;
    if(url.endsWith('/api/v1/current_user'))
      return new Response(JSON.stringify({data:{urlname:'nero_notelover'}}),{status:200});
    return new Response(JSON.stringify({data:{extra_fields:{}}}),{status:200});
  };
  try{
    const res=await handleApi(valid('/api/like','POST',{key}),env,allow);
    assert.equal(res.status,502);
    assert.equal(posts,0);
  }finally{globalThis.fetch=previous;}
});

test('no actions when secrets missing',async()=>{
  const res=await handleApi(valid('/api/like','POST',{key}),{},allow);
  assert.equal(res.status,503);
});
