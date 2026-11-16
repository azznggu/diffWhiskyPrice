import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 800 }, locale: 'en-SG',
});
const page = await ctx.newPage();
page.on('dialog', d => d.dismiss());
await page.goto('https://www.ishopchangi.com/en/brand/macallan/view-all?cmode=tr', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('a[href*="/en/product/"]', { timeout: 30000 }).catch(() => {});
await new Promise(s => setTimeout(s, 3000));
const out = await page.evaluate(() => {
  const res = [];
  const links = [...document.querySelectorAll('a[href*="/en/product/"]')].slice(0, 3);
  for (const a of links) {
    const chain = [];
    let el = a;
    for (let i = 0; i < 7 && el; i++) { chain.push(`${el.tagName.toLowerCase()}.${(el.className && el.className.baseVal !== undefined ? '' : (el.className || '')).toString().substring(0, 80)}`); el = el.parentElement; }
    // find card ancestor containing S$
    let card = a;
    for (let i = 0; i < 8 && card; i++) { if ((card.textContent || '').includes('S$')) break; card = card.parentElement; }
    res.push({
      href: a.getAttribute('href'),
      linkText: (a.textContent || '').trim().substring(0, 80),
      chain,
      cardClass: card ? (card.className || '').toString().substring(0, 120) : null,
      cardText: card ? (card.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 250) : null,
      cardHTML: card ? card.outerHTML.substring(0, 900) : null,
    });
  }
  return res;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
