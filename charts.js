/**
 * Shopee Coin Analytics & Charting Renderer
 * Computes exact fixed-point statistics and renders SVG charts.
 */

window.ShopeeCoinAnalytics = (function () {
  'use strict';

  const SCALE = window.ShopeeCoinCollector?.COIN_SCALE || 100000;

  function microsToCoins(value) {
    return Number.isSafeInteger(value) ? value / SCALE : 0;
  }

  function escapeXML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;'
    })[char]);
  }

  function validAmountMicros(record) {
    if (Number.isSafeInteger(record?.amountMicros)) return Math.abs(record.amountMicros);
    const fallback = Number(record?.amount);
    return Number.isFinite(fallback) ? Math.abs(Math.round(fallback * SCALE)) : null;
  }

  function computeStats(records) {
    let totalGainedMicros = 0;
    let totalRefundedMicros = 0;
    let totalSpentMicros = 0;
    let totalExpiredMicros = 0;
    let invalidRecords = 0;
    let earliestTimestampMs = null;
    let latestTimestampMs = null;

    const monthlyMap = new Map();
    const categoryMap = new Map();

    (Array.isArray(records) ? records : []).forEach(record => {
      const amountMicros = validAmountMicros(record);
      if (amountMicros === null || !['gain', 'spend', 'expired'].includes(record?.type)) {
        invalidRecords += 1;
        return;
      }

      const timestampMs = Number(record.timestampMs);
      if (Number.isFinite(timestampMs)) {
        earliestTimestampMs = earliestTimestampMs === null ? timestampMs : Math.min(earliestTimestampMs, timestampMs);
        latestTimestampMs = latestTimestampMs === null ? timestampMs : Math.max(latestTimestampMs, timestampMs);
      }

      const dateStr = record.dateStr;
      const month = typeof dateStr === 'string' && dateStr.length >= 7 && dateStr[4] === '-'
        ? dateStr.substring(0, 7)
        : '其他';
      if (!monthlyMap.has(month)) monthlyMap.set(month, { gainMicros: 0, refundedMicros: 0, spendMicros: 0, expiredMicros: 0 });
      const monthData = monthlyMap.get(month);

      const category = String(record.category || '其他');
      if (!categoryMap.has(category)) {
        categoryMap.set(category, { gainMicros: 0, refundedMicros: 0, spendMicros: 0, expiredMicros: 0, gainCount: 0, refundCount: 0, spendCount: 0, expiredCount: 0 });
      }
      const categoryData = categoryMap.get(category);

      if (record.type === 'gain') {
        if (category === '退款/沖正') {
          totalRefundedMicros += amountMicros;
          monthData.refundedMicros += amountMicros;
          categoryData.refundedMicros += amountMicros;
          categoryData.refundCount += 1;
        } else {
          totalGainedMicros += amountMicros;
          monthData.gainMicros += amountMicros;
          categoryData.gainMicros += amountMicros;
          categoryData.gainCount += 1;
        }
      } else if (record.type === 'spend') {
        totalSpentMicros += amountMicros;
        monthData.spendMicros += amountMicros;
        categoryData.spendMicros += amountMicros;
        categoryData.spendCount += 1;
      } else {
        totalExpiredMicros += amountMicros;
        monthData.expiredMicros += amountMicros;
        categoryData.expiredMicros += amountMicros;
        categoryData.expiredCount += 1;
      }
    });

    const totalCreditedMicros = totalGainedMicros + totalRefundedMicros;
    const periodNetChangeMicros = totalCreditedMicros - totalSpentMicros - totalExpiredMicros;
    const monthlyList = Array.from(monthlyMap.keys()).sort().map(month => {
      const data = monthlyMap.get(month);
      return {
        month,
        gain: microsToCoins(data.gainMicros),
        refunded: microsToCoins(data.refundedMicros),
        spend: microsToCoins(data.spendMicros),
        expired: microsToCoins(data.expiredMicros)
      };
    });

    const categoryList = Array.from(categoryMap.entries()).map(([category, data]) => {
      const totalMicros = data.gainMicros + data.refundedMicros + data.spendMicros + data.expiredMicros;
      return {
        category,
        gain: microsToCoins(data.gainMicros),
        refunded: microsToCoins(data.refundedMicros),
        spend: microsToCoins(data.spendMicros),
        expired: microsToCoins(data.expiredMicros),
        total: microsToCoins(totalMicros),
        gainCount: data.gainCount,
        refundCount: data.refundCount,
        spendCount: data.spendCount,
        expiredCount: data.expiredCount,
        count: data.gainCount + data.refundCount + data.spendCount + data.expiredCount
      };
    }).sort((a, b) => b.total - a.total);

    const sourceCategoryList = categoryList
      .filter(item => item.gain > 0)
      .map(item => ({ category: item.category, total: item.gain, count: item.gainCount }))
      .sort((a, b) => b.total - a.total);
    const usageCategoryList = categoryList
      .filter(item => item.spend + item.expired > 0)
      .map(item => ({
        category: item.category,
        total: item.spend + item.expired,
        spend: item.spend,
        expired: item.expired,
        count: item.spendCount + item.expiredCount
      }))
      .sort((a, b) => b.total - a.total);

    return {
      totalRecords: (Array.isArray(records) ? records.length : 0),
      validRecords: (Array.isArray(records) ? records.length : 0) - invalidRecords,
      invalidRecords,
      totalGainedMicros,
      totalRefundedMicros,
      totalCreditedMicros,
      totalSpentMicros,
      totalExpiredMicros,
      periodNetChangeMicros,
      totalGained: microsToCoins(totalGainedMicros),
      totalRefunded: microsToCoins(totalRefundedMicros),
      totalCredited: microsToCoins(totalCreditedMicros),
      totalSpent: microsToCoins(totalSpentMicros),
      totalExpired: microsToCoins(totalExpiredMicros),
      periodNetChange: microsToCoins(periodNetChangeMicros),
      netCoins: microsToCoins(periodNetChangeMicros),
      earliestTimestampMs,
      latestTimestampMs,
      monthlyList,
      categoryList,
      sourceCategoryList,
      usageCategoryList,
      classificationQuality: window.ShopeeCoinClassification?.computeQuality(records) || null
    };
  }

  function renderMonthlyBarChart(container, monthlyData) {
    if (!container) return;
    if (!Array.isArray(monthlyData) || monthlyData.length === 0) {
      container.textContent = '尚無足夠數據繪製趨勢圖';
      container.classList.add('chart-empty-msg');
      return;
    }
    container.classList.remove('chart-empty-msg');

    const displayData = monthlyData.slice(-12);
    const width = 600;
    const height = 260;
    const padding = { top: 30, right: 20, bottom: 40, left: 50 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const maxValue = Math.max(1, ...displayData.flatMap(item => [item.gain, item.refunded, item.spend, item.expired]));
    const scaleMax = Math.ceil(maxValue * 1.15);
    const groupWidth = chartWidth / displayData.length;
    const barWidth = Math.min(14, groupWidth * 0.2);

    let svg = `<svg viewBox="0 0 ${width} ${height}" class="chart-svg" xmlns="http://www.w3.org/2000/svg">`;
    for (let index = 0; index <= 4; index += 1) {
      const yValue = (scaleMax / 4) * index;
      const yPosition = padding.top + chartHeight - (index / 4) * chartHeight;
      svg += `<line x1="${padding.left}" y1="${yPosition}" x2="${width - padding.right}" y2="${yPosition}" stroke="#e0e0e0" stroke-dasharray="3,3" stroke-width="1"/>`;
      svg += `<text x="${padding.left - 8}" y="${yPosition + 4}" font-size="10" fill="#888" text-anchor="end">${Math.round(yValue)}</text>`;
    }

    displayData.forEach((item, index) => {
      const groupX = padding.left + index * groupWidth + groupWidth / 2;
      const values = [
        { value: item.gain, color: '#ee4d2d', label: '實際獲得', x: groupX - barWidth * 2 - 3 },
        { value: item.refunded, color: '#7e57c2', label: '退款/沖正', x: groupX - barWidth - 1 },
        { value: item.spend, color: '#26a69a', label: '折抵', x: groupX + 1 },
        { value: item.expired, color: '#f9a825', label: '過期', x: groupX + barWidth + 3 }
      ];
      values.forEach(bar => {
        if (!Number.isFinite(bar.value) || bar.value <= 0) return;
        const barHeight = (bar.value / scaleMax) * chartHeight;
        const y = padding.top + chartHeight - barHeight;
        svg += `<rect x="${bar.x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${bar.color}" rx="3" class="chart-bar"><title>${escapeXML(item.month)} ${bar.label}: ${bar.value.toFixed(2)} 蝦幣</title></rect>`;
      });
      const monthLabel = /^\d{4}-\d{2}$/.test(item.month) ? item.month.substring(2) : '其他';
      svg += `<text x="${groupX}" y="${height - 12}" font-size="11" fill="#666" text-anchor="middle">${escapeXML(monthLabel)}</text>`;
    });

    svg += `<g transform="translate(${width - 280}, 10)"><rect width="10" height="10" fill="#ee4d2d" rx="2"/><text x="14" y="9" font-size="10">實際獲得</text><rect x="72" width="10" height="10" fill="#7e57c2" rx="2"/><text x="86" y="9" font-size="10">退款/沖正</text><rect x="156" width="10" height="10" fill="#26a69a" rx="2"/><text x="170" y="9" font-size="10">折抵</text><rect x="212" width="10" height="10" fill="#f9a825" rx="2"/><text x="226" y="9" font-size="10">過期</text></g></svg>`;
    container.innerHTML = svg;
  }

  function renderCategoryDonutChart(container, categoryData, options = {}) {
    if (!container) return;
    const data = (Array.isArray(categoryData) ? categoryData : []).filter(item => Number.isFinite(item.total) && item.total > 0);
    if (data.length === 0) {
      container.textContent = options.emptyMessage || '尚無分類數據';
      container.classList.add('chart-empty-msg');
      return;
    }
    container.classList.remove('chart-empty-msg');

    const colors = ['#ee4d2d', '#26a69a', '#ffb300', '#7e57c2', '#42a5f5', '#8d6e63', '#78909c'];
    const totalValue = data.reduce((sum, item) => sum + item.total, 0);
    const width = 360;
    const height = 240;
    const cx = 110;
    const cy = 120;
    const outerRadius = 80;
    const innerRadius = 48;
    let svg = `<svg viewBox="0 0 ${width} ${height}" class="chart-svg" xmlns="http://www.w3.org/2000/svg">`;

    if (data.length === 1) {
      svg += `<circle cx="${cx}" cy="${cy}" r="${(outerRadius + innerRadius) / 2}" fill="none" stroke="${colors[0]}" stroke-width="${outerRadius - innerRadius}" class="chart-slice" data-category="${escapeXML(data[0].category)}" role="button" tabindex="0"><title>${escapeXML(data[0].category)}: ${data[0].total.toFixed(2)} 蝦幣 (100.0%)</title></circle>`;
    } else {
      let startAngle = 0;
      data.forEach((item, index) => {
        const sliceAngle = (item.total / totalValue) * 2 * Math.PI;
        const endAngle = startAngle + sliceAngle;
        const x1Outer = cx + outerRadius * Math.cos(startAngle);
        const y1Outer = cy + outerRadius * Math.sin(startAngle);
        const x2Outer = cx + outerRadius * Math.cos(endAngle);
        const y2Outer = cy + outerRadius * Math.sin(endAngle);
        const x1Inner = cx + innerRadius * Math.cos(endAngle);
        const y1Inner = cy + innerRadius * Math.sin(endAngle);
        const x2Inner = cx + innerRadius * Math.cos(startAngle);
        const y2Inner = cy + innerRadius * Math.sin(startAngle);
        const largeArc = sliceAngle > Math.PI ? 1 : 0;
        const path = `M ${x1Outer} ${y1Outer} A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${x2Outer} ${y2Outer} L ${x1Inner} ${y1Inner} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x2Inner} ${y2Inner} Z`;
        const percentage = ((item.total / totalValue) * 100).toFixed(1);
        svg += `<path d="${path}" fill="${colors[index % colors.length]}" stroke="#fff" stroke-width="1.5" class="chart-slice" data-category="${escapeXML(item.category)}" role="button" tabindex="0"><title>${escapeXML(item.category)}: ${item.total.toFixed(2)} 蝦幣 (${percentage}%)</title></path>`;
        startAngle = endAngle;
      });
    }

    svg += `<text x="${cx}" y="${cy - 4}" font-size="12" fill="#888" text-anchor="middle">${escapeXML(options.centerLabel || '總活動量')}</text><text x="${cx}" y="${cy + 16}" font-size="14" font-weight="bold" fill="#333" text-anchor="middle">${totalValue.toFixed(2)}</text>`;
    data.slice(0, 6).forEach((item, index) => {
      const percentage = ((item.total / totalValue) * 100).toFixed(1);
      svg += `<g transform="translate(210, ${30 + index * 28})" class="chart-legend-item" data-category="${escapeXML(item.category)}" role="button" tabindex="0"><rect width="10" height="10" fill="${colors[index % colors.length]}" rx="2"/><text x="16" y="9" font-size="11" fill="#333">${escapeXML(item.category)} (${percentage}%)</text></g>`;
    });
    svg += '</svg>';
    container.innerHTML = svg;
    const selectCategory = event => {
      const target = event.target.closest?.('[data-category]');
      if (!target || typeof options.onSelectCategory !== 'function') return;
      if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
      if (event.type === 'keydown') event.preventDefault();
      options.onSelectCategory(target.dataset.category);
    };
    container.onclick = selectCategory;
    container.onkeydown = selectCategory;
  }

  return { computeStats, renderMonthlyBarChart, renderCategoryDonutChart };
})();
