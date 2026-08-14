const fs = require('node:fs');
const os = require('node:os');
const { performance } = require('node:perf_hooks');

if (typeof global.gc !== 'function') {
  console.error('Run with: node --expose-gc benchmark.js [output.json]');
  process.exit(1);
}

global.window = {};
global.alert = message => { throw new Error(message); };
let lastBlob = null;
global.URL = {
  createObjectURL(blob) { lastBlob = blob; return 'blob:benchmark'; },
  revokeObjectURL() {}
};
const anchor = { style: {}, click() {}, remove() {} };
global.document = {
  createElement() { return anchor; },
  body: { appendChild() {} }
};

require('./classification.js');
require('./api.js');
require('./filters.js');
require('./charts.js');
require('./exporter.js');

const collector = window.ShopeeCoinCollector;
const classification = window.ShopeeCoinClassification;
const filters = window.ShopeeCoinFilters;
const analytics = window.ShopeeCoinAnalytics;
const exporter = window.ShopeeCoinExporter;
const sizes = (process.env.BENCHMARK_SIZES || '10000,50000,100000')
  .split(',')
  .map(value => Number(value.trim()))
  .filter(value => Number.isSafeInteger(value) && value > 0);
const outputPath = process.argv[2] || 'benchmark-results.json';

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function memoryMB() {
  const memory = process.memoryUsage();
  return {
    rss: round(memory.rss / 1048576),
    heapUsed: round(memory.heapUsed / 1048576),
    heapTotal: round(memory.heapTotal / 1048576),
    external: round(memory.external / 1048576),
    arrayBuffers: round(memory.arrayBuffers / 1048576)
  };
}

function forceGC() {
  global.gc();
  global.gc();
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function timed(task, repetitions = 1) {
  const samples = [];
  let value;
  for (let index = 0; index < repetitions; index += 1) {
    const started = performance.now();
    value = task();
    samples.push(performance.now() - started);
  }
  return { milliseconds: round(median(samples)), samples: samples.map(sample => round(sample)), value };
}

function timedWithGC(task, repetitions = 1) {
  const samples = [];
  let value = null;
  for (let index = 0; index < repetitions; index += 1) {
    value = null;
    forceGC();
    const started = performance.now();
    value = task();
    samples.push(performance.now() - started);
  }
  return { milliseconds: round(median(samples)), samples: samples.map(sample => round(sample)), value };
}

async function timedAsyncWithGC(task, repetitions = 5) {
  const samples = [];
  let value;
  for (let index = 0; index < repetitions; index += 1) {
    lastBlob = null;
    forceGC();
    const started = performance.now();
    value = await task();
    samples.push(performance.now() - started);
  }
  return { milliseconds: round(median(samples)), samples: samples.map(sample => round(sample)), value };
}

function createRecords(count) {
  const categories = collector.ACTIVITY_CATEGORIES;
  const baseTimestamp = 1786723200000;
  return Array.from({ length: count }, (_, index) => {
    const category = categories[index % categories.length];
    const type = index % 20 === 0 ? 'expired' : (index % 4 === 0 ? 'spend' : 'gain');
    return new collector.CoinRecord({
      id: `benchmark_${count}_${index}`,
      timestampMs: baseTimestamp - ((index * 7919) % count) * 60000,
      title: `${category} 活動交易 ${index}，完成任務獲得蝦幣回饋`,
      type,
      amountMicros: (index % 5000) + 1,
      orderSn: index % 5 === 0 ? `260814BENCHMARK${String(index).padStart(10, '0')}` : '-'
    });
  });
}

function filterLikeUI(records, keyword, type = 'all', category = 'all') {
  return filters.filterRecords(records, keyword, type, category);
}

async function runSize(count) {
  forceGC();
  const before = memoryMB();

  const construction = timed(() => createRecords(count));
  let records = construction.value;
  construction.value = null;
  const afterRecordsImmediate = memoryMB();
  forceGC();
  const afterRecords = memoryMB();

  const classificationRun = timedWithGC(() => classification.classifyRecords(records), 5);
  const classificationQuality = classification.computeQuality(records);
  classificationRun.value = null;
  analytics.computeStats(records.slice(0, Math.min(1000, records.length)));
  const aggregation = timed(() => analytics.computeStats(records), 5);
  const stats = aggregation.value;

  const sort = timedWithGC(() => records.slice().sort((a, b) => b.timestampMs - a.timestampMs || a.id.localeCompare(b.id)), 3);
  let sortedCopy = sort.value;
  sort.value = null;
  const withSortedCopyImmediate = memoryMB();
  forceGC();
  const withSortedCopy = memoryMB();
  sortedCopy = null;
  forceGC();

  const keywordFilter = timedWithGC(() => filterLikeUI(records, '評價'), 5);
  let filtered = keywordFilter.value;
  keywordFilter.value = null;
  const keywordMatches = filtered.length;
  filtered = null;
  forceGC();

  const categoryFilter = timedWithGC(() => filterLikeUI(records, '', 'all', '短影音'), 5);
  filtered = categoryFilter.value;
  categoryFilter.value = null;
  const categoryMatches = filtered.length;
  filtered = null;
  forceGC();

  let dedupeMap;
  const mapBuild = timed(() => new Map(records.map(record => [record.id, record])));
  dedupeMap = mapBuild.value;
  mapBuild.value = null;
  const withMapImmediate = memoryMB();
  forceGC();
  const withMap = memoryMB();
  dedupeMap.clear();
  dedupeMap = null;
  forceGC();

  const beforeCSV = memoryMB();
  const csv = await timedAsyncWithGC(() => exporter.exportCSV(records));
  const csvBytes = lastBlob?.size || 0;
  const afterCSV = memoryMB();
  lastBlob = null;
  forceGC();

  const beforeTXT = memoryMB();
  const txt = await timedAsyncWithGC(() => exporter.exportTXT(records, stats, null, { complete: true }));
  const txtBytes = lastBlob?.size || 0;
  const afterTXT = memoryMB();
  lastBlob = null;
  forceGC();

  let sourceMap = new Map(records.map(record => [record.id, record]));
  records = null;
  const finalizePipeline = timed(() => Array.from(sourceMap.values()).sort((a, b) => b.timestampMs - a.timestampMs || a.id.localeCompare(b.id)));
  let retainedRecords = finalizePipeline.value;
  finalizePipeline.value = null;
  sourceMap.clear();
  sourceMap = null;
  let legacyRetainedMap = new Map(retainedRecords.map(record => [record.id, record]));
  forceGC();
  const legacyArrayAndMap = memoryMB();
  legacyRetainedMap.clear();
  legacyRetainedMap = null;
  forceGC();
  const optimizedArrayOnly = memoryMB();
  retainedRecords = null;
  forceGC();
  const afterRelease = memoryMB();

  return {
    count,
    timeMs: {
      constructRecords: construction.milliseconds,
      classificationMedian: classificationRun.milliseconds,
      classificationSamples: classificationRun.samples,
      aggregateMedian: aggregation.milliseconds,
      aggregateSamples: aggregation.samples,
      sortCopyMedian: sort.milliseconds,
      sortCopySamples: sort.samples,
      keywordFilterMedian: keywordFilter.milliseconds,
      keywordFilterSamples: keywordFilter.samples,
      categoryFilterMedian: categoryFilter.milliseconds,
      categoryFilterSamples: categoryFilter.samples,
      buildDedupeMap: mapBuild.milliseconds,
      finalizePipeline: finalizePipeline.milliseconds,
      exportCSV: csv.milliseconds,
      exportCSVSamples: csv.samples,
      exportTXT: txt.milliseconds,
      exportTXTSamples: txt.samples
    },
    output: {
      keywordMatches,
      categoryMatches,
      classificationQuality,
      csvBytes,
      txtBytes
    },
    memoryMB: {
      before,
      afterRecordsImmediate,
      afterRecords,
      recordsHeapDelta: round(afterRecords.heapUsed - before.heapUsed),
      withSortedCopyImmediate,
      withSortedCopy,
      sortedCopyHeapDelta: round(withSortedCopy.heapUsed - afterRecords.heapUsed),
      withMapImmediate,
      withMap,
      mapHeapDelta: round(withMap.heapUsed - afterRecords.heapUsed),
      beforeCSV,
      afterCSV,
      csvHeapDelta: round(afterCSV.heapUsed - beforeCSV.heapUsed),
      csvExternalDelta: round(afterCSV.external - beforeCSV.external),
      beforeTXT,
      afterTXT,
      txtHeapDelta: round(afterTXT.heapUsed - beforeTXT.heapUsed),
      txtExternalDelta: round(afterTXT.external - beforeTXT.external),
      legacyArrayAndMap,
      optimizedArrayOnly,
      retainedContainerHeapSaved: round(legacyArrayAndMap.heapUsed - optimizedArrayOnly.heapUsed),
      afterRelease
    }
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const results = [];
  for (const size of sizes) {
    console.error(`Benchmarking ${size.toLocaleString()} records...`);
    results.push(await runSize(size));
  }
  const report = {
    benchmarkVersion: 2,
    startedAt,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0]?.model || 'unknown',
      logicalCores: os.cpus().length,
      totalMemoryMB: round(os.totalmem() / 1048576)
    },
    results
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(outputPath);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
