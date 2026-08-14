/**
 * Shopee Coin Collector User Interface (UI) Orchestrator
 * Injects floating trigger button, modal dashboard, controls, charts, and table.
 */

window.ShopeeCoinUI = (function () {
  'use strict';

  let currentRecords = [];
  let filteredRecords = [];
  let currentPage = 1;
  let pageSize = 15;
  let summaryStats = null;
  let accountSummary = null;

  // Inject Floating Launcher Button
  function injectFloatButton() {
    if (document.getElementById('shopee-coin-float-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'shopee-coin-float-btn';
    btn.innerHTML = `<span>🪙</span> <span>蝦幣紀錄統計分析</span>`;
    btn.title = '開啟蝦皮蝦幣歷史紀錄分析儀表板';
    
    btn.addEventListener('click', () => {
      openModal();
      if (currentRecords.length === 0) {
        startCollecting();
      }
    });

    document.body.appendChild(btn);
  }

  // Create Modal Structure
  function createModal() {
    if (document.getElementById('shopee-coin-modal-backdrop')) return;

    const backdrop = document.createElement('div');
    backdrop.id = 'shopee-coin-modal-backdrop';
    
    backdrop.innerHTML = `
      <div class="shopee-coin-dashboard">
        <!-- Header -->
        <div class="shopee-coin-header">
          <div class="shopee-coin-header-title">
            <h2><span>🪙</span> 蝦皮蝦幣歷史紀錄彙整與分析儀表板</h2>
            <p>自動搜集並整理蝦幣所有獲得與使用紀錄，支援 CSV / TXT 導出與圖表統計</p>
          </div>
          <div class="shopee-coin-header-actions">
            <button id="btn-re-fetch" class="btn-primary">🔄 重新抓取資料</button>
            <button id="btn-export-csv" class="btn-success">📥 匯出 CSV</button>
            <button id="btn-export-txt" class="btn-outline">📄 匯出 TXT 報表</button>
            <button id="btn-close-modal" class="btn-close" title="關閉">✕</button>
          </div>
        </div>

        <!-- Body -->
        <div class="shopee-coin-body">
          <!-- Status Banner -->
          <div id="status-banner" class="shopee-coin-progress-banner" style="display: none;">
            <span id="status-text">正在自動抓取蝦幣紀錄中...</span>
            <button id="btn-stop-fetch" class="btn-outline" style="padding: 4px 10px; font-size: 12px;">停止抓取</button>
          </div>

          <!-- Summary Metric Cards -->
          <div class="shopee-coin-stats-grid">
            <div class="stat-card stat-card-primary">
              <span class="stat-card-title">目前可用蝦幣（官方餘額）</span>
              <span class="stat-card-value net" id="stat-available-coins">--</span>
            </div>
            <div class="stat-card">
              <span class="stat-card-title" id="stat-next-expiry-label">最近到期蝦幣</span>
              <span class="stat-card-value spend" id="stat-next-expiry">--</span>
            </div>
            <div class="stat-card">
              <span class="stat-card-title">最近一年獲得</span>
              <span class="stat-card-value gain" id="stat-total-gained">+0.00</span>
            </div>
            <div class="stat-card">
              <span class="stat-card-title">最近一年折抵/使用</span>
              <span class="stat-card-value spend" id="stat-total-spent">-0.00</span>
            </div>
            <div class="stat-card">
              <span class="stat-card-title">最近一年淨變動</span>
              <span class="stat-card-value net" id="stat-net-coins">0.00</span>
            </div>
            <div class="stat-card">
              <span class="stat-card-title">已分析紀錄數</span>
              <span class="stat-card-value" id="stat-total-count">0 筆</span>
            </div>
          </div>
          <p class="shopee-coin-scope-note" id="history-scope-note">
            交易歷史淨變動僅依 API 可取得期間計算，不代表目前可用餘額。
          </p>

          <!-- Charts Grid -->
          <div class="shopee-coin-charts-grid">
            <div class="chart-card">
              <div class="chart-card-title">📊 近期月份獲得與折抵趨勢 (Coins)</div>
              <div class="chart-container" id="monthly-bar-chart-container"></div>
            </div>
            <div class="chart-card">
              <div class="chart-card-title">🍩 蝦幣來源與消費分類佔比</div>
              <div class="chart-container" id="category-donut-chart-container"></div>
            </div>
          </div>

          <!-- Filter Control Bar -->
          <div class="shopee-coin-filter-bar">
            <div class="filter-group">
              <input type="text" id="filter-keyword" class="filter-input" placeholder="🔍 搜尋說明/訂單編號..." style="width: 220px;">
              
              <select id="filter-type" class="filter-select">
                <option value="all">所有變動類型</option>
                <option value="gain">僅看「獲得」</option>
                <option value="spend">僅看「折抵/使用」</option>
                <option value="expired">僅看「過期」</option>
              </select>

              <select id="filter-category" class="filter-select">
                <option value="all">所有活動分類</option>
                <option value="每日簽到">每日簽到</option>
                <option value="購物/訂單">購物/訂單</option>
                <option value="消費折抵">消費折抵</option>
                <option value="蝦皮遊戲">蝦皮遊戲</option>
                <option value="行銷活動/任務">行銷活動/任務</option>
                <option value="其他活動">其他活動</option>
              </select>
            </div>

            <div class="filter-group">
              <span style="font-size: 13px; color: #666;">每頁顯示：</span>
              <select id="filter-pagesize" class="filter-select">
                <option value="15" selected>15 筆</option>
                <option value="30">30 筆</option>
                <option value="50">50 筆</option>
                <option value="100">100 筆</option>
              </select>
            </div>
          </div>

          <!-- Records Table -->
          <div class="shopee-coin-table-card">
            <div class="table-wrapper">
              <table class="coin-table">
                <thead>
                  <tr>
                    <th style="width: 170px;">交易時間</th>
                    <th>項目說明</th>
                    <th style="width: 120px;">分類</th>
                    <th style="width: 100px;">類型</th>
                    <th style="width: 110px;">變動數量</th>
                    <th style="width: 120px;">到期日期</th>
                    <th style="width: 160px;">訂單編號</th>
                  </tr>
                </thead>
                <tbody id="coin-table-body">
                  <tr>
                    <td colspan="7" style="text-align: center; color: #888; padding: 30px;">
                      點擊「重新抓取資料」即可載入並分析您的所有蝦幣歷史紀錄
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="table-pagination">
              <span id="pagination-info">顯示 0 - 0 筆，共 0 筆</span>
              <div style="display: flex; gap: 8px;">
                <button id="btn-prev-page" class="btn-outline" style="padding: 4px 10px; font-size: 12px;">‹ 上一頁</button>
                <span id="page-num-display" style="align-self: center; font-weight: 600;">1 / 1</span>
                <button id="btn-next-page" class="btn-outline" style="padding: 4px 10px; font-size: 12px;">下一頁 ›</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    // Event Bindings
    document.getElementById('btn-close-modal').addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });

    document.getElementById('btn-re-fetch').addEventListener('click', startCollecting);
    document.getElementById('btn-stop-fetch').addEventListener('click', stopCollecting);

    document.getElementById('btn-export-csv').addEventListener('click', () => {
      ShopeeCoinExporter.exportCSV(filteredRecords, summaryStats, accountSummary);
    });

    document.getElementById('btn-export-txt').addEventListener('click', () => {
      ShopeeCoinExporter.exportTXT(filteredRecords, summaryStats, accountSummary);
    });

    // Filters
    document.getElementById('filter-keyword').addEventListener('input', applyFilters);
    document.getElementById('filter-type').addEventListener('change', applyFilters);
    document.getElementById('filter-category').addEventListener('change', applyFilters);
    document.getElementById('filter-pagesize').addEventListener('change', (e) => {
      pageSize = Number(e.target.value) || 15;
      currentPage = 1;
      renderTable();
    });

    // Pagination
    document.getElementById('btn-prev-page').addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        renderTable();
      }
    });

    document.getElementById('btn-next-page').addEventListener('click', () => {
      const maxPages = Math.ceil(filteredRecords.length / pageSize) || 1;
      if (currentPage < maxPages) {
        currentPage++;
        renderTable();
      }
    });
  }

  function openModal() {
    createModal();
    const backdrop = document.getElementById('shopee-coin-modal-backdrop');
    if (backdrop) backdrop.classList.add('active');
  }

  function closeModal() {
    const backdrop = document.getElementById('shopee-coin-modal-backdrop');
    if (backdrop) backdrop.classList.remove('active');
  }

  // Data Fetch Orchestrator
  async function startCollecting() {
    createModal();
    const banner = document.getElementById('status-banner');
    const statusText = document.getElementById('status-text');
    banner.style.display = 'flex';
    statusText.innerText = '正在自動抓取蝦幣紀錄中... (已讀取 0 筆)';

    accountSummary = null;
    ShopeeCoinCollector.APIClient.clear();

    const success = await ShopeeCoinCollector.APIClient.fetchViaAPI((progress) => {
      statusText.innerText = `正在抓取蝦幣紀錄中... 已成功取得 ${progress.fetchedCount} 筆`;
      updateData(progress.records, progress.accountSummary);
    });

    if (!success) {
      statusText.innerText = 'API 直接抓取受限，嘗試從 DOM 頁面掃描...';
      const domScrapedCount = ShopeeCoinCollector.APIClient.scrapeFromDOM();
      statusText.innerText = `DOM 掃描完成，已取得 ${domScrapedCount} 筆紀錄`;
    } else {
      statusText.innerText = `🎉 抓取完成！共收集 ${ShopeeCoinCollector.APIClient.getRecordsArray().length} 筆蝦幣紀錄`;
    }

    setTimeout(() => {
      banner.style.display = 'none';
    }, 4000);

    updateData(
      ShopeeCoinCollector.APIClient.getRecordsArray(),
      ShopeeCoinCollector.APIClient.getAccountSummary()
    );
  }

  function stopCollecting() {
    ShopeeCoinCollector.APIClient.stop();
    const banner = document.getElementById('status-banner');
    if (banner) banner.style.display = 'none';
  }

  // Update Data and Re-render Dashboard
  function updateData(records, latestAccountSummary = accountSummary) {
    currentRecords = records || [];
    accountSummary = latestAccountSummary || accountSummary;
    summaryStats = ShopeeCoinAnalytics.computeStats(currentRecords);

    // Update Metric Cards
    document.getElementById('stat-available-coins').innerText = accountSummary
      ? accountSummary.availableAmount.toFixed(2)
      : '--';

    const nextExpiry = accountSummary?.nextExpiry;
    document.getElementById('stat-next-expiry').innerText = nextExpiry
      ? nextExpiry.amount.toFixed(2)
      : '--';
    document.getElementById('stat-next-expiry-label').innerText = nextExpiry
      ? `${nextExpiry.date} 後到期`
      : '最近到期蝦幣';

    document.getElementById('stat-total-gained').innerText = `+${summaryStats.totalGained.toFixed(2)}`;
    document.getElementById('stat-total-spent').innerText = `-${Math.abs(summaryStats.totalSpent).toFixed(2)}`;
    document.getElementById('stat-net-coins').innerText = `${summaryStats.netCoins >= 0 ? '+' : ''}${summaryStats.netCoins.toFixed(2)}`;
    document.getElementById('stat-total-count').innerText = `${summaryStats.totalRecords} 筆`;

    const historyNote = document.getElementById('history-scope-note');
    if (historyNote && currentRecords.length > 0) {
      const latestDate = currentRecords[0].dateStr.substring(0, 10);
      const earliestDate = currentRecords[currentRecords.length - 1].dateStr.substring(0, 10);
      historyNote.innerText = `交易 API 可取得範圍：${earliestDate} 至 ${latestDate}。最近一年淨變動不包含期初既有餘額，因此不等於目前可用蝦幣。`;
    }

    // Render Charts
    ShopeeCoinAnalytics.renderMonthlyBarChart(
      document.getElementById('monthly-bar-chart-container'),
      summaryStats.monthlyList
    );

    ShopeeCoinAnalytics.renderCategoryDonutChart(
      document.getElementById('category-donut-chart-container'),
      summaryStats.categoryList
    );

    applyFilters();
  }

  // Filter Table Data
  function applyFilters() {
    const keyword = (document.getElementById('filter-keyword').value || '').toLowerCase().trim();
    const typeFilter = document.getElementById('filter-type').value;
    const catFilter = document.getElementById('filter-category').value;

    filteredRecords = currentRecords.filter(rec => {
      if (typeFilter !== 'all' && rec.type !== typeFilter) return false;
      if (catFilter !== 'all' && rec.category !== catFilter) return false;
      if (keyword) {
        const matchTitle = rec.title.toLowerCase().includes(keyword);
        const matchSn = rec.orderSn.toLowerCase().includes(keyword);
        const matchCat = rec.category.toLowerCase().includes(keyword);
        if (!matchTitle && !matchSn && !matchCat) return false;
      }
      return true;
    });

    currentPage = 1;
    renderTable();
  }

  // Render Table Page
  function renderTable() {
    const tbody = document.getElementById('coin-table-body');
    if (!tbody) return;

    if (filteredRecords.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; color: #888; padding: 30px;">
            沒有符合篩選條件的蝦幣紀錄
          </td>
        </tr>
      `;
      document.getElementById('pagination-info').innerText = '顯示 0 - 0 筆，共 0 筆';
      document.getElementById('page-num-display').innerText = '1 / 1';
      return;
    }

    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, filteredRecords.length);
    const pageData = filteredRecords.slice(startIdx, endIdx);

    let html = '';
    pageData.forEach(rec => {
      let badgeClass = 'badge-gain';
      let badgeText = '獲得';
      if (rec.type === 'spend') {
        badgeClass = 'badge-spend';
        badgeText = '折抵/使用';
      } else if (rec.type === 'expired') {
        badgeClass = 'badge-expired';
        badgeText = '過期';
      }

      const amtSign = rec.displayAmount > 0 ? `+${rec.displayAmount}` : `${rec.displayAmount}`;
      const amtStyle = rec.displayAmount > 0 ? 'color: #2e7d32; font-weight: bold;' : 'color: #c62828; font-weight: bold;';

      html += `
        <tr>
          <td>${rec.dateStr}</td>
          <td><strong>${rec.title}</strong></td>
          <td>${rec.category}</td>
          <td><span class="badge ${badgeClass}">${badgeText}</span></td>
          <td style="${amtStyle}">${amtSign}</td>
          <td>${rec.expiryDate}</td>
          <td>${rec.orderSn !== '-' ? `<code>${rec.orderSn}</code>` : '-'}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html;

    const totalPages = Math.ceil(filteredRecords.length / pageSize) || 1;
    document.getElementById('pagination-info').innerText = `顯示 ${startIdx + 1} - ${endIdx} 筆，共 ${filteredRecords.length} 筆`;
    document.getElementById('page-num-display').innerText = `${currentPage} / ${totalPages}`;
  }

  return {
    injectFloatButton,
    openModal,
    startCollecting
  };
})();
