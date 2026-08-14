/**
 * Shopee Coin Collector User Interface Orchestrator
 */

window.ShopeeCoinUI = (function () {
  'use strict';

  let currentRecords = [];
  let filteredRecords = [];
  let currentPage = 1;
  let pageSize = 15;
  let summaryStats = null;
  let accountSummary = null;
  let collectionResult = null;
  let activeUIRunId = 0;
  let bannerTimer = null;
  let filterTimer = null;

  function formatCoins(value, decimals = 2) {
    return Number.isFinite(value) ? value.toFixed(decimals) : '--';
  }

  function formatRecordAmount(value) {
    if (!Number.isFinite(value)) return '--';
    return value.toFixed(5).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function setControlsCollecting(isCollecting) {
    const refetchButton = document.getElementById('btn-re-fetch');
    const exportCSVButton = document.getElementById('btn-export-csv');
    const exportTXTButton = document.getElementById('btn-export-txt');
    if (refetchButton) refetchButton.disabled = isCollecting;
    if (exportCSVButton) exportCSVButton.disabled = isCollecting || currentRecords.length === 0;
    if (exportTXTButton) exportTXTButton.disabled = isCollecting || currentRecords.length === 0;
  }

  function injectFloatButton() {
    const existing = document.getElementById('shopee-coin-float-btn');
    if (existing?.dataset?.shopeeCoinOwner === 'true') return;
    if (existing) existing.remove();

    const button = document.createElement('button');
    button.id = 'shopee-coin-float-btn';
    button.dataset.shopeeCoinOwner = 'true';
    button.title = '開啟蝦皮蝦幣歷史紀錄分析儀表板';
    const icon = document.createElement('span');
    icon.textContent = '🪙';
    const label = document.createElement('span');
    label.textContent = '蝦幣紀錄統計分析';
    button.append(icon, label);
    button.addEventListener('click', () => {
      openModal();
      if (currentRecords.length === 0 && !ShopeeCoinCollector.APIClient.isCollecting) startCollecting();
    });
    document.body.appendChild(button);
  }

  function createModal() {
    const existing = document.getElementById('shopee-coin-modal-backdrop');
    if (existing?.dataset?.shopeeCoinOwner === 'true') return;
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'shopee-coin-modal-backdrop';
    backdrop.dataset.shopeeCoinOwner = 'true';
    backdrop.innerHTML = `
      <div class="shopee-coin-dashboard" role="dialog" aria-modal="true" aria-label="蝦幣歷史紀錄分析儀表板">
        <div class="shopee-coin-header">
          <div class="shopee-coin-header-title">
            <h2><span>🪙</span> 蝦皮蝦幣歷史紀錄彙整與分析儀表板</h2>
            <p>官方餘額與交易期間統計分開呈現，支援 CSV / TXT 匯出</p>
          </div>
          <div class="shopee-coin-header-actions">
            <button id="btn-debug-mode" class="btn-outline" aria-pressed="false">🛠 Debug</button>
            <button id="btn-re-fetch" class="btn-primary">🔄 重新抓取資料</button>
            <button id="btn-export-csv" class="btn-success" disabled>📥 匯出 CSV</button>
            <button id="btn-export-txt" class="btn-outline" disabled>📄 匯出 TXT 報表</button>
            <button id="btn-close-modal" class="btn-close" title="關閉" aria-label="關閉">✕</button>
          </div>
        </div>
        <div class="shopee-coin-body">
          <div id="status-banner" class="shopee-coin-progress-banner" style="display:none;">
            <span id="status-text">準備抓取蝦幣紀錄…</span>
            <button id="btn-stop-fetch" class="btn-outline">停止抓取</button>
          </div>
          <section id="debug-panel" class="shopee-coin-debug-panel" hidden>
            <div class="debug-panel-title"><span>🛠 API 與性能診斷</span><span id="debug-state-label">Debug 已開啟</span></div>
            <pre id="debug-output">等待抓取資料…</pre>
          </section>
          <div class="shopee-coin-stats-grid">
            <div class="stat-card stat-card-primary"><span class="stat-card-title">目前可用蝦幣（官方餘額）</span><span class="stat-card-value net" id="stat-available-coins">--</span></div>
            <div class="stat-card"><span class="stat-card-title" id="stat-next-expiry-label">最近到期蝦幣</span><span class="stat-card-value spend" id="stat-next-expiry">--</span></div>
            <div class="stat-card"><span class="stat-card-title">期間獲得</span><span class="stat-card-value gain" id="stat-total-gained">+0.00</span></div>
            <div class="stat-card"><span class="stat-card-title">期間折抵／使用</span><span class="stat-card-value spend" id="stat-total-spent">-0.00</span></div>
            <div class="stat-card"><span class="stat-card-title">期間過期</span><span class="stat-card-value spend" id="stat-total-expired">-0.00</span></div>
            <div class="stat-card"><span class="stat-card-title">期間淨變動</span><span class="stat-card-value net" id="stat-net-coins">0.00</span></div>
            <div class="stat-card"><span class="stat-card-title">已分析紀錄數</span><span class="stat-card-value" id="stat-total-count">0 筆</span></div>
          </div>
          <p class="shopee-coin-scope-note" id="history-scope-note">交易期間淨變動不代表目前可用餘額。</p>
          <div class="shopee-coin-charts-grid">
            <div class="chart-card chart-card-wide"><div class="chart-card-title">📊 近期月份獲得、折抵與過期趨勢</div><div class="chart-container" id="monthly-bar-chart-container"></div></div>
            <div class="chart-card"><div class="chart-card-title">🍩 蝦幣來源分類佔比</div><div class="chart-container" id="source-category-donut-chart-container"></div></div>
            <div class="chart-card"><div class="chart-card-title">🍩 蝦幣使用分類佔比</div><div class="chart-container" id="usage-category-donut-chart-container"></div></div>
          </div>
          <div class="shopee-coin-filter-bar">
            <div class="filter-group">
              <input type="text" id="filter-keyword" class="filter-input" placeholder="🔍 搜尋說明／訂單編號…" style="width:220px;">
              <select id="filter-type" class="filter-select"><option value="all">所有變動類型</option><option value="gain">僅看「獲得」</option><option value="spend">僅看「折抵／使用」</option><option value="expired">僅看「過期」</option></select>
              <select id="filter-category" class="filter-select"><option value="all">所有活動分類</option></select>
            </div>
            <div class="filter-group"><span>每頁顯示：</span><select id="filter-pagesize" class="filter-select"><option value="15" selected>15 筆</option><option value="30">30 筆</option><option value="50">50 筆</option><option value="100">100 筆</option></select></div>
          </div>
          <div class="shopee-coin-table-card">
            <div class="table-wrapper"><table class="coin-table"><thead><tr><th>交易時間</th><th>項目說明</th><th>分類</th><th>類型</th><th>變動數量</th><th>到期日期</th><th>訂單編號</th></tr></thead><tbody id="coin-table-body"></tbody></table></div>
            <div class="table-pagination"><span id="pagination-info">顯示 0 - 0 筆，共 0 筆</span><div><button id="btn-prev-page" class="btn-outline">‹ 上一頁</button><span id="page-num-display">1 / 1</span><button id="btn-next-page" class="btn-outline">下一頁 ›</button></div></div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(backdrop);

    const categoryFilter = document.getElementById('filter-category');
    (ShopeeCoinCollector.ACTIVITY_CATEGORIES || []).forEach(category => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      categoryFilter.appendChild(option);
    });

    document.getElementById('btn-close-modal').addEventListener('click', closeModal);
    backdrop.addEventListener('click', event => { if (event.target === backdrop) closeModal(); });
    document.getElementById('btn-debug-mode').addEventListener('click', () => {
      ShopeeCoinCollector.setDebugEnabled(!ShopeeCoinCollector.isDebugEnabled());
      updateDebugPanel(collectionResult);
    });
    document.getElementById('btn-re-fetch').addEventListener('click', startCollecting);
    document.getElementById('btn-stop-fetch').addEventListener('click', stopCollecting);
    document.getElementById('btn-export-csv').addEventListener('click', () => {
      const snapshot = filteredRecords.slice();
      ShopeeCoinExporter.exportCSV(snapshot, ShopeeCoinAnalytics.computeStats(snapshot), accountSummary, collectionResult);
    });
    document.getElementById('btn-export-txt').addEventListener('click', () => {
      const snapshot = filteredRecords.slice();
      ShopeeCoinExporter.exportTXT(snapshot, ShopeeCoinAnalytics.computeStats(snapshot), accountSummary, collectionResult);
    });

    document.getElementById('filter-keyword').addEventListener('input', () => {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(() => applyFilters(true), 200);
    });
    document.getElementById('filter-type').addEventListener('change', () => applyFilters(true));
    document.getElementById('filter-category').addEventListener('change', () => applyFilters(true));
    document.getElementById('filter-pagesize').addEventListener('change', event => {
      pageSize = Number(event.target.value) || 15;
      currentPage = 1;
      renderTable();
    });
    document.getElementById('btn-prev-page').addEventListener('click', () => { if (currentPage > 1) { currentPage -= 1; renderTable(); } });
    document.getElementById('btn-next-page').addEventListener('click', () => {
      const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
      if (currentPage < totalPages) { currentPage += 1; renderTable(); }
    });
    updateDebugPanel(collectionResult);
    renderTable();
  }

  function updateDebugPanel(result = collectionResult) {
    const enabled = ShopeeCoinCollector.isDebugEnabled();
    const button = document.getElementById('btn-debug-mode');
    const panel = document.getElementById('debug-panel');
    const output = document.getElementById('debug-output');
    if (button) {
      button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
      button.textContent = enabled ? '🛠 Debug ON' : '🛠 Debug';
      button.classList.toggle('debug-active', enabled);
    }
    if (!panel || !output) return;
    panel.hidden = !enabled;
    if (!enabled) return;

    const diagnostics = result?.diagnostics || ShopeeCoinCollector.getDiagnostics();
    const performance = result?.performance;
    const lines = [];
    if (performance) {
      lines.push(`總耗時：${(performance.totalDurationMs / 1000).toFixed(2)} 秒`);
      lines.push(`摘要 API：${performance.summaryDurationMs?.toFixed(2) ?? '--'} ms`);
      lines.push(`交易頁：${performance.pagesFetched} 頁；平均 ${performance.averagePageDurationMs?.toFixed(2) ?? '--'} ms；最慢 ${performance.slowestPageDurationMs?.toFixed(2) ?? '--'} ms`);
      lines.push(`分頁節流等待：${performance.pageDelayTotalMs} ms；吞吐量：${performance.recordsPerSecond ?? '--'} 筆/秒`);
      lines.push(`結果：${result.status}；紀錄 ${result.records?.length || 0} 筆；失敗 offset：${result.failedOffset ?? '--'}`);
    } else {
      lines.push('尚未完成一輪抓取；下方顯示最近請求事件。');
    }
    const recentEvents = (diagnostics?.events || []).slice(-12);
    if (recentEvents.length > 0) {
      lines.push('', '最近事件：');
      recentEvents.forEach(event => {
        const details = [
          event.endpoint,
          event.offset !== null && event.offset !== undefined ? `offset=${event.offset}` : null,
          event.status ? `HTTP ${event.status}` : null,
          event.code || null,
          event.durationMs !== undefined ? `${event.durationMs}ms` : null,
          event.backoffMs !== undefined ? `backoff=${event.backoffMs}ms` : null
        ].filter(Boolean).join(' · ');
        lines.push(`${event.elapsedMs?.toFixed?.(0) ?? event.elapsedMs}ms  ${event.event}${details ? `  ${details}` : ''}`);
      });
    }
    output.textContent = lines.join('\n');
  }

  function openModal() {
    createModal();
    document.getElementById('shopee-coin-modal-backdrop')?.classList.add('active');
  }

  function closeModal() {
    document.getElementById('shopee-coin-modal-backdrop')?.classList.remove('active');
  }

  function showStatus(message, kind = 'info', autoHideMs = 0, runId = activeUIRunId) {
    clearTimeout(bannerTimer);
    const banner = document.getElementById('status-banner');
    if (!banner) return;
    banner.dataset.kind = kind;
    banner.style.display = 'flex';
    setText('status-text', message);
    const stopButton = document.getElementById('btn-stop-fetch');
    if (stopButton) stopButton.style.display = kind === 'loading' ? '' : 'none';
    if (autoHideMs > 0) {
      bannerTimer = setTimeout(() => {
        if (runId === activeUIRunId) banner.style.display = 'none';
      }, autoHideMs);
    }
  }

  async function startCollecting() {
    createModal();
    openModal();
    const uiRunId = ++activeUIRunId;
    clearTimeout(bannerTimer);
    setControlsCollecting(true);
    showStatus('正在讀取官方餘額與蝦幣交易紀錄…', 'loading', 0, uiRunId);

    try {
      const result = await ShopeeCoinCollector.APIClient.fetchViaAPI(progress => {
        if (uiRunId !== activeUIRunId) return;
        setText('status-text', `正在抓取蝦幣紀錄… 已取得 ${progress.fetchedCount} 筆（${progress.pagesFetched} 頁；上一頁 ${progress.lastPageDurationMs?.toFixed?.(0) ?? '--'} ms）`);
        updateDebugPanel();
      });
      if (uiRunId !== activeUIRunId) return result;

      collectionResult = result;
      accountSummary = result.accountSummary;
      currentRecords = result.records;
      updateDebugPanel(result);

      if (result.status === 'failed') {
        const fallback = ShopeeCoinCollector.APIClient.scrapeFromDOM();
        if (fallback.records.length > 0) {
          currentRecords = fallback.records;
          collectionResult = { ...result, status: 'partial', complete: false, rejectedRecords: fallback.rejectedRecords, source: 'dom' };
          showStatus(`API 失敗，僅顯示目前頁面可解析的 ${currentRecords.length} 筆部分資料。`, 'warning');
        } else {
          showStatus(`抓取失敗：${result.error?.message || '無法取得資料'}`, 'error');
        }
      } else if (result.status === 'partial') {
        showStatus(`僅取得部分資料：${result.records.length} 筆；${result.error?.message || `略過 ${result.rejectedRecords} 筆異常資料`}`, 'warning');
      } else if (result.status === 'stopped') {
        showStatus(`已停止抓取，目前保留 ${result.records.length} 筆部分資料。`, 'warning');
      } else {
        const summarySuffix = result.summaryError ? '；官方餘額暫時無法取得' : '';
        showStatus(`抓取完成，共 ${result.records.length} 筆${summarySuffix}。`, result.summaryError ? 'warning' : 'success', 5000, uiRunId);
      }

      updateData(currentRecords, accountSummary, collectionResult);
      return collectionResult;
    } catch (error) {
      if (uiRunId === activeUIRunId) showStatus(`抓取失敗：${error.message || '未知錯誤'}`, 'error');
      return { status: 'failed', complete: false, records: [], error: { code: 'UI', message: error.message || '未知錯誤' } };
    } finally {
      if (uiRunId === activeUIRunId) setControlsCollecting(false);
    }
  }

  function stopCollecting() {
    ShopeeCoinCollector.APIClient.stop();
    showStatus('正在停止抓取…', 'loading');
  }

  function updateData(records, latestAccountSummary, latestCollectionResult) {
    currentRecords = Array.isArray(records) ? records : [];
    accountSummary = latestAccountSummary || null;
    collectionResult = latestCollectionResult || collectionResult;
    summaryStats = ShopeeCoinAnalytics.computeStats(currentRecords);

    setText('stat-available-coins', accountSummary ? formatCoins(accountSummary.availableAmount) : '--');
    const nextExpiry = accountSummary?.nextExpiry;
    setText('stat-next-expiry', nextExpiry ? formatCoins(nextExpiry.amount) : '--');
    setText('stat-next-expiry-label', nextExpiry ? `${nextExpiry.date} 後到期` : '最近到期蝦幣');
    setText('stat-total-gained', `+${formatCoins(summaryStats.totalGained)}`);
    setText('stat-total-spent', `-${formatCoins(summaryStats.totalSpent)}`);
    setText('stat-total-expired', `-${formatCoins(summaryStats.totalExpired)}`);
    setText('stat-net-coins', `${summaryStats.periodNetChange >= 0 ? '+' : ''}${formatCoins(summaryStats.periodNetChange)}`);
    setText('stat-total-count', `${summaryStats.validRecords} 筆`);

    const scopeNote = document.getElementById('history-scope-note');
    if (scopeNote) {
      const completeLabel = collectionResult?.complete ? '完整取得 API 可提供的期間' : '目前為部分資料';
      if (summaryStats.earliestTimestampMs !== null && summaryStats.latestTimestampMs !== null) {
        const earliest = new Date(summaryStats.earliestTimestampMs).toLocaleDateString('zh-TW');
        const latest = new Date(summaryStats.latestTimestampMs).toLocaleDateString('zh-TW');
        let reconciliation = '';
        if (accountSummary && collectionResult?.complete) {
          const inferredOpening = accountSummary.availableAmount - summaryStats.periodNetChange;
          reconciliation = ` 官方餘額 ${formatCoins(accountSummary.availableAmount)} = 推估期初餘額 ${formatCoins(inferredOpening)} + 期間淨變動 ${summaryStats.periodNetChange >= 0 ? '+' : ''}${formatCoins(summaryStats.periodNetChange)}。`;
        }
        scopeNote.textContent = `${completeLabel}：${earliest} 至 ${latest}。期間淨變動不含期初既有餘額，因此不等於目前餘額。${reconciliation}`;
      } else {
        scopeNote.textContent = `${completeLabel}；沒有可用的交易日期範圍。`;
      }
    }

    ShopeeCoinAnalytics.renderMonthlyBarChart(document.getElementById('monthly-bar-chart-container'), summaryStats.monthlyList);
    ShopeeCoinAnalytics.renderCategoryDonutChart(
      document.getElementById('source-category-donut-chart-container'),
      summaryStats.sourceCategoryList,
      { centerLabel: '獲得總量', emptyMessage: '尚無蝦幣來源資料' }
    );
    ShopeeCoinAnalytics.renderCategoryDonutChart(
      document.getElementById('usage-category-donut-chart-container'),
      summaryStats.usageCategoryList,
      { centerLabel: '使用總量', emptyMessage: '尚無蝦幣使用資料' }
    );
    applyFilters(false);
    setControlsCollecting(ShopeeCoinCollector.APIClient.isCollecting);
  }

  function applyFilters(resetPage) {
    const rawKeyword = String(document.getElementById('filter-keyword')?.value || '').trim();
    const type = document.getElementById('filter-type')?.value || 'all';
    const category = document.getElementById('filter-category')?.value || 'all';
    filteredRecords = ShopeeCoinFilters.filterRecords(currentRecords, rawKeyword, type, category);
    if (resetPage) currentPage = 1;
    const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
    currentPage = Math.min(currentPage, totalPages);
    renderTable();
  }

  function appendCell(row, value, className = '') {
    const cell = document.createElement('td');
    if (className) cell.className = className;
    cell.textContent = String(value ?? '');
    row.appendChild(cell);
  }

  function renderTable() {
    const body = document.getElementById('coin-table-body');
    if (!body) return;
    body.replaceChildren();

    if (filteredRecords.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 7;
      cell.className = 'empty-table-message';
      cell.textContent = currentRecords.length === 0 ? '尚無蝦幣紀錄' : '沒有符合篩選條件的蝦幣紀錄';
      row.appendChild(cell);
      body.appendChild(row);
      setText('pagination-info', '顯示 0 - 0 筆，共 0 筆');
      setText('page-num-display', '1 / 1');
      return;
    }

    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, filteredRecords.length);
    const fragment = document.createDocumentFragment();

    filteredRecords.slice(startIndex, endIndex).forEach(record => {
      const row = document.createElement('tr');
      appendCell(row, record.dateStr);
      appendCell(row, record.title);
      appendCell(row, record.category);

      const typeCell = document.createElement('td');
      const badge = document.createElement('span');
      const typeMap = {
        gain: ['獲得', 'badge badge-gain'],
        spend: ['折抵／使用', 'badge badge-spend'],
        expired: ['過期', 'badge badge-expired']
      };
      const [label, badgeClass] = typeMap[record.type] || ['未知', 'badge'];
      badge.className = badgeClass;
      badge.textContent = label;
      typeCell.appendChild(badge);
      row.appendChild(typeCell);

      const amountCell = document.createElement('td');
      amountCell.className = record.displayAmount >= 0 ? 'coin-amount-gain' : 'coin-amount-spend';
      amountCell.textContent = `${record.displayAmount >= 0 ? '+' : ''}${formatRecordAmount(record.displayAmount)}`;
      row.appendChild(amountCell);
      appendCell(row, record.expiryDate);
      appendCell(row, record.orderSn);
      fragment.appendChild(row);
    });
    body.appendChild(fragment);

    const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
    setText('pagination-info', `顯示 ${startIndex + 1} - ${endIndex} 筆，共 ${filteredRecords.length} 筆`);
    setText('page-num-display', `${currentPage} / ${totalPages}`);
    const previous = document.getElementById('btn-prev-page');
    const next = document.getElementById('btn-next-page');
    if (previous) previous.disabled = currentPage <= 1;
    if (next) next.disabled = currentPage >= totalPages;
  }

  function destroy() {
    activeUIRunId += 1;
    ShopeeCoinCollector.APIClient.stop();
    clearTimeout(bannerTimer);
    clearTimeout(filterTimer);
    document.getElementById('shopee-coin-modal-backdrop')?.remove();
    document.getElementById('shopee-coin-float-btn')?.remove();
  }

  return { injectFloatButton, openModal, startCollecting, stopCollecting, destroy };
})();
