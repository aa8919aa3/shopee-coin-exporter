const fs = require('node:fs');

const [baselinePath, optimizedPath, outputPath = 'benchmark-comparison.csv'] = process.argv.slice(2);
if (!baselinePath || !optimizedPath) {
  console.error('Usage: node benchmark-compare.js <baseline.json> <optimized.json> [output.csv]');
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const optimized = JSON.parse(fs.readFileSync(optimizedPath, 'utf8'));
const optimizedByCount = new Map(optimized.results.map(result => [result.count, result]));

const metrics = [
  ['time', 'constructRecords', 'timeMs', 'constructRecords', 'ms'],
  ['time', 'aggregate', 'timeMs', 'aggregateMedian', 'ms'],
  ['time', 'sortCopy', 'timeMs', 'sortCopyMedian', 'ms'],
  ['time', 'keywordFilter', 'timeMs', 'keywordFilterMedian', 'ms'],
  ['time', 'categoryFilter', 'timeMs', 'categoryFilterMedian', 'ms'],
  ['time', 'buildDedupeMap', 'timeMs', 'buildDedupeMap', 'ms'],
  ['time', 'exportCSV', 'timeMs', 'exportCSV', 'ms'],
  ['time', 'exportTXT', 'timeMs', 'exportTXT', 'ms'],
  ['memory', 'recordsHeap', 'memoryMB', 'recordsHeapDelta', 'MB'],
  ['memory', 'csvHeapDelta', 'memoryMB', 'csvHeapDelta', 'MB'],
  ['memory', 'csvExternalDelta', 'memoryMB', 'csvExternalDelta', 'MB'],
  ['memory', 'txtHeapDelta', 'memoryMB', 'txtHeapDelta', 'MB'],
  ['memory', 'txtExternalDelta', 'memoryMB', 'txtExternalDelta', 'MB']
];

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

const rows = [['record_count', 'group', 'metric', 'unit', 'baseline', 'optimized', 'change_percent', 'speedup_ratio']];
for (const before of baseline.results) {
  const after = optimizedByCount.get(before.count);
  if (!after) continue;
  for (const [group, metric, section, key, unit] of metrics) {
    const baselineValue = number(before[section]?.[key]);
    const optimizedValue = number(after[section]?.[key]);
    if (baselineValue === null || optimizedValue === null) continue;
    const changePercent = baselineValue === 0 ? null : ((optimizedValue - baselineValue) / baselineValue) * 100;
    const speedupRatio = optimizedValue === 0 ? null : baselineValue / optimizedValue;
    rows.push([
      before.count,
      group,
      metric,
      unit,
      baselineValue.toFixed(2),
      optimizedValue.toFixed(2),
      changePercent === null ? '' : changePercent.toFixed(2),
      speedupRatio === null ? '' : speedupRatio.toFixed(2)
    ]);
  }

  const legacy = number(after.memoryMB?.legacyArrayAndMap?.heapUsed);
  const arrayOnly = number(after.memoryMB?.optimizedArrayOnly?.heapUsed);
  if (legacy !== null && arrayOnly !== null) {
    rows.push([
      before.count,
      'memory',
      'retainedContainerHeap',
      'MB',
      legacy.toFixed(2),
      arrayOnly.toFixed(2),
      (((arrayOnly - legacy) / legacy) * 100).toFixed(2),
      (legacy / arrayOnly).toFixed(2)
    ]);
  }
}

fs.writeFileSync(outputPath, `${rows.map(row => row.map(csvCell).join(',')).join('\n')}\n`, 'utf8');
console.log(outputPath);
