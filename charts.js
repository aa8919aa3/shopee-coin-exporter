/**
 * Shopee Coin Analytics & Charting Renderer
 * Computes statistics and renders interactive SVG/Canvas charts.
 */

window.ShopeeCoinAnalytics = (function () {
  'use strict';

  // Compute Aggregated Statistics
  function computeStats(records) {
    let totalGained = 0;
    let totalSpent = 0;
    let totalExpired = 0;

    const monthlyMap = new Map(); // YYYY-MM -> { gain: 0, spend: 0 }
    const categoryMap = new Map(); // Category -> { gain: 0, spend: 0, count: 0 }

    records.forEach(rec => {
      const month = rec.monthKey || '其他';
      if (!monthlyMap.has(month)) {
        monthlyMap.set(month, { gain: 0, spend: 0 });
      }
      const mData = monthlyMap.get(month);

      if (!categoryMap.has(rec.category)) {
        categoryMap.set(rec.category, { gain: 0, spend: 0, count: 0 });
      }
      const cData = categoryMap.get(rec.category);
      cData.count++;

      if (rec.type === 'gain') {
        totalGained += rec.amount;
        mData.gain += rec.amount;
        cData.gain += rec.amount;
      } else if (rec.type === 'spend') {
        totalSpent += rec.amount;
        mData.spend += rec.amount;
        cData.spend += rec.amount;
      } else if (rec.type === 'expired') {
        totalExpired += rec.amount;
      }
    });

    // Sort months chronologically
    const sortedMonths = Array.from(monthlyMap.keys()).sort();
    const monthlyList = sortedMonths.map(m => ({
      month: m,
      gain: monthlyMap.get(m).gain,
      spend: monthlyMap.get(m).spend
    }));

    // Categories sorted by total activity
    const categoryList = Array.from(categoryMap.entries()).map(([cat, data]) => ({
      category: cat,
      gain: data.gain,
      spend: data.spend,
      total: data.gain + data.spend,
      count: data.count
    })).sort((a, b) => b.total - a.total);

    return {
      totalRecords: records.length,
      totalGained,
      totalSpent,
      totalExpired,
      netCoins: totalGained - totalSpent - totalExpired,
      monthlyList,
      categoryList
    };
  }

  // Render SVG Monthly Trend Bar Chart
  function renderMonthlyBarChart(containerEl, monthlyData) {
    if (!monthlyData || monthlyData.length === 0) {
      containerEl.innerHTML = `<div class="chart-empty-msg">尚無足夠數據繪製趨勢圖</div>`;
      return;
    }

    // Limit to last 12 months for clarity
    const displayData = monthlyData.slice(-12);

    const width = 600;
    const height = 260;
    const padding = { top: 30, right: 20, bottom: 40, left: 50 };

    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    // Find max value
    let maxVal = 1;
    displayData.forEach(d => {
      maxVal = Math.max(maxVal, d.gain, d.spend);
    });
    maxVal = Math.ceil(maxVal * 1.15); // headroom

    const groupWidth = chartW / displayData.length;
    const barWidth = Math.min(22, groupWidth * 0.35);

    let svg = `<svg viewBox="0 0 ${width} ${height}" class="chart-svg" xmlns="http://www.w3.org/2000/svg">`;

    // Background Grid lines
    const gridYCount = 4;
    for (let i = 0; i <= gridYCount; i++) {
      const yVal = (maxVal / gridYCount) * i;
      const yPos = padding.top + chartH - (i / gridYCount) * chartH;
      svg += `<line x1="${padding.left}" y1="${yPos}" x2="${width - padding.right}" y2="${yPos}" stroke="#e0e0e0" stroke-dasharray="3,3" stroke-width="1"/>`;
      svg += `<text x="${padding.left - 8}" y="${yPos + 4}" font-size="10" fill="#888" text-anchor="end">${Math.round(yVal)}</text>`;
    }

    // Axes
    svg += `<line x1="${padding.left}" y1="${padding.top + chartH}" x2="${width - padding.right}" y2="${padding.top + chartH}" stroke="#ccc" stroke-width="1.5"/>`;

    // Bars
    displayData.forEach((d, idx) => {
      const groupX = padding.left + idx * groupWidth + groupWidth / 2;
      
      const gainH = (d.gain / maxVal) * chartH;
      const gainY = padding.top + chartH - gainH;
      const gainX = groupX - barWidth - 2;

      const spendH = (d.spend / maxVal) * chartH;
      const spendY = padding.top + chartH - spendH;
      const spendX = groupX + 2;

      // Gain Bar (Orange/Red Shopee theme)
      if (d.gain > 0) {
        svg += `<rect x="${gainX}" y="${gainY}" width="${barWidth}" height="${gainH}" fill="#ee4d2d" rx="3" class="chart-bar">
                  <title>${d.month} 獲得: +${d.gain.toFixed(1)} 蝦幣</title>
                </rect>`;
      }

      // Spend Bar (Teal/Blue)
      if (d.spend > 0) {
        svg += `<rect x="${spendX}" y="${spendY}" width="${barWidth}" height="${spendH}" fill="#26a69a" rx="3" class="chart-bar">
                  <title>${d.month} 折抵: -${d.spend.toFixed(1)} 蝦幣</title>
                </rect>`;
      }

      // Month Label
      const shortMonth = d.month.substring(2); // YY-MM
      svg += `<text x="${groupX}" y="${height - 12}" font-size="11" fill="#666" text-anchor="middle">${shortMonth}</text>`;
    });

    // Legend
    svg += `<g transform="translate(${width - 160}, 10)">
              <rect x="0" y="0" width="12" height="12" fill="#ee4d2d" rx="2"/>
              <text x="18" y="10" font-size="11" fill="#444">獲得 (+)</text>
              <rect x="75" y="0" width="12" height="12" fill="#26a69a" rx="2"/>
              <text x="93" y="10" font-size="11" fill="#444">折抵 (-)</text>
            </g>`;

    svg += `</svg>`;
    containerEl.innerHTML = svg;
  }

  // Render SVG Category Donut Chart
  function renderCategoryDonutChart(containerEl, categoryData) {
    if (!categoryData || categoryData.length === 0) {
      containerEl.innerHTML = `<div class="chart-empty-msg">尚無分類數據</div>`;
      return;
    }

    const colors = ['#ee4d2d', '#26a69a', '#ffb300', '#7e57c2', '#42a5f5', '#8d6e63', '#78909c'];
    
    let totalValue = 0;
    categoryData.forEach(c => totalValue += c.total);

    if (totalValue === 0) {
      containerEl.innerHTML = `<div class="chart-empty-msg">數據值皆為 0</div>`;
      return;
    }

    const width = 360;
    const height = 240;
    const cx = 110;
    const cy = 120;
    const outerR = 80;
    const innerR = 48;

    let svg = `<svg viewBox="0 0 ${width} ${height}" class="chart-svg" xmlns="http://www.w3.org/2000/svg">`;

    let startAngle = 0;

    categoryData.forEach((c, idx) => {
      const sliceAngle = (c.total / totalValue) * 2 * Math.PI;
      const endAngle = startAngle + sliceAngle;
      const color = colors[idx % colors.length];

      const x1_out = cx + outerR * Math.cos(startAngle);
      const y1_out = cy + outerR * Math.sin(startAngle);
      const x2_out = cx + outerR * Math.cos(endAngle);
      const y2_out = cy + outerR * Math.sin(endAngle);

      const x1_in = cx + innerR * Math.cos(endAngle);
      const y1_in = cy + innerR * Math.sin(endAngle);
      const x2_in = cx + innerR * Math.cos(startAngle);
      const y2_in = cy + innerR * Math.sin(startAngle);

      const largeArc = sliceAngle > Math.PI ? 1 : 0;

      const pathData = [
        `M ${x1_out} ${y1_out}`,
        `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2_out} ${y2_out}`,
        `L ${x1_in} ${y1_in}`,
        `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x2_in} ${y2_in}`,
        `Z`
      ].join(' ');

      const pct = ((c.total / totalValue) * 100).toFixed(1);

      svg += `<path d="${pathData}" fill="${color}" stroke="#fff" stroke-width="1.5" class="chart-slice">
                <title>${c.category}: ${c.total.toFixed(1)} 蝦幣 (${pct}%)</title>
              </path>`;

      startAngle = endAngle;
    });

    // Donut Center Text
    svg += `<text x="${cx}" y="${cy - 4}" font-size="12" fill="#888" text-anchor="middle">總計變動</text>`;
    svg += `<text x="${cx}" y="${cy + 16}" font-size="14" font-weight="bold" fill="#333" text-anchor="middle">${totalValue.toFixed(0)}</text>`;

    // Legend on the right
    let legendY = 30;
    categoryData.slice(0, 6).forEach((c, idx) => {
      const color = colors[idx % colors.length];
      const pct = ((c.total / totalValue) * 100).toFixed(1);
      svg += `<g transform="translate(210, ${legendY})">
                <rect x="0" y="0" width="10" height="10" fill="${color}" rx="2"/>
                <text x="16" y="9" font-size="11" fill="#333">${c.category} (${pct}%)</text>
              </g>`;
      legendY += 28;
    });

    svg += `</svg>`;
    containerEl.innerHTML = svg;
  }

  return {
    computeStats,
    renderMonthlyBarChart,
    renderCategoryDonutChart
  };
})();
