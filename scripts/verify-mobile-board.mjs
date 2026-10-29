import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { renderBoard } from './render-review-board.mjs';

const candidates = Array.from({length:15}, (_,i)=>({
  user:'testuser'+(i+1),
  name:'クリエイター '+String(i+1).padStart(2,'0'),
  profileUrl:'https://note.com/testuser'+(i+1),
  articleUrl:'https://note.com/testuser'+(i+1)+'/n/n123456789abc',
  articleTitle:'記事を読んで確認するサンプルのタイトル '+(i+1),
  following:200+i,followers:100+i,
  liked:false,status:'review_only'
}));
const html = renderBoard({candidates,generatedAt:'2026-10-30T00:00:00Z'});
const browser = await chromium.launch({
  headless:true,
  executablePath:process.env.CHROME_BIN || '/usr/bin/google-chrome'
});
try {
  for (const [width,height] of [[390,844],[360,740],[320,600]]) {
    const context=await browser.newContext({
      viewport:{width,height},deviceScaleFactor:2,isMobile:true,hasTouch:true
    });
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',err=>errors.push(err.message));
    await page.setContent(html,{waitUntil:'load'});
    assert.equal(await page.locator('#items .item').count(),15);
    const geometry=await page.evaluate(()=>{
      const rows=[...document.querySelectorAll('#items .item')];
      return {
        lastBottom:rows.at(-1).getBoundingClientRect().bottom,
        screenHeight:window.innerHeight,
        documentWidth:document.documentElement.scrollWidth,
        screenWidth:window.innerWidth,
        rowHeights:rows.map(r=>r.getBoundingClientRect().height)
      };
    });
    assert.ok(geometry.lastBottom<=geometry.screenHeight+1,
      '15 rows must fit vertically at '+width+'x'+height+': '+JSON.stringify(geometry));
    assert.ok(geometry.documentWidth<=geometry.screenWidth+1,
      'No horizontal scrolling at '+width+'x'+height);
    assert.equal(errors.length,0,'No script errors: '+errors.join(', '));
    const link=page.locator('#items .open').first();
    assert.ok((await link.getAttribute('href')).startsWith('https://note.com/'));
    await page.locator('#items .done-btn').first().tap();
    assert.equal(await page.locator('#count').innerText(),'✓ 1  × 0  残 14');
    assert.equal(await page.locator('#items .done-btn').first().getAttribute('aria-pressed'),'true');
    await page.locator('#items .skip-btn').first().tap();
    assert.equal(await page.locator('#count').innerText(),'✓ 0  × 1  残 14');
    assert.equal(await page.locator('#items .item').count(),15,'Rows do not disappear after marking');
    if(width===390){
      await page.locator('#items .skip-btn').first().tap();
      await mkdir('.tmp',{recursive:true});
      await page.screenshot({path:'.tmp/mobile-15-preview.png',fullPage:false});
    }
    console.log('Mobile preview OK '+width+'x'+height+': 15 rows fully visible, links and status controls work');
    await context.close();
  }
} finally {
  await browser.close();
}
