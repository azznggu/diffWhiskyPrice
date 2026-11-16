import { chromium } from 'playwright';
const u = new URL(process.env.HTTPS_PROXY);
const proxy = { server: `${u.protocol}//${u.hostname}:${u.port}`, username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], proxy });
const page = await browser.newPage();
try {
  const r = await page.goto('https://shopping.yahoo.co.jp/search?p=' + encodeURIComponent('ラガヴーリン 16年 700ml') + '&X=2&sort=%2Bprice', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('status:', r && r.status(), 'url:', page.url(), 'title:', await page.title());
  await new Promise(r => setTimeout(r, 3000));
  const info = await page.evaluate(() => ({
    itemSel: document.querySelectorAll('[class*="SearchResultItem__mJ7vY"], [class*="SearchResult_SearchResultItem"], [class*="ProductList"] li, [class*="mdSearchResult"] li').length,
    priceEls: document.querySelectorAll('[class*="ItemPrice"], [class*="Price"], [class*="price"]').length,
    bodyHead: document.body.innerText.substring(0, 500),
  }));
  console.log(JSON.stringify(info, null, 1));
} catch (e) { console.log('NAV ERROR:', e.message.split('\n')[0]); }
await browser.close();
