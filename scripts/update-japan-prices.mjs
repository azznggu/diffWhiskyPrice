/**
 * 일본 시장 위스키 최저가 자동 갱신 스크립트
 * Rakuten 검색 페이지 스크래핑으로 실제 시장 최저가를 수집합니다.
 * GitHub Action 또는 로컬에서 실행 가능.
 *
 * Usage: node scripts/update-japan-prices.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(__dirname, '../data/whiskies.json');

const DELAY_MS = 2000; // Rakuten 요청 간 간격 (rate limit 방지)

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function searchRakutenMinPrice(searchTerm) {
  const url = `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(searchTerm)}/?s=2`; // s=2: 가격 오름차순
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ja,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) {
      console.warn(`  ⚠️ HTTP ${res.status} for "${searchTerm}"`);
      return null;
    }
    const html = await res.text();

    // Rakuten 검색 결과에서 가격 추출 (JSON-LD 또는 HTML 패턴)
    // 패턴 1: JSON-LD Product 스키마
    const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
    if (jsonLdMatch) {
      for (const block of jsonLdMatch) {
        try {
          const jsonStr = block.replace(/<\/?script[^>]*>/gi, '');
          const data = JSON.parse(jsonStr);
          if (data['@type'] === 'ItemList' && data.itemListElement) {
            const prices = data.itemListElement
              .map(item => item.item?.offers?.price || item.item?.offers?.lowPrice)
              .filter(p => p && p > 100) // 100엔 미만 필터 (잡화 제외)
              .map(Number);
            if (prices.length > 0) return Math.min(...prices);
          }
        } catch {}
      }
    }

    // 패턴 2: HTML에서 가격 패턴 추출
    const pricePattern = /data-price="(\d+)"/g;
    const prices = [];
    let match;
    while ((match = pricePattern.exec(html)) !== null) {
      const p = parseInt(match[1]);
      if (p > 500 && p < 500000) prices.push(p); // 합리적 범위
    }
    if (prices.length > 0) return Math.min(...prices);

    // 패턴 3: 가격 텍스트에서 추출
    const textPricePattern = /class="[^"]*price[^"]*"[^>]*>[\s\S]*?([0-9,]+)\s*<span[^>]*>円/gi;
    while ((match = textPricePattern.exec(html)) !== null) {
      const p = parseInt(match[1].replace(/,/g, ''));
      if (p > 500 && p < 500000) prices.push(p);
    }
    if (prices.length > 0) return Math.min(...prices);

    // 패턴 4: 일반적인 가격 형식 ¥XX,XXX 또는 XX,XXX円
    const generalPattern = /(?:¥|￥)([0-9,]+)|([0-9,]+)\s*円/g;
    while ((match = generalPattern.exec(html)) !== null) {
      const p = parseInt((match[1] || match[2]).replace(/,/g, ''));
      if (p > 500 && p < 500000) prices.push(p);
    }
    if (prices.length > 0) return Math.min(...prices);

    console.warn(`  ⚠️ No price found for "${searchTerm}"`);
    return null;
  } catch (err) {
    console.error(`  ❌ Error for "${searchTerm}": ${err.message}`);
    return null;
  }
}

async function main() {
  console.log('📦 Loading data...');
  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  let updated = 0;
  const today = new Date().toISOString().split('T')[0];

  console.log(`🔍 Fetching Japan prices for ${data.products.length} products...\n`);

  for (const product of data.products) {
    const term = product.searchTermJP;
    if (!term) {
      console.log(`⏭️  ${product.name}: 검색어 없음, 스킵`);
      continue;
    }

    console.log(`🔎 ${product.name} → "${term}"`);
    const price = await searchRakutenMinPrice(term);

    if (price !== null) {
      const old = product.japan.priceJPY;
      product.japan.priceJPY = price;
      product.japan.verifiedDate = today;
      product.japan.source = 'rakuten.co.jp';
      const diff = price - old;
      const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '=';
      console.log(`  ✅ ¥${price.toLocaleString()} (이전: ¥${old.toLocaleString()} ${arrow})`);
      updated++;
    } else {
      console.log(`  ⚠️ 가격 조회 실패, 기존값 유지: ¥${product.japan.priceJPY.toLocaleString()}`);
    }

    await sleep(DELAY_MS);
  }

  data.meta.lastUpdated = today;
  data.meta.japanSource = 'kakaku.com / rakuten.co.jp (最安値)';

  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`\n✅ 완료! ${updated}/${data.products.length} 제품 가격 갱신됨.`);
  console.log(`📄 ${DATA_PATH} 저장됨.`);
}

main().catch(console.error);
