/**
 * Shopee Coin Data Collector API Engine
 * Handles API requests, DOM fallback parsing, and data normalization.
 * Uses Shopee's current coin transaction endpoint.
 */

window.ShopeeCoinCollector = (function () {
  'use strict';

  // Standardized Coin Record Data Structure
  class CoinRecord {
    constructor(data) {
      this.id = data.id || `coin_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      this.timestamp = data.timestamp || new Date().toISOString();
      this.dateStr = data.dateStr || this.formatDate(new Date(this.timestamp));
      this.monthKey = this.dateStr.substring(0, 7); // YYYY-MM
      this.title = data.title || '蝦幣變動';
      this.type = data.type || 'gain'; // 'gain' | 'spend' | 'expired'
      this.amount = Number(data.amount) || 0;
      this.displayAmount = data.displayAmount ?? (this.type === 'gain' ? Math.abs(this.amount) : -Math.abs(this.amount));
      this.expiryDate = data.expiryDate || '-';
      this.orderSn = data.orderSn || '-';
      this.category = data.category || this.inferCategory(this.title);
      this.raw = data.raw || null;
    }

    formatDate(dateObj) {
      const y = dateObj.getFullYear();
      const m = String(dateObj.getMonth() + 1).padStart(2, '0');
      const d = String(dateObj.getDate()).padStart(2, '0');
      const hh = String(dateObj.getHours()).padStart(2, '0');
      const mm = String(dateObj.getMinutes()).padStart(2, '0');
      const ss = String(dateObj.getSeconds()).padStart(2, '0');
      return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
    }

    inferCategory(title) {
      if (!title) return '其他';
      if (title.includes('簽到') || title.includes('報到')) return '每日簽到';
      if (title.includes('訂單') || title.includes('購物') || title.includes('完成訂單')) return '購物/訂單';
      if (title.includes('折抵') || title.includes('使用') || title.includes('付款')) return '消費折抵';
      if (title.includes('遊戲') || title.includes('蝦蝦果園') || title.includes('消消樂') || title.includes('寶箱')) return '蝦皮遊戲';
      if (title.includes('任務') || title.includes('活動') || title.includes('挑戰')) return '行銷活動/任務';
      if (title.includes('過期') || title.includes('失效')) return '蝦幣過期';
      if (title.includes('退款') || title.includes('退貨') || title.includes('補償')) return '退款/補償';
      if (title.includes('直播')) return '蝦皮直播';
      return '其他活動';
    }
  }

  // API Client
  class APIClient {
    constructor() {
      this.isCollecting = false;
      this.shouldStop = false;
      this.collectedRecords = new Map(); // id -> CoinRecord
      this.accountSummary = null;
    }

    stop() {
      this.shouldStop = true;
      this.isCollecting = false;
    }

    // Fetch the authoritative current balance and expiry buckets.
    async fetchAccountSummary() {
      const endpoint = '/api/v4/coin/get_user_coins_summary';

      try {
        const response = await fetch(endpoint, { credentials: 'include' });
        if (!response.ok) {
          console.warn(`[ShopeeCoinCollector] Summary API response HTTP ${response.status}`);
          return null;
        }

        const payload = await response.json();
        if (payload.error && payload.error !== 0) {
          console.warn('[ShopeeCoinCollector] Summary API error:', payload.error_msg || payload.error);
          return null;
        }

        const coins = payload.coins ?? payload.data?.coin_info ?? payload.data?.coins ?? null;
        if (!coins) {
          console.warn('[ShopeeCoinCollector] Summary API returned no coin summary.');
          return null;
        }

        const expiryItems = Array.isArray(coins.expiry_info?.summary)
          ? coins.expiry_info.summary.map(item => ({
              date: `${item.year}-${String(item.month).padStart(2, '0')}-${String(item.day).padStart(2, '0')}`,
              amount: Number(item.coin_amount ?? item.fe_coin_amount / 100000 ?? 0) || 0
            })).filter(item => item.amount > 0)
          : [];

        expiryItems.sort((a, b) => a.date.localeCompare(b.date));

        this.accountSummary = {
          availableAmount: Number(coins.available_amount ?? coins.fe_available_amount / 100000 ?? 0) || 0,
          expiryItems,
          nextExpiry: expiryItems[0] ?? null,
          fetchedAt: new Date().toISOString()
        };

        return this.accountSummary;
      } catch (error) {
        console.warn('[ShopeeCoinCollector] Failed to fetch account summary:', error);
        return null;
      }
    }

    // Convert a current Shopee coin transaction item to CoinRecord.
    normalizeRawLogItem(item) {
      const coinAmount = Number.parseFloat(item.coin_amount ?? item.coin ?? item.amount ?? item.coins ?? 0) || 0;
      const name = String(item.name ?? item.title ?? item.description ?? item.text ?? item.event_name ?? '').trim();
      const reason = String(item.info?.reason ?? '').trim();
      const combinedText = `${name} ${reason}`;

      let type = 'gain';
      if (combinedText.includes('過期') || combinedText.includes('失效')) {
        type = 'expired';
      } else if (
        coinAmount < 0 ||
        item.coin_type === 2 ||
        item.type === 2 ||
        combinedText.includes('折抵') ||
        combinedText.includes('使用') ||
        combinedText.includes('付款')
      ) {
        type = 'spend';
      }

      const rawTimestamp = Number(item.ctime ?? item.create_time ?? item.timestamp ?? item.mtime ?? 0);
      const timestampMs = rawTimestamp > 1e12 ? rawTimestamp : rawTimestamp * 1000;
      const dateObj = rawTimestamp ? new Date(timestampMs) : new Date();

      let expiryDate = '-';
      const rawExpiry = Number(item.expiry_time ?? item.expire_time ?? 0);
      if (rawExpiry) {
        const expiryMs = rawExpiry > 1e12 ? rawExpiry : rawExpiry * 1000;
        const expiry = new Date(expiryMs);
        expiryDate = `${expiry.getFullYear()}-${String(expiry.getMonth() + 1).padStart(2, '0')}-${String(expiry.getDate()).padStart(2, '0')}`;
      }

      const title = name || reason || '蝦幣變動';
      const fullTitle = reason && reason !== title ? `${title} - ${reason}` : title;
      const orderSn = item.order_sn ?? item.ordersn ?? item.order_id ?? '-';
      const absAmount = Math.abs(coinAmount);

      return new CoinRecord({
        id: String(item.id ?? item.transaction_id ?? `${dateObj.getTime()}_${fullTitle}_${absAmount}`),
        timestamp: dateObj.toISOString(),
        title: fullTitle,
        type,
        amount: absAmount,
        displayAmount: type === 'gain' ? absAmount : -absAmount,
        expiryDate,
        orderSn: orderSn && orderSn !== 0 ? String(orderSn) : '-',
        raw: item
      });
    }

    // Fetch all pages through Shopee's current REST API endpoint.
    async fetchViaAPI(progressCallback) {
      this.isCollecting = true;
      this.shouldStop = false;

      const endpoint = '/api/v4/coin/get_user_coin_transaction_list';
      const limit = 20;
      let offset = 0;
      let hasMore = true;
      let requestSucceeded = false;

      console.log(`[ShopeeCoinCollector] Using API endpoint: ${endpoint}`);

      try {
        await this.fetchAccountSummary();

        while (hasMore && !this.shouldStop) {
          const apiUrl = `${endpoint}?type=all&offset=${offset}&limit=${limit}`;
          const response = await fetch(apiUrl, { credentials: 'include' });

          if (!response.ok) {
            console.error(`[ShopeeCoinCollector] API response HTTP ${response.status}`);
            break;
          }

          const resData = await response.json();
          if (resData.error && resData.error !== 0) {
            console.error('[ShopeeCoinCollector] API error:', resData.error_msg || resData.error);
            break;
          }

          requestSucceeded = true;

          const items =
            (Array.isArray(resData.items) && resData.items) ||
            (Array.isArray(resData.data?.items) && resData.data.items) ||
            (Array.isArray(resData.data?.coin_transactions) && resData.data.coin_transactions) ||
            (Array.isArray(resData.data?.list) && resData.data.list) ||
            [];

          if (items.length === 0) {
            hasMore = false;
            break;
          }

          for (const item of items) {
            const record = this.normalizeRawLogItem(item);
            this.collectedRecords.set(record.id, record);
          }

          offset += items.length;
          const explicitHasMore = resData.has_more ?? resData.data?.has_more;
          hasMore = explicitHasMore === undefined ? items.length === limit : Boolean(explicitHasMore);

          if (progressCallback) {
            progressCallback({
              status: 'fetching',
              fetchedCount: this.collectedRecords.size,
              hasMore,
              records: this.getRecordsArray(),
              accountSummary: this.accountSummary
            });
          }

          if (hasMore && !this.shouldStop) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
      } catch (error) {
        console.error('[ShopeeCoinCollector] Error fetching API page:', error);
      } finally {
        this.isCollecting = false;
      }

      return requestSucceeded;
    }

    // DOM scraper fallback for the current Shopee coin-history page.
    scrapeFromDOM() {
      const items = document.querySelectorAll(
        '.Majt3V, .coin-history-item, .shopee-coin-log-item, tr.coin-row, div[class*="coin-history"], div[class*="CoinHistory"]'
      );
      const countBefore = this.collectedRecords.size;

      items.forEach((element, index) => {
        try {
          const titleElement = element.querySelector('.WYcY3j, .title, [class*="title"]');
          const descriptionElement = element.querySelector('.Xvdd6G, .description, [class*="desc"]');
          const dateElement = element.querySelector('.uunn, .date, .time, [class*="date"], [class*="time"]');
          const amountElement = element.querySelector('.jClYSy, .amount, .coins, [class*="amount"]');

          const title = titleElement?.innerText.trim() || `紀錄 ${index + 1}`;
          const description = descriptionElement?.innerText.trim() || '';
          const dateText = dateElement?.innerText.trim() || new Date().toLocaleDateString();
          const amountText = amountElement?.innerText.trim() || '0';
          const coinAmount = Number.parseFloat(amountText.replace(/[^\d.-]/g, '')) || 0;
          const combinedText = `${title} ${description}`;
          const isExpired = combinedText.includes('過期') || combinedText.includes('失效');
          const isSpend = coinAmount < 0 || combinedText.includes('折抵') || combinedText.includes('使用');
          const absAmount = Math.abs(coinAmount);
          const recordId = `dom_${dateText}_${combinedText}_${absAmount}`;

          if (!this.collectedRecords.has(recordId)) {
            this.collectedRecords.set(recordId, new CoinRecord({
              id: recordId,
              timestamp: new Date().toISOString(),
              dateStr: dateText,
              title: description ? `${title} - ${description}` : title,
              type: isExpired ? 'expired' : (isSpend ? 'spend' : 'gain'),
              amount: absAmount,
              displayAmount: isExpired || isSpend ? -absAmount : absAmount
            }));
          }
        } catch (error) {
          console.error('[ShopeeCoinCollector] Error parsing DOM item:', error);
        }
      });

      return this.collectedRecords.size - countBefore;
    }

    getRecordsArray() {
      return Array.from(this.collectedRecords.values())
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    getAccountSummary() {
      return this.accountSummary;
    }

    clear() {
      this.collectedRecords.clear();
      this.accountSummary = null;
    }
  }

  return {
    CoinRecord,
    APIClient: new APIClient()
  };
})();
