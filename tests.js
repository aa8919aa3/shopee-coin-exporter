const assert = require('node:assert/strict');
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');

global.window = {};
require('./api.js');
require('./charts.js');

const collector = window.ShopeeCoinCollector;
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
    const offset = Number(new URL(`https://shopee.tw${url}`).searchParams.get('offset'));
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
  assert.ok(progress.every(event => !Object.hasOwn(event, 'records')), 'progress must not clone all records');
  assert.equal(result.records.find(record => record.id === 'api_2').type, 'gain');

  const stats = analytics.computeStats(result.records);
  assert.equal(stats.totalGainedMicros, 30000);
  assert.equal(stats.totalSpentMicros, 30000);
  assert.equal(stats.totalExpiredMicros, 5000);
  assert.equal(stats.periodNetChangeMicros, -5000);
  assert.equal(stats.periodNetChange, -0.05);
  assert.equal(stats.categoryList.reduce((sum, item) => sum + item.total, 0), 0.65);
}

async function testPartialAndRejectedRecords() {
  const client = new collector.APIClient.constructor();
  global.fetch = async url => {
    if (url.includes('get_user_coins_summary')) return response(summaryBody());
    const offset = Number(new URL(`https://shopee.tw${url}`).searchParams.get('offset'));
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
  await testPartialAndRejectedRecords();
  await testStopActuallyAborts();
  await testClearDoesNotResurrectOldData();
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
