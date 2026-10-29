import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProfile, qualifiesByFollowRatio } from '../scripts/candidates.mjs';

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

test('requires at least 15 percent more following than followers',()=>{
  assert.equal(qualifiesByFollowRatio(115, 100), true);
  assert.equal(qualifiesByFollowRatio(114, 100), false);
  assert.equal(qualifiesByFollowRatio(230, 200), true);
  assert.equal(qualifiesByFollowRatio(229, 200), false);
  assert.equal(qualifiesByFollowRatio(200, 200), false);
  assert.equal(qualifiesByFollowRatio(null, 100), false);
  assert.equal(qualifiesByFollowRatio(115, undefined), false);
  assert.equal(qualifiesByFollowRatio(20, 17), false); // Keep the existing 10-person minimum.
});
test('exactly 15 percent passes all screening conditions',()=>{
  const row={data:{...user.data,followingCount:115,followerCount:100}};
  assert.equal(evaluateProfile(row, data, now).reason, 'eligible');
  const below={data:{...user.data,followingCount:114,followerCount:100}};
  assert.equal(evaluateProfile(below, data, now).reason, 'insufficient_follow_gap');
});
