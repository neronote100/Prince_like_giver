import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import worker from '../src/worker.mjs';

const demo = Array.from({length:15},(_,i)=>({
  user:'writer'+String(i+1),
  name:'候補クリエイター'+String(i+1).padStart(2,'0'),
  articleTitle:'新しい記事のタイトル '+String(i+1),
  profileUrl:'https://note.com/writer'+String(i+1),
  articleUrl:'https://note.com/writer'+String(i+1)+'/n/n123456789ab'+(i%10),
  liked:false,status:'review_only'
}));
const html=await (await worker.fetch(new Request('https://dashboard.example/'),{})).text();
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome'});
try {
  for(const [width,height] of [[390,844],[360,740],[320,600]]){
    const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true});
    const page=await context.newPage();
    let likes=0,errors=[],events=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>events.push('console '+m.text()));
    page.on('requestfailed',r=>events.push('failed '+r.url()+' '+r.failure()?.errorText));
    page.on('request',r=>events.push('request '+r.url()));
    await page.route('**/*',async route=>{
      const u=new URL(route.request().url());
      if(u.pathname==='/')return route.fulfill({status:200,contentType:'text/html',body:html});
      if(u.pathname==='/api/candidates')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,candidates:demo})});
      if(u.pathname==='/api/like') {
        likes++;
        assert.equal(route.request().method(),'POST');
        const data=route.request().postDataJSON();
        assert.ok(demo.some(c=>c.articleUrl.endsWith('/'+data.key)));
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,liked:true})});
      }
      return route.fulfill({status:404,body:'not found'});
    });
    await page.goto('https://dashboard.example/');
    await page.locator('#token').fill('example-dashboard-passphrase');
    await page.locator('#connect').tap();
    await page.locator('.row').first().waitFor({timeout:8000}).catch(async()=>{
      const body=(await page.locator('body').innerText()).slice(0,600);
      throw Error('Dashboard rows unavailable: '+JSON.stringify({body,errors,events:events.slice(-12)}));
    });
    assert.equal(await page.locator('.row').count(),15);
    const dimensions=await page.evaluate(()=>{
      const a=document.querySelectorAll('.row');
      return {lastBottom:a[a.length-1].getBoundingClientRect().bottom,
        innerHeight:innerHeight,scrollWidth:document.documentElement.scrollWidth,innerWidth:innerWidth};
    });
    assert.ok(dimensions.lastBottom<=height+1,'15 rows must fit '+width+'x'+height+': '+JSON.stringify(dimensions));
    assert.ok(dimensions.scrollWidth<=width+1,'no horizontal scroll '+width+'x'+height);
    await page.locator('.like').first().tap();
    await page.waitForFunction(() => document.querySelector('.like')?.textContent === '♥ 済', null, {timeout:5000});
    assert.equal(await page.locator('.like').first().innerText(),'♥ 済');
    assert.equal(await page.locator('.like').first().isDisabled(),true);
    assert.equal(likes,1,'one deliberate tap sends one request');
    assert.equal(errors.length,0,'runtime errors '+errors.join(', '));
    if(width===390){
      await mkdir('.tmp',{recursive:true});
      await page.screenshot({path:'.tmp/worker-like-preview.png',fullPage:false});
    }
    console.log('Worker dashboard OK '+width+'x'+height+' (15 rows, one-tap request, no repeat)');
    await context.close();
  }
}finally{await browser.close();}
