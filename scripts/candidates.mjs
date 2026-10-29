import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { sessionValue } from './auth-smoke.mjs';

const OWNER = 'nero_notelover';
const ROOT = 'https://note.com';
const NAME = /^[a-z0-9_-]{1,64}$/i;
const RECENT_MS = 30 * 86400000;
const MIN_FOLLOW_GAP = 10;
const MIN_FOLLOW_PERCENT = 15;

// Avoid float rounding at exactly 15%. Missing values must be rejected.
export function qualifiesByFollowRatio(followingRaw, followersRaw) {
  if (followingRaw === null || followersRaw === null ||
      followingRaw === undefined || followersRaw === undefined) return false;
  const following = Number(followingRaw), followers = Number(followersRaw);
  return Number.isSafeInteger(following) && Number.isSafeInteger(followers) &&
    following >= 0 && followers >= 0 && following > followers &&
    following - followers >= MIN_FOLLOW_GAP &&
    following * 100 >= followers * (100 + MIN_FOLLOW_PERCENT);
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function evaluateProfile(profile, articlePayload, now = Date.now()) {
  const p = profile?.data ?? profile;
  if (!p || !NAME.test(String(p.urlname ?? '')) || String(p.urlname).toLowerCase() === OWNER)
    return {reason:'invalid_profile'};
  if (p.isFollowing !== false || p.isFollowed !== false)
    return {reason: 'existing_relationship_or_unknown'};
  const following = Number(p.followingCount), followers = Number(p.followerCount);
  if (!qualifiesByFollowRatio(following, followers)) return {reason:'insufficient_follow_gap'};
  const articles = articlePayload?.data?.contents;
  if (!Array.isArray(articles)) return {reason:'unknown_articles'};
  const recent = articles.filter(a => {
    const time=Date.parse(String(a?.publishAt ?? a?.publishedAt ?? ''));
    return Number.isFinite(time) && time <= now && now - time <= RECENT_MS &&
      /^n[a-f0-9]{8,32}$/i.test(String(a?.key ?? ''));
  });
  if (!recent.length) return {reason:'inactive_30_days'};
  // If already liked one of the recent articles, skip the PERSON, not only the article.
  if (recent.some(a => a.isLiked === true)) return {reason:'already_liked'};
  if (recent.some(a => a.isLiked !== false)) return {reason:'unknown_like_state'};
  recent.sort((a,b)=>Date.parse(b.publishAt ?? b.publishedAt)-Date.parse(a.publishAt ?? a.publishedAt));
  const article=recent[0], username=String(p.urlname).toLowerCase();
  return {reason:'eligible', candidate:{
    user:username, name:String(p.nickname ?? username).slice(0,80),
    profileUrl:ROOT + '/' + username,
    following, followers, gap:following-followers,
    articleTitle:String(article.name ?? article.title ?? '').slice(0,150),
    publishedAt:article.publishAt ?? article.publishedAt,
    articleUrl:ROOT + '/' + username + '/n/' + article.key,
    liked:false,
    status:'review_only'
  }};
}

function followingNames(payload) {
  const list=payload?.data?.follows;
  if(!Array.isArray(list))throw new Error('note follow list shape changed');
  return [...new Set(list.map(row=>String(row?.urlname ?? '').toLowerCase())
    .filter(x=>NAME.test(x) && x !== OWNER))];
}

export async function collect({rawCookie, chromePath, maxProfiles=90, maxCandidates=15}={}) {
  const browser=await chromium.launch({headless:true,executablePath:chromePath || '/usr/bin/google-chrome'});
  try {
    const context=await browser.newContext({locale:'ja-JP',timezoneId:'Asia/Tokyo'});
    await context.addCookies([{
      name:'_note_session_v5',value:sessionValue(rawCookie),domain:'.note.com',
      path:'/',httpOnly:true,secure:true,sameSite:'Lax'
    }]);
    let requests=0;
    async function read(path) {
      if(!path.startsWith('/api/') || path.includes('..'))throw Error('Invalid path');
      const response=await context.request.get(ROOT+path,{timeout:20000,headers:{Accept:'application/json'}});
      requests++;
      if(!response.ok())throw Error('note HTTP '+response.status());
      return response.json();
    }
    const me=await read('/api/v1/current_user');
    const owner=me?.data?.user ?? me?.data ?? me?.user ?? me;
    if(owner?.urlname !== OWNER || !/^[a-f0-9]{24,40}$/i.test(String(owner?.key??'')))
      throw Error('Owner session invalid');
    const own=followingNames(await read('/api/v3/users/'+owner.key+'/followings?page=1&per=20'));
    const seeds=own.slice(0,12);
    const pool=new Set();
    const counts={scanned:0,already_liked:0,existing_relationship_or_unknown:0,
      insufficient_follow_gap:0,inactive_30_days:0,unknown_like_state:0,
      unknown_articles:0,invalid_profile:0,errors:0};
    const candidates=[];
    let rateLimited=false;
    for(const seed of seeds) {
      if(pool.size>=maxProfiles || candidates.length>=maxCandidates)break;
      try{
        const p=(await read('/api/v2/creators/'+seed))?.data;
        if(!/^[a-f0-9]{24,40}$/i.test(String(p?.key??'')))continue;
        const graph=followingNames(await read('/api/v3/users/'+p.key+'/followers?page=1&per=20'));
        for(const name of graph)pool.add(name);
      }catch(e){
        counts.errors++;
        if(/note HTTP (401|403|429)/.test(String(e?.message))){rateLimited=true;break;}
      }
      await sleep(180);
    }
    for(const username of pool) {
      if(counts.scanned>=maxProfiles || candidates.length>=maxCandidates || rateLimited)break;
      counts.scanned++;
      try {
        const profile=await read('/api/v2/creators/'+username);
        const p=profile?.data;
        if(p?.isFollowing !== false || p?.isFollowed !== false){
          counts.existing_relationship_or_unknown++;
          continue;
        }
        const f=Number(p?.followingCount),r=Number(p?.followerCount);
        if(!qualifiesByFollowRatio(p?.followingCount,p?.followerCount)){
          counts.insufficient_follow_gap++;continue;
        }
        const articlePayload=await read('/api/v2/creators/'+username+
          '/contents?kind=note&disabled_pinned=true&page=1');
        const verdict=evaluateProfile(profile,articlePayload);
        if(verdict.candidate)candidates.push(verdict.candidate);
        else counts[verdict.reason]=(counts[verdict.reason]??0)+1;
      }catch(e){
        counts.errors++;
        if(/note HTTP (401|403|429)/.test(String(e?.message))){rateLimited=true;break;}
      }
      await sleep(180);
    }
    candidates.sort((a,b)=>b.gap-a.gap || b.publishedAt.localeCompare(a.publishedAt));
    return {owner:OWNER,generatedAt:new Date().toISOString(),
      sampleOnly:true,scannedSeedCount:seeds.length,pooledUsers:pool.size,
      requests,rateLimited,summary:counts,candidates};
  }finally{await browser.close();}
}

if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href){
  collect({rawCookie:process.env.NOTE_SESSION_COOKIE}).then(async result=>{
    await mkdir('.tmp',{recursive:true});
    await writeFile('.tmp/candidates.json',JSON.stringify(result,null,2)+'\n','utf8');
    // Public repository Actions logs must not expose the complete target list.
    console.log('CANDIDATE_SUMMARY '+JSON.stringify({
      owner:result.owner,generatedAt:result.generatedAt,
      candidates:result.candidates.length,scanned:result.summary.scanned,
      skippedExistingRelationship:result.summary.existing_relationship_or_unknown,
      skippedLiked:result.summary.already_liked,skippedGap:result.summary.insufficient_follow_gap,
      skippedUnknownLike:result.summary.unknown_like_state,
      rateLimited:result.rateLimited,errors:result.summary.errors
    }));
  }).catch(error=>{
    console.error('Candidate collection failed: '+String(error?.message).slice(0,200));
    process.exitCode=1;
  });
}
