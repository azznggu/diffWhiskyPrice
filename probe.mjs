import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], proxy: { server: process.env.HTTPS_PROXY } });

// --- Yahoo probe ---
let ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', locale: 'ja-JP', viewport: { width: 1280, height: 800 } });
let page = await ctx.newPage();
const yurl = `https://shopping.yahoo.co.jp/search?p=${encodeURIComponent('ラガヴーリン 16年 700ml')}&X=2&sort=%2Bprice`;
const r1 = await page.goto(yurl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => null);
await new Promise(r => setTimeout(r, 3000));
console.log('YAHOO status:', r1 && r1.status(), '| final URL:', page.url());
console.log('YAHOO title:', await page.title());
const yinfo = await page.evaluate(() => ({
  itemSel: document.querySelectorAll('[class*="SearchResultItem__mJ7vY"], [class*="SearchResult_SearchResultItem"], [class*="ProductList"] li, [class*="mdSearchResult"] li').length,
  waitSel: document.querySelectorAll('[class*="Product"], [class*="item"], [class*="mdSearchResult"]').length,
  priceEls: document.querySelectorAll('[class*="ItemPrice"], [class*="Price"], [class*="price"]').length,
  bodyHead: document.body.innerText.substring(0, 400),
}));
console.log(JSON.stringify(yinfo, null, 1));
await ctx.close();

// --- Changi probe ---
ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', locale: 'en-SG', viewport: { width: 1280, height: 800 } });
page = await ctx.newPage();
const r2 = await page.goto('https://www.ishopchangi.com/en/brand/macallan/view-all?cmode=tr', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => null);
await new Promise(r => setTimeout(r, 4000));
console.log('CHANGI status:', r2 && r2.status(), '| final URL:', page.url());
console.log('CHANGI title:', await page.title());
const cinfo = await page.evaluate(() => ({
  tiles: document.querySelectorAll('.product-tile-medium-wrapper, [class*="product-tile"], [class*="ProductTile"]').length,
  bodyHead: document.body.innerText.substring(0, 400),
}));
console.log(JSON.stringify(cinfo, null, 1));
await browser.close();
