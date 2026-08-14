/**
 * Shopee Coin Data Exporter
 * Generates safe CSV and TXT files from an immutable snapshot.
 */

window.ShopeeCoinExporter = (function () {
  'use strict';

  let exportInProgress = false;
  const textEncoder = new TextEncoder();

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    try {
      anchor.href = url;
      anchor.download = filename;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
    } finally {
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  }

  function neutralizeSpreadsheetFormula(value) {
    const text = String(value ?? '').replace(/\u0000/g, '');
    const firstMeaningful = text.match(/^[\s\u0009\u000D]*(.)/u)?.[1] || '';
    return ['=', '+', '-', '@'].includes(firstMeaningful) ? `'${text}` : text;
  }

  function escapeCSVText(value) {
    const safe = neutralizeSpreadsheetFormula(value);
    return `"${safe.replace(/"/g, '""')}"`;
  }

  function sanitizeTXT(value, maxLength = 5000) {
    const text = String(value ?? '')
      .replace(/\r\n|\r|\n/g, ' ↵ ')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
  }

  function signedAmount(record) {
    const value = Number(record?.displayAmount);
    if (!Number.isFinite(value)) throw new Error('交易金額不是有效數字');
    if (record.type === 'gain') return Math.abs(value);
    if (record.type === 'spend' || record.type === 'expired') return -Math.abs(value);
    throw new Error(`未知交易類型：${record.type}`);
  }

  function formatNumber(value, decimals = 5) {
    if (!Number.isFinite(value)) return '';
    return value.toFixed(decimals).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  }

  function localFileTimestamp() {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${String(now.getMilliseconds()).padStart(3, '0')}`;
  }

  function typeText(type) {
    return ({ gain: '獲得', spend: '使用/折抵', expired: '過期' })[type] || '未知';
  }

  async function yieldToBrowser(index) {
    if (index > 0 && index % 1000 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  async function withExportLock(task) {
    if (exportInProgress) {
      alert('已有報表正在產生，請稍候。');
      return false;
    }
    exportInProgress = true;
    try {
      await task();
      return true;
    } catch (error) {
      console.error('[ShopeeCoinExporter] Export failed:', error);
      alert(`匯出失敗：${error.message || '未知錯誤'}`);
      return false;
    } finally {
      exportInProgress = false;
    }
  }

  function validateRecords(records) {
    if (!Array.isArray(records) || records.length === 0) {
      alert('無可匯出的蝦幣紀錄！');
      return null;
    }
    return records.slice();
  }

  function exportCSV(records) {
    const snapshot = validateRecords(records);
    if (!snapshot) return Promise.resolve(false);

    return withExportLock(async () => {
      const parts = [textEncoder.encode(`\uFEFF${['交易時間', '項目說明', '分類', '分類規則', '分類信心', '分類說明', '變動類型', '蝦幣數量', '到期日期', '訂單編號'].map(escapeCSVText).join(',')}\r\n`)];
      let chunk = [];

      for (let index = 0; index < snapshot.length; index += 1) {
        const record = snapshot[index];
        const amount = signedAmount(record);
        chunk.push([
          escapeCSVText(record.dateStr),
          escapeCSVText(record.title),
          escapeCSVText(record.category),
          escapeCSVText(record.categoryRuleId || ''),
          escapeCSVText(record.categoryConfidence || ''),
          escapeCSVText(record.categoryExplanation || ''),
          escapeCSVText(typeText(record.type)),
          formatNumber(amount),
          escapeCSVText(record.expiryDate === '-' ? '' : record.expiryDate),
          escapeCSVText(record.orderSn === '-' ? '' : record.orderSn)
        ].join(','));

        if (chunk.length >= 500) {
          parts.push(textEncoder.encode(`${chunk.join('\r\n')}\r\n`));
          chunk = [];
          await yieldToBrowser(index);
        }
      }
      if (chunk.length) parts.push(textEncoder.encode(`${chunk.join('\r\n')}\r\n`));

      downloadBlob(new Blob(parts, { type: 'text/csv;charset=utf-8' }), `蝦皮蝦幣紀錄彙整_${localFileTimestamp()}.csv`);
    });
  }

  function exportTXT(records, summaryStats, accountSummary, collectionResult) {
    const snapshot = validateRecords(records);
    if (!snapshot) return Promise.resolve(false);

    return withExportLock(async () => {
      const stats = summaryStats || window.ShopeeCoinAnalytics.computeStats(snapshot);
      const lines = [
        '==================================================',
        '       蝦皮購物 (Shopee) 蝦幣歷史紀錄彙整報表',
        '==================================================',
        `匯出時間: ${new Date().toLocaleString('zh-TW', { hour12: false })}`,
        `紀錄總筆數: ${snapshot.length} 筆`,
        `資料完整性: ${collectionResult?.complete ? '已完整取得 API 可提供的期間' : '部分資料／完整性未確認'}`
      ];

      if (accountSummary && Number.isFinite(accountSummary.availableAmount)) {
        lines.push(`目前可用蝦幣（官方餘額）: ${accountSummary.availableAmount.toFixed(2)} Coins`);
        if (accountSummary.nextExpiry && Number.isFinite(accountSummary.nextExpiry.amount)) {
          lines.push(`最近到期蝦幣: ${accountSummary.nextExpiry.amount.toFixed(2)} Coins（${sanitizeTXT(accountSummary.nextExpiry.date)} 後到期）`);
        }
      } else {
        lines.push('目前可用蝦幣（官方餘額）: 無法取得');
      }

      const earliest = Number.isFinite(stats.earliestTimestampMs) ? new Date(stats.earliestTimestampMs).toLocaleDateString('zh-TW') : '-';
      const latest = Number.isFinite(stats.latestTimestampMs) ? new Date(stats.latestTimestampMs).toLocaleDateString('zh-TW') : '-';
      lines.push(
        `交易紀錄涵蓋期間: ${earliest} 至 ${latest}`,
        `期間實際獲得蝦幣（不含退款／沖正）: +${stats.totalGained.toFixed(2)} Coins`,
        `期間退款／沖正: +${stats.totalRefunded.toFixed(2)} Coins`,
        `期間累積折抵使用: -${stats.totalSpent.toFixed(2)} Coins`,
        `期間累積過期: -${stats.totalExpired.toFixed(2)} Coins`,
        `期間淨變動蝦幣: ${stats.periodNetChange >= 0 ? '+' : ''}${stats.periodNetChange.toFixed(2)} Coins`,
        '註: 期間淨變動會納入退款／沖正，但不包含期初既有餘額，因此不等於目前可用蝦幣。',
        '--------------------------------------------------',
        '',
        '[ 蝦幣詳細紀錄列表 ]',
        '--------------------------------------------------'
      );

      const parts = [textEncoder.encode(`${lines.join('\n')}\n`)];
      let chunk = [];
      for (let index = 0; index < snapshot.length; index += 1) {
        const record = snapshot[index];
        const amount = signedAmount(record);
        chunk.push(
          `${index + 1}. [${sanitizeTXT(record.dateStr)}] ${sanitizeTXT(record.title)}\n` +
          `    - 分類: ${sanitizeTXT(record.category)} | 類型: ${typeText(record.type)}\n` +
          `    - 分類依據: ${sanitizeTXT(record.categoryRuleId || 'unknown')} | 信心: ${sanitizeTXT(record.categoryConfidence || 'low')}\n` +
          (record.categoryExplanation ? `    - 分類說明: ${sanitizeTXT(record.categoryExplanation)}\n` : '') +
          `    - 變動數量: ${amount >= 0 ? '+' : ''}${formatNumber(amount)} Coins\n` +
          (record.expiryDate && record.expiryDate !== '-' ? `    - 到期日期: ${sanitizeTXT(record.expiryDate)}\n` : '') +
          (record.orderSn && record.orderSn !== '-' ? `    - 訂單編號: ${sanitizeTXT(record.orderSn)}\n` : '') +
          '\n'
        );

        if (chunk.length >= 250) {
          parts.push(textEncoder.encode(chunk.join('')));
          chunk = [];
          await yieldToBrowser(index);
        }
      }
      if (chunk.length) parts.push(textEncoder.encode(chunk.join('')));
      parts.push(textEncoder.encode('==================================================\n End of Report - 蝦幣歷史紀錄分析擴充功能生成\n==================================================\n'));

      downloadBlob(new Blob(parts, { type: 'text/plain;charset=utf-8' }), `蝦皮蝦幣紀錄彙整_${localFileTimestamp()}.txt`);
    });
  }

  function exportClassificationDiagnostics(records, collectionResult) {
    const snapshot = validateRecords(records);
    if (!snapshot) return Promise.resolve(false);

    return withExportLock(async () => {
      const quality = window.ShopeeCoinClassification.computeQuality(snapshot);
      const aggregates = new Map();
      snapshot.forEach(record => {
        const key = [record.type, record.category, record.categoryRuleId || 'unknown', record.categoryConfidence || 'low'].join('\u0000');
        const current = aggregates.get(key) || {
          type: record.type,
          category: record.category,
          ruleId: record.categoryRuleId || 'unknown',
          confidence: record.categoryConfidence || 'low',
          count: 0,
          amountMicros: 0
        };
        current.count += 1;
        current.amountMicros += Math.abs(Number(record.amountMicros) || 0);
        aggregates.set(key, current);
      });
      const payload = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        privacy: 'Aggregated classification diagnostics; titles and order numbers are excluded.',
        result: {
          status: collectionResult?.status || 'unknown',
          complete: Boolean(collectionResult?.complete),
          recordCount: snapshot.length,
          pairedRefunds: collectionResult?.pairedRefunds || 0,
          performance: collectionResult?.performance || null
        },
        quality,
        rules: Array.from(aggregates.values()).sort((a, b) => b.amountMicros - a.amountMicros || b.count - a.count)
      };
      const json = JSON.stringify(payload, null, 2);
      downloadBlob(new Blob([textEncoder.encode(json)], { type: 'application/json;charset=utf-8' }), `蝦皮蝦幣分類診斷_${localFileTimestamp()}.json`);
    });
  }

  return { exportCSV, exportTXT, exportClassificationDiagnostics };
})();
