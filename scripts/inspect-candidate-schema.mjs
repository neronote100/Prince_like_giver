import { chromium } from 'playwright-core';
import { sessionValue } from './auth-smoke.mjs';

const browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN || '/usr/bin/google-chrome'});
try {
  const context=await browser.newContext({locale:'ja-JP',timezoneId:'Asia/Tokyo'});
  await context.addCookies([{name:'_note_session_v5',value:sessionValue(process.env.NOTE_SESSION_COOKIE),
    domain:'.note.com',path:'/',httpOnly:true,secure:true,sameSite:'Lax'}]);
  const me=await context.request.get('https://note.com/api/v1/current_user',{timeout:15000});
  if(!me.ok())throw Error('Authentication response HTTP '+me.status());
  const body=await me.json(), user=body?.data?.user ?? body?.data ?? body?.user ?? body;
  if(user?.urlname!=='nero_notelover')throw Error('Authenticated account mismatch');

  const keys=v=>v && typeof v==='object' ? Object.keys(v).slice(0,60):[];
  const userID=String(user?.id ?? user?.user_id ?? '');
  const record={authenticated:true,userKeys:keys(user),userIdPresent:!!userID,lists:[]};
  const page=await context.newPage();
  for(const kind of ['followers','followings']){
    let captured=null;
    const handler=async response=>{
      try{
        const u=new URL(response.url());
        if(u.hostname==='note.com'&&new RegExp('/api/v3/users/[^/]+/'+kind+'$').test(u.pathname)){
          const payload=await response.json(), data=payload?.data;
          const entry=Array.isArray(data?.follows)?data.follows[0]:null;
          captured={httpStatus:response.status(),keys:keys(data),
            totalCount:data?.total_count ?? null,returnedCount:data?.follows?.length ?? null,
            firstKeys:keys(entry),nested:keys(entry?.user ?? entry?.follower ?? entry?.following),
            sampleShape: Object.fromEntries(keys(entry).slice(0,8).map(k=>[k,typeof entry?.[k]]))};
        }
      }catch{}
    };
    page.on('response',handler);
    await page.goto('https://note.com/nero_notelover/'+kind,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForTimeout(3000);
    page.off('response',handler);
    record.lists.push({kind,...captured});
  }
  const profile=await context.request.get('https://note.com/api/v2/creators/nero_notelover',{timeout:15000});
  const p=profile.ok()?(await profile.json())?.data:null;
  record.profile={status:profile.status(),keys:keys(p),
    relationships:keys(p).filter(k=>/follow|relat|like/i.test(k)).map(k=>({key:k,type:typeof p[k]}))};
  const notes=await context.request.get('https://note.com/api/v2/creators/nero_notelover/contents?kind=note&disabled_pinned=true&page=1',{timeout:15000});
  const d=notes.ok()?(await notes.json())?.data:null;
  record.articles={status:notes.status(),keys:keys(d),count:d?.contents?.length??null,
    firstKeys:keys(d?.contents?.[0]),
    likeKeys:keys(d?.contents?.[0]).filter(k=>/like|publish|favor|status/i.test(k))};
  console.log('CANDIDATE_SCHEMA '+JSON.stringify(record));
}finally{await browser.close();}
