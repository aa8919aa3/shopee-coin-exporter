import csv
import json
from pathlib import Path

import matplotlib.pyplot as plt

root = Path(__file__).resolve().parent
optimized = json.loads((root / 'benchmark-optimized-final.json').read_text(encoding='utf-8'))

plt.style.use('seaborn-v0_8-whitegrid')
plt.rcParams['font.family'] = ['Noto Sans CJK TC', 'Noto Sans CJK JP', 'Arial Unicode MS', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

counts = [item['count'] for item in optimized['results']]
operations = {
    '統計聚合': [item['timeMs']['aggregateMedian'] for item in optimized['results']],
    '關鍵字篩選': [item['timeMs']['keywordFilterMedian'] for item in optimized['results']],
    'CSV 匯出': [item['timeMs']['exportCSV'] for item in optimized['results']],
    'TXT 匯出': [item['timeMs']['exportTXT'] for item in optimized['results']],
}

comparison = []
with (root / 'benchmark-comparison.csv').open(encoding='utf-8', newline='') as handle:
    for row in csv.DictReader(handle):
        if row['record_count'] == '100000' and row['metric'] in {'csvHeapDelta', 'txtHeapDelta', 'retainedContainerHeap'}:
            comparison.append(row)

labels = {'csvHeapDelta': 'CSV JS heap', 'txtHeapDelta': 'TXT JS heap', 'retainedContainerHeap': '資料留存 heap'}
comparison.sort(key=lambda row: ['csvHeapDelta', 'txtHeapDelta', 'retainedContainerHeap'].index(row['metric']))

fig, axes = plt.subplots(1, 2, figsize=(13, 5.4), dpi=170)

for label, values in operations.items():
    axes[0].plot(counts, values, marker='o', linewidth=2, label=label)
axes[0].set_title('優化後大量紀錄操作延遲')
axes[0].set_xlabel('紀錄筆數')
axes[0].set_ylabel('時間（ms，中位數）')
axes[0].set_xticks(counts, [f'{count // 1000}k' for count in counts])
axes[0].legend(frameon=True)

x = range(len(comparison))
width = 0.36
baseline = [float(row['baseline']) for row in comparison]
after = [float(row['optimized']) for row in comparison]
axes[1].bar([value - width / 2 for value in x], baseline, width, label='優化前', color='#b0bec5')
axes[1].bar([value + width / 2 for value in x], after, width, label='優化後', color='#ee4d2d')
axes[1].set_title('10 萬筆記憶體比較')
axes[1].set_ylabel('記憶體（MB）')
axes[1].set_xticks(list(x), [labels[row['metric']] for row in comparison])
axes[1].legend(frameon=True)
for index, (before, current) in enumerate(zip(baseline, after)):
    axes[1].text(index - width / 2, before + 0.8, f'{before:.1f}', ha='center', fontsize=8)
    axes[1].text(index + width / 2, current + 0.8, f'{current:.1f}', ha='center', fontsize=8)

fig.suptitle('Shopee Coin Exporter 大型資料效能基準（Apple M1 Pro / Node.js）', fontsize=14, fontweight='bold')
fig.tight_layout(rect=(0, 0, 1, 0.94))
fig.savefig(root / 'benchmark-performance.png', bbox_inches='tight')
