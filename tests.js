const assert = require('node:assert/strict');
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');

global.window = {};
require('./classification.js');
require('./api.js');
require('./filters.js');
require('./charts.js');

const collector = window.ShopeeCoinCollector;
const classification = window.ShopeeCoinClassification;
const filters = window.ShopeeCoinFilters;
const analytics = window.ShopeeCoinAnalytics;

function response(body, status = 200, contentType = 'application/json', extraHeaders = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        if (name.toLowerCase() === 'content-type') return contentType;
        return extraHeaders[name] ?? null;
      }
    },
    async json() { return body; }
  };
}

function summaryBody() {
  return {
    error: 0,
    coins: {
      available_amount: 1463.11,
      expiry_info: {
        summary: [
          { year: 2026, month: 10, day: 31, coin_amount: 1213.45 },
          { year: 2026, month: 11, day: 30, coin_amount: 249.66 }
        ]
      }
    }
  };
}

async function testCompleteFetchAndExactStats() {
  const client = new collector.APIClient.constructor();
  const progress = [];
  global.fetch = async url => {
    if (url.includes('get_user_coins_summary')) return response(summaryBody());
    const offset = Number(new URL(url, 'https://shopee.tw').searchParams.get('offset'));
    if (offset === 0) {
      return response({ error: 0, has_more: true, items: [
        { id: 1, coin_amount: 0.1, ctime: 1700000000, name: '獎勵' },
        { id: 2, coin_amount: 0.2, ctime: 1700000001, name: '名稱含使用但為正數' }
      ] });
    }
    return response({ error: 0, has_more: false, items: [
      { id: 3, coin_amount: -0.3, ctime: 1700000002, name: '訂單折抵' },
      { id: 4, coin_amount: -0.05, ctime: 1700000003, name: '蝦幣過期' }
    ] });
  };

  const result = await client.fetchViaAPI(event => progress.push(event));
  assert.equal(result.status, 'complete');
  assert.equal(result.complete, true);
  assert.equal(result.records.length, 4);
  assert.equal(result.accountSummary.availableAmount, 1463.11);
  assert.equal(result.accountSummary.nextExpiry.amount, 1213.45);
  assert.ok(result.performance.totalDurationMs >= 0);
  assert.equal(result.performance.pagesFetched, 2);
  assert.ok(result.performance.averagePageDurationMs >= 0);
  assert.ok(result.performance.classificationDurationMs >= 0);
  assert.ok(progress.every(event => !Object.hasOwn(event, 'records')), 'progress must not clone all records');
  assert.ok(progress.every(event => Number.isFinite(event.lastPageDurationMs)), 'progress must expose page latency');
  assert.equal(result.records.find(record => record.id === 'api_2').type, 'gain');

  const stats = analytics.computeStats(result.records);
  assert.equal(stats.totalGainedMicros, 30000);
  assert.equal(stats.totalSpentMicros, 30000);
  assert.equal(stats.totalExpiredMicros, 5000);
  assert.equal(stats.periodNetChangeMicros, -5000);
  assert.equal(stats.periodNetChange, -0.05);
  assert.equal(stats.categoryList.reduce((sum, item) => sum + item.total, 0), 0.65);
  assert.equal(Math.round(stats.sourceCategoryList.reduce((sum, item) => sum + item.total, 0) * collector.COIN_SCALE), 30000);
  assert.equal(Math.round(stats.usageCategoryList.reduce((sum, item) => sum + item.total, 0) * collector.COIN_SCALE), 35000);
}

function testRefundsExcludedFromGainedButIncludedInNetChange() {
  const timestampMs = Date.UTC(2026, 7, 14);
  const records = [
    new collector.CoinRecord({ id: 'earned', timestampMs, title: '活動獎勵', type: 'gain', category: '蝦幣獎勵', amountMicros: collector.coinsToMicros(100) }),
    new collector.CoinRecord({ id: 'refund', timestampMs, title: '訂單取消', type: 'gain', category: '退款/沖正', amountMicros: collector.coinsToMicros(30) }),
    new collector.CoinRecord({ id: 'spent', timestampMs, title: '訂單折抵', type: 'spend', category: '訂單蝦幣折抵', amountMicros: collector.coinsToMicros(20) }),
    new collector.CoinRecord({ id: 'expired', timestampMs, title: '蝦幣過期', type: 'expired', category: '蝦幣過期', amountMicros: collector.coinsToMicros(5) })
  ];

  const stats = analytics.computeStats(records);
  assert.equal(stats.totalGained, 100, 'refunds must be excluded from actual gained coins');
  assert.equal(stats.totalRefunded, 30);
  assert.equal(stats.totalCredited, 130);
  assert.equal(stats.periodNetChange, 105, 'refunds must still affect account reconciliation');
  assert.equal(stats.sourceCategoryList.some(item => item.category === '退款/沖正'), false);
  assert.equal(stats.sourceCategoryList.reduce((sum, item) => sum + item.total, 0), 100);
  assert.equal(stats.monthlyList[0].gain, 100);
  assert.equal(stats.monthlyList[0].refunded, 30);

  const quality = classification.computeQuality([
    new collector.CoinRecord({ id: 'fallback-source', timestampMs, title: '未知來源', type: 'gain', category: '其他來源', categoryRuleId: 'source.fallback', categoryConfidence: 'low', amountMicros: collector.coinsToMicros(10) }),
    new collector.CoinRecord({ id: 'large-refund', timestampMs, title: '訂單取消', type: 'gain', category: '退款/沖正', categoryRuleId: 'source.matched-refund-order', categoryConfidence: 'high', amountMicros: collector.coinsToMicros(90) })
  ]);
  assert.equal(quality.sourceTotalAmountMicros, collector.coinsToMicros(10));
  assert.equal(quality.sourceFallbackPercent, 100, 'refunds must not dilute the other-source quality percentage');
}

async function testPartialAndRejectedRecords() {
  const client = new collector.APIClient.constructor();
  global.fetch = async url => {
    if (url.includes('get_user_coins_summary')) return response(summaryBody());
    const offset = Number(new URL(url, 'https://shopee.tw').searchParams.get('offset'));
    if (offset === 0) {
      return response({ error: 0, has_more: true, items: [
        { id: 10, coin_amount: 1, ctime: 1700000000, name: '有效' },
        { id: 11, coin_amount: 1, ctime: 0, name: '無效時間' }
      ] });
    }
    return response({}, 400);
  };

  const result = await client.fetchViaAPI();
  assert.equal(result.status, 'partial');
  assert.equal(result.complete, false);
  assert.equal(result.records.length, 1);
  assert.equal(result.rejectedRecords, 1);
  assert.equal(result.failedOffset, 2);
  assert.equal(result.error.code, 'HTTP');
}

async function testStopActuallyAborts() {
  const client = new collector.APIClient.constructor();
  global.fetch = async (url, options) => new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (options.signal.aborted) abort();
    else options.signal.addEventListener('abort', abort, { once: true });
  });

  const promise = client.fetchViaAPI();
  client.stop();
  const result = await promise;
  assert.equal(result.status, 'stopped');
  assert.equal(client.isCollecting, false);
}

async function testClearDoesNotResurrectOldData() {
  const client = new collector.APIClient.constructor();
  global.fetch = async (url, options) => new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (options.signal.aborted) abort();
    else options.signal.addEventListener('abort', abort, { once: true });
  });

  const promise = client.fetchViaAPI();
  client.clear();
  await promise;
  assert.equal(client.getRecordsArray().length, 0);
  assert.equal(client.getAccountSummary(), null);
  assert.equal(client.getLastResult(), null);
}

async function testNetworkRetryDiagnostics() {
  const client = new collector.APIClient.constructor();
  let attempts = 0;
  collector.setDebugEnabled(true);
  global.fetch = async url => {
    attempts += 1;
    assert.equal(new URL(url).origin, 'https://shopee.tw');
    if (attempts === 1) throw new TypeError('Failed to fetch');
    return response({ ok: true });
  };

  const payload = await client.fetchJSON('/api/v4/coin/debug_retry', { retries: 1 });
  assert.equal(payload.ok, true);
  assert.equal(attempts, 2);
  const events = collector.getDiagnostics().events;
  assert.ok(events.some(event => event.event === 'request:error' && event.code === 'NETWORK'));
  assert.ok(events.some(event => event.event === 'request:retry'));
  assert.ok(events.some(event => event.event === 'request:response' && event.status === 200));
  collector.setDebugEnabled(false);
}

function testActivityCategories() {
  const examples = new Map([
    ['觀看蝦皮短影音獲得蝦幣', '短影音'],
    ['每日登入獎勵', '每日登入'],
    ['完成訂單評價獎勵', '評價'],
    ['VIP 訂閱會員回饋', 'VIP訂閱'],
    ['蝦皮聯名卡消費回饋', '蝦皮聯名卡'],
    ['蝦幣獎勵發放', '蝦幣獎勵'],
    ['蝦皮直播 - 透過蝦皮直播領取的獎勵', '蝦皮直播'],
    ['直播蝦幣 - 你在蝦皮直播中獲得了蝦幣', '蝦皮直播'],
    ['蝦蝦果園 - 恭喜獲得蝦幣', '蝦皮遊戲'],
    ['VIP專屬寶箱 - 獲得10蝦幣', 'VIP訂閱'],
    ['蝦幣寶箱 - 獲得0.08蝦幣', '蝦幣獎勵']
  ]);
  examples.forEach((expected, title) => {
    const record = new collector.CoinRecord({ id: title, timestampMs: 1700000000000, title, type: 'gain', amountMicros: 1 });
    assert.equal(record.category, expected, title);
    assert.ok(collector.ACTIVITY_CATEGORIES.includes(expected));
  });
}

function testClassificationV130Fixture() {
  const fixture = JSON.parse(fs.readFileSync('tests/fixtures/classification-v130.json', 'utf8'));
  const records = [];
  let timestampMs = 1700000000000;

  fixture.usageCases.forEach(testCase => {
    assert.equal(testCase.amounts.length, testCase.count);
    testCase.amounts.forEach((amount, index) => {
      const orderSn = testCase.orderPrefix ? `${testCase.orderPrefix}-${index + 1}` : '-';
      const record = new collector.CoinRecord({
        id: `${testCase.prefix}-${index + 1}`,
        timestampMs: timestampMs++,
        title: testCase.rawName,
        rawName: testCase.rawName,
        rawReason: '',
        type: 'spend',
        amountMicros: collector.coinsToMicros(amount),
        orderSn
      });
      assert.equal(record.category, testCase.expectedCategory, testCase.prefix);
      assert.equal(record.categoryRuleId, testCase.expectedRuleId, testCase.prefix);
      records.push(record);
    });
  });

  fixture.refundCases.forEach(testCase => {
    records.push(new collector.CoinRecord({
      id: testCase.id,
      timestampMs: timestampMs++,
      title: testCase.rawName,
      rawName: testCase.rawName,
      rawReason: '',
      type: 'gain',
      amountMicros: collector.coinsToMicros(testCase.amount),
      orderSn: testCase.orderSn
    }));
  });
  fixture.unresolvedSourceCases.forEach(testCase => {
    records.push(new collector.CoinRecord({
      id: testCase.id,
      timestampMs: timestampMs++,
      title: testCase.rawName,
      rawName: testCase.rawName,
      rawReason: '',
      type: 'gain',
      amountMicros: collector.coinsToMicros(testCase.amount),
      orderSn: '-'
    }));
  });

  const result = classification.classifyRecords(records);
  const quality = classification.computeQuality(records);
  const stats = analytics.computeStats(records);
  const usageRecords = records.filter(record => ['spend', 'expired'].includes(record.type));
  const usageFallback = usageRecords.filter(record => record.category === '其他使用');
  const pairedRefundAmountMicros = records
    .filter(record => record.category === '退款/沖正')
    .reduce((sum, record) => sum + record.amountMicros, 0);

  assert.equal(usageRecords.length, fixture.expected.usageRecordCount);
  assert.equal(stats.totalSpentMicros, collector.coinsToMicros(fixture.expected.usageAmount));
  assert.equal(usageFallback.length, fixture.expected.usageFallbackCount);
  assert.equal(quality.usageFallbackPercent, fixture.expected.usageFallbackPercent);
  assert.equal(result.pairedRefunds, fixture.expected.pairedRefunds);
  assert.equal(result.pairedRefundAmountMicros, collector.coinsToMicros(fixture.expected.pairedRefundAmount));
  assert.equal(pairedRefundAmountMicros, collector.coinsToMicros(fixture.expected.pairedRefundAmount));
  assert.equal(quality.sourceFallbackAmountMicros, collector.coinsToMicros(fixture.expected.remainingSourceFallbackAmount));

  fixture.refundCases.forEach(testCase => {
    const record = records.find(item => item.id === testCase.id);
    assert.equal(record.category, '退款/沖正');
    assert.equal(record.categoryRuleId, testCase.expectedRuleId);
  });

  assert.equal(records.find(record => record.id === 'order-live-word-1').category, '訂單蝦幣折抵');
  assert.equal(records.find(record => record.id === 'order-game-word-1').category, '訂單蝦幣折抵');
  assert.equal(Math.round(stats.usageCategoryList.reduce((sum, item) => sum + item.total, 0) * collector.COIN_SCALE), stats.totalSpentMicros + stats.totalExpiredMicros);
  assert.equal(Math.round(stats.sourceCategoryList.reduce((sum, item) => sum + item.total, 0) * collector.COIN_SCALE), stats.totalGainedMicros);

  const unequalAmountPair = [
    new collector.CoinRecord({ id: 'same-order-spend', timestampMs: timestampMs++, title: 'Synthetic Order', type: 'spend', amountMicros: collector.coinsToMicros(100), orderSn: 'SAME-ORDER' }),
    new collector.CoinRecord({ id: 'same-order-gain', timestampMs: timestampMs++, title: 'Synthetic Order Reward', type: 'gain', amountMicros: collector.coinsToMicros(200), orderSn: 'SAME-ORDER' })
  ];
  classification.classifyRecords(unequalAmountPair);
  assert.equal(unequalAmountPair[1].category, '購物/訂單', 'same order with a different amount must remain an order reward, not a refund');
}

function testClassificationPerformance() {
  const records = Array.from({ length: 100000 }, (_, index) => new collector.CoinRecord({
    id: `classification_${index}`,
    timestampMs: 1700000000000 + index,
    title: index % 5 === 0 ? 'Studio Live Product' : 'Generic Marketplace Product',
    rawName: index % 5 === 0 ? 'Studio Live Product' : 'Generic Marketplace Product',
    rawReason: '',
    type: index % 4 === 0 ? 'spend' : 'gain',
    amountMicros: index % 11 + 1,
    orderSn: index % 4 === 0 ? `ORDER-${index}` : '-'
  }));
  const started = performance.now();
  const result = classification.classifyRecords(records);
  const quality = classification.computeQuality(records);
  const elapsed = performance.now() - started;
  assert.equal(result.records.length, records.length);
  assert.equal(quality.totalRecords, records.length);
  assert.ok(records.filter(record => record.type === 'spend').every(record => record.category === '訂單蝦幣折抵'));
  assert.ok(elapsed < 1500, `100,000 records should classify under 1.5s, got ${elapsed.toFixed(1)}ms`);
  console.log(`100,000-record classification: ${elapsed.toFixed(1)}ms`);
}

function testLargeRecordFiltering() {
  const records = Array.from({ length: 100000 }, (_, index) => new collector.CoinRecord({
    id: `filter_${index}`,
    timestampMs: 1700000000000 + index,
    title: index % 10 === 0 ? `短影音 BONUS ${index}` : `一般活動 ${index}`,
    type: index % 4 === 0 ? 'spend' : 'gain',
    category: index % 10 === 0 ? '短影音' : '其他活動',
    amountMicros: 1,
    orderSn: `ORDER${index}`
  }));
  const started = performance.now();
  const result = filters.filterRecords(records, 'bonus', 'gain', '短影音');
  const elapsed = performance.now() - started;
  assert.equal(filters.filterRecords(records, '', 'all', 'all'), records, 'unfiltered view should reuse the source array');
  assert.equal(result.length, 5000);
  assert.ok(elapsed < 500, `100,000 records should filter under 500ms, got ${elapsed.toFixed(1)}ms`);
  console.log(`100,000-record filtering: ${elapsed.toFixed(1)}ms`);
}

function testTenThousandRecordPerformance() {
  const records = Array.from({ length: 10000 }, (_, index) => new collector.CoinRecord({
    id: `perf_${index}`,
    timestampMs: 1700000000000 + index * 1000,
    title: '效能測試',
    type: index % 3 === 0 ? 'spend' : 'gain',
    amountMicros: index % 7 + 1
  }));
  const start = performance.now();
  const stats = analytics.computeStats(records);
  const elapsed = performance.now() - start;
  assert.equal(stats.validRecords, 10000);
  assert.ok(elapsed < 1000, `10,000 records should aggregate under 1s, got ${elapsed.toFixed(1)}ms`);
  console.log(`10,000-record aggregation: ${elapsed.toFixed(1)}ms`);
}

async function testCSVFormulaNeutralization() {
  let capturedBlob = null;
  global.alert = message => { throw new Error(message); };
  global.URL = {
    createObjectURL(blob) { capturedBlob = blob; return 'blob:test'; },
    revokeObjectURL() {}
  };
  const anchor = { style: {}, click() {}, remove() {} };
  global.document = {
    createElement() { return anchor; },
    body: { appendChild() {} }
  };
  require('./exporter.js');

  const record = new collector.CoinRecord({
    id: 'csv_1',
    timestampMs: 1700000000000,
    title: '=HYPERLINK("https://example.invalid")',
    type: 'gain',
    amountMicros: 100000
  });
  const ok = await window.ShopeeCoinExporter.exportCSV([record]);
  assert.equal(ok, true);
  const csv = await capturedBlob.text();
  assert.ok(csv.includes("\"'=HYPERLINK(\"\"https://example.invalid\"\")\""));
  assert.ok(csv.includes(',1,"",""'));
}

async function main() {
  await testCompleteFetchAndExactStats();
  testRefundsExcludedFromGainedButIncludedInNetChange();
  await testPartialAndRejectedRecords();
  await testStopActuallyAborts();
  await testClearDoesNotResurrectOldData();
  await testNetworkRetryDiagnostics();
  testActivityCategories();
  testClassificationV130Fixture();
  testClassificationPerformance();
  testLargeRecordFiltering();
  testTenThousandRecordPerformance();
  await testCSVFormulaNeutralization();

  const uiSource = fs.readFileSync('ui.js', 'utf8');
  assert.ok(uiSource.includes('body.replaceChildren()'));
  assert.ok(!uiSource.includes('tbody.innerHTML'));
  console.log('ALL_TESTS_PASSED');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
