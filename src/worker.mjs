import dashboard from './dashboard.mjs';
import { candidates } from './worker-candidates.mjs';

const NOTE='https://note.com';
const KEY=/^n[a-f0-9]{8,32}$/i;
const USER=/^[a-z0-9_-]{1,64}$/i;
const allow=new Map();
for(const c of candidates) {
  if(!USER.test(c.user||'') || c.liked!==false || c.status!=='review_only')continue;
  try{
    const url=new URL(c.articleUrl);
    if(url.origin!==NOTE || url.pathname!==('/'+c.user+'/n/'+url.pathname.split('/').at(-1)))continue;
    const key=url.pathname.split('/').at(-1);
    if(KEY.test(key))allow.set(key,c);
  }catch{}
}
const inflight=new Set();
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{
  'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff'}});
const error=(message,status)=>json({ok:false,error:message},status);

async function authorized(header,secret){
 const token=(header||'').replace(/^Bearer\s+/i,'');
 if(!token || !secret || secret.length<24)return false;
 const encoder=new TextEncoder();
 const hashes=await Promise.all([token,secret].map(s=>crypto.subtle.digest('SHA-256',encoder.encode(s))));
 const a=new Uint8Array(hashes[0]),b=new Uint8Array(hashes[1]);
 let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
 return diff===0;
}
function cookie(raw) {
 const input=String(raw||'').trim().replace(/^Cookie:\s*/i,'');
 const pair=input.split(';').map(s=>s.trim()).find(s=>s.startsWith('_note_session_v5='));
 const value=(pair?pair.slice('_note_session_v5='.length):input).replace(/^["']|["']$/g,'');
 if(!value || /[\s;\r\n]/.test(value))throw Error('Invalid note session cookie');
 return '_note_session_v5='+value;
}
async function note(env,path,options={}) {
 return fetch(NOTE+path,{
   ...options,redirect:'error',
   headers:{'Cookie':cookie(env.NOTE_SESSION_COOKIE),'Accept':'application/json',
     'Origin':NOTE,'Referer':NOTE+'/', 'Cache-Control':'no-cache',
     ...(options.headers||{})}
 });
}
async function ownerCheck(env) {
 const res=await note(env,'/api/v1/current_user');
 if(!res.ok)throw Object.assign(Error('note login verification rejected'),{status:res.status});
 const p=await res.json(),u=p?.data?.user ?? p?.data ?? p?.user ?? p;
 if(u?.urlname!=='nero_notelover')throw Error('Account mismatch');
}
async function likedState(env,key) {
 const res=await note(env,'/api/v3/notes/'+key+'/likes');
 if(!res.ok)throw Object.assign(Error('Like lookup rejected'),{status:res.status});
 const payload=await res.json();
 const state=payload?.data?.extra_fields?.is_liked_by_current_user;
 if(typeof state!=='boolean')throw Error('Like status is unavailable');
 return state;
}
export async function handleApi(req,env,allowlist=allow) {
 const url=new URL(req.url);
 if(!env.DASHBOARD_TOKEN || !env.NOTE_SESSION_COOKIE)return error('Secrets are not configured',503);
 if(!await authorized(req.headers.get('Authorization'),env.DASHBOARD_TOKEN))return error('認証が必要です',401);
 if(url.pathname==='/api/candidates' && req.method==='GET')
   return json({ok:true,candidates:[...allowlist.values()].slice(0,15)});
 if(url.pathname==='/api/status' && req.method==='GET'){
   const key=url.searchParams.get('key');
   if(!KEY.test(String(key))||!allowlist.has(key))return error('候補外の記事です',404);
   try{await ownerCheck(env);return json({ok:true,liked:await likedState(env,key)});}
   catch(e){return error('状態を確認できません',e.status===429?429:502);}
 }
 if(url.pathname==='/api/like' && req.method==='POST'){
   if(req.headers.get('Origin')!==url.origin)return error('Invalid origin',403);
   if(!req.headers.get('Content-Type')?.startsWith('application/json'))return error('JSON required',415);
   if(Number(req.headers.get('Content-Length')||0)>1024)return error('Too large',413);
   let input;try{input=await req.json();}catch{return error('Invalid JSON',400);}
   const key=String(input?.key||'');
   if(!KEY.test(key)||!allowlist.has(key))return error('候補外の記事です',404);
   if(inflight.has(key))return error('処理中です',409);
   inflight.add(key);
   try {
     await ownerCheck(env);
     if(await likedState(env,key))return json({ok:true,liked:true,alreadyLiked:true});
     const res=await note(env,'/api/v3/notes/'+key+'/likes',{
       method:'POST',headers:{'Content-Type':'application/json',
         'Referer':allowlist.get(key).articleUrl},body:'{}'
     });
     if([401,403,429].includes(res.status))return error('note側の制限で送信できません',res.status);
     if(res.status!==201)return error('noteへのスキ送信が確認できません',502);
     try {
       if(await likedState(env,key))return json({ok:true,liked:true});
     }catch{}
     // Do not retry POST automatically: a repeat may toggle the existing like.
     return json({ok:true,liked:false,confirmationPending:true},202);
   }catch(e){
     return error('認証またはスキ状態の確認に失敗しました',e.status===429?429:502);
   }finally{inflight.delete(key);}
 }
 return error('Not found',404);
}
export default {
 async fetch(req,env) {
   const url=new URL(req.url);
   if(url.pathname==='/' && req.method==='GET')return new Response(dashboard,{
     headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store',
       'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
       'Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"}
   });
   if(url.pathname.startsWith('/api/'))return handleApi(req,env);
   return new Response('Not Found',{status:404});
 }
};
