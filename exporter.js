/**
 * Shopee Coin Data Exporter Module
 * Generates CSV (with UTF-8 BOM) and formatted TXT files for download.
 */

window.ShopeeCoinExporter = (function () {
  'use strict';

  // Helper to trigger browser file download
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
  }

  // Sanitize CSV Field
  function escapeCSVField(str) {
    if (str === null || str === undefined) return '""';
    const stringified = String(str);
    if (stringified.includes('"') || stringified.includes(',') || stringified.includes('\n') || stringified.includes('\r')) {
      return `"${stringified.replace(/"/g, '""')}"`;
    }
    return `"${stringified}"`;
  }

  // Export to CSV
  function exportCSV(records, summaryStats) {
    if (!records || records.length === 0) {
      alert('無可匯出的蝦幣紀錄！');
      return;
    }

    const headers = ['交易時間', '項目說明', '分類', '變動類型', '蝦幣數量', '到期日期', '訂單編號'];
    const rows = [headers.map(escapeCSVField).join(',')];

    records.forEach(rec => {
      const typeText = rec.type === 'gain' ? '獲得' : (rec.type === 'spend' ? '使用/折抵' : '過期');
      const amountStr = rec.displayAmount > 0 ? `+${rec.displayAmount}` : `${rec.displayAmount}`;

      const row = [
        escapeCSVField(rec.dateStr),
        escapeCSVField(rec.title),
        escapeCSVField(rec.category),
        escapeCSVField(typeText),
        escapeCSVField(amountStr),
        escapeCSVField(rec.expiryDate),
        escapeCSVField(rec.orderSn)
      ];
      rows.push(row.join(','));
    });

    // Add UTF-8 BOM (\uFEFF) for Microsoft Excel compatibility
    const csvContent = '\uFEFF' + rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    downloadBlob(blob, `蝦皮蝦幣紀錄彙整_${timestamp}.csv`);
  }

  // Export to TXT
  function exportTXT(records, summaryStats, accountSummary) {
    if (!records || records.length === 0) {
      alert('無可匯出的蝦幣紀錄！');
      return;
    }

    const nowStr = new Date().toLocaleString('zh-TW', { hour12: false });
    let text = `==================================================\n`;
    text += `       蝦皮購物 (Shopee) 蝦幣歷史紀錄彙整報表        \n`;
    text += `==================================================\n`;
    text += `匯出時間: ${nowStr}\n`;
    text += `紀錄總筆數: ${records.length} 筆\n`;
    if (accountSummary) {
      text += `目前可用蝦幣（官方餘額）: ${accountSummary.availableAmount.toFixed(2)} Coins\n`;
      if (accountSummary.nextExpiry) {
        text += `最近到期蝦幣: ${accountSummary.nextExpiry.amount.toFixed(2)} Coins（${accountSummary.nextExpiry.date} 後到期）\n`;
      }
    }
    if (summaryStats) {
      const latestDate = records[0]?.dateStr?.substring(0, 10) || '-';
      const earliestDate = records[records.length - 1]?.dateStr?.substring(0, 10) || '-';
      text += `交易紀錄涵蓋期間: ${earliestDate} 至 ${latestDate}\n`;
      text += `期間累積獲得蝦幣: +${summaryStats.totalGained.toFixed(2)} Coins\n`;
      text += `期間累積折抵使用: -${Math.abs(summaryStats.totalSpent).toFixed(2)} Coins\n`;
      text += `期間淨變動蝦幣: ${summaryStats.netCoins >= 0 ? '+' : ''}${summaryStats.netCoins.toFixed(2)} Coins\n`;
      text += `註: 期間淨變動不包含期初既有餘額，因此不等於目前可用蝦幣。\n`;
    }
    text += `--------------------------------------------------\n\n`;

    text += `[ 蝦幣詳細紀錄列表 ]\n`;
    text += `--------------------------------------------------\n`;

    records.forEach((rec, idx) => {
      const typeText = rec.type === 'gain' ? '獲得' : (rec.type === 'spend' ? '使用/折抵' : '過期');
      const amountStr = rec.displayAmount > 0 ? `+${rec.displayAmount}` : `${rec.displayAmount}`;

      text += `${idx + 1}. [${rec.dateStr}] ${rec.title}\n`;
      text += `    - 分類: ${rec.category} | 類型: ${typeText}\n`;
      text += `    - 變動數量: ${amountStr} Coins\n`;
      if (rec.expiryDate && rec.expiryDate !== '-') {
        text += `    - 到期日期: ${rec.expiryDate}\n`;
      }
      if (rec.orderSn && rec.orderSn !== '-') {
        text += `    - 訂單編號: ${rec.orderSn}\n`;
      }
      text += `\n`;
    });

    text += `==================================================\n`;
    text += ` End of Report - 蝦幣歷史紀錄分析擴充功能生成\n`;
    text += `==================================================\n`;

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8;' });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    downloadBlob(blob, `蝦皮蝦幣紀錄彙整_${timestamp}.txt`);
  }

  return {
    exportCSV,
    exportTXT
  };
})();
