import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProfile } from '../scripts/candidates.mjs';

const now=Date.parse('2026-10-30T00:00:00Z');
const user={data:{urlname:'writer123',nickname:'Writer',
  isFollowing:false,isFollowed:false,followingCount:200,followerCount:100}};
const article={key:'n123456789abc',name:'new article',publishAt:'2026-10-28T12:00:00Z',isLiked:false};
const data={data:{contents:[article]}};
test('eligible without reciprocal follow and no prior likes',()=>{
  const got=evaluateProfile(user,data,now);
  assert.equal(got.reason,'eligible');
  assert.equal(got.candidate.user,'writer123');
  assert.equal(got.candidate.liked,false);
});
test('already liked article excludes entire person',()=>{
  assert.equal(evaluateProfile(user,{data:{contents:[{...article,isLiked:true}]}},now).reason,'already_liked');
  assert.equal(evaluateProfile(user,{data:{contents:[article,{...article,key:'nffffffffffff',isLiked:true}]}},now).reason,'already_liked');
});
test('unknown like state is not treated as unliked',()=>{
  assert.equal(evaluateProfile(user,{data:{contents:[{...article,isLiked:undefined}]}},now).reason,'unknown_like_state');
});
test('relationships and activity must be verified',()=>{
  assert.equal(evaluateProfile({data:{...user.data,isFollowing:true}},data,now).reason,'existing_relationship_or_unknown');
  assert.equal(evaluateProfile({data:{...user.data,isFollowed:true}},data,now).reason,'existing_relationship_or_unknown');
  assert.equal(evaluateProfile(user,{data:{contents:[{...article,publishAt:'2026-08-01T00:00:00Z'}]}},now).reason,'inactive_30_days');
  assert.equal(evaluateProfile({data:{...user.data,followingCount:103,followerCount:100}},data,now).reason,'insufficient_follow_gap');
});
