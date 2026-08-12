/**
 * Shopee Coin Data Collector API Engine
 * Handles API requests, network interception, DOM fallback parsing, and data normalization.
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
      this.amount = Number(data.amount) || 0; // positive for gain, negative or positive for spend depending on context
      this.displayAmount = data.displayAmount || (this.type === 'spend' ? -Math.abs(this.amount) : Math.abs(this.amount));
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
      return '其他活動';
    }
  }

  // API Client
  class APIClient {
    constructor() {
      this.isCollecting = false;
      this.shouldStop = false;
      this.collectedRecords = new Map(); // id -> CoinRecord
    }

    stop() {
      this.shouldStop = true;
      this.isCollecting = false;
    }

    // Convert Shopee raw log item to CoinRecord
    normalizeRawLogItem(item) {
      // Shopee API returns amount usually in coins or coin units
      // Coin amount field names in Shopee API can be: coin, amount, coins, coin_amount
      let rawAmount = item.coin ?? item.amount ?? item.coins ?? item.coin_amount ?? 0;
      
      // If Shopee returns amount in cents (e.g. 100 = 1 coin), handle appropriately if needed
      // Normally Shopee coin is integer representation or decimal
      let coinAmount = Number(rawAmount);
      
      // Determine type & direction
      let type = 'gain';
      if (item.coin_type === 2 || item.type === 2 || coinAmount < 0 || (item.text && item.text.includes('使用'))) {
        type = 'spend';
      } else if (item.coin_type === 3 || (item.text && item.text.includes('過期'))) {
        type = 'expired';
      }

      let absAmount = Math.abs(coinAmount);

      // Parse timestamp
      let ts = item.ctime ?? item.create_time ?? item.timestamp ?? item.mtime;
      let dateObj = this.parseTimestamp(ts);

      // Expiry Date
      let expStr = '-';
      if (item.expiry_time || item.expire_time) {
        let expTs = item.expiry_time ?? item.expire_time;
        let expDate = this.parseTimestamp(expTs);
        expStr = `${expDate.getFullYear()}-${String(expDate.getMonth()+1).padStart(2,'0')}-${String(expDate.getDate()).padStart(2,'0')}`;
      }

      // Order SN
      let orderSn = item.order_sn || item.ordersn || item.order_id || '-';

      // Title/Description
      let title = item.description || item.title || item.text || item.event_name || '蝦幣變動';

      return new CoinRecord({
        id: item.id || item.transaction_id || `${dateObj.getTime()}_${title}_${absAmount}`,
        timestamp: dateObj.toISOString(),
        title: title,
        type: type,
        amount: absAmount,
        displayAmount: type === 'spend' || type === 'expired' ? -absAmount : absAmount,
        expiryDate: expStr,
        orderSn: orderSn,
        raw: item
      });
    }

    parseTimestamp(ts) {
      if (ts === null || ts === undefined || ts === '') {
        return new Date();
      }

      if (typeof ts === 'number') {
        return new Date(ts > 1e12 ? ts : ts * 1000);
      }

      if (typeof ts === 'string') {
        const numericTs = Number(ts);
        if (!Number.isNaN(numericTs) && ts.trim() !== '') {
          return new Date(numericTs > 1e12 ? numericTs : numericTs * 1000);
        }

        const parsed = new Date(ts);
        if (!Number.isNaN(parsed.getTime())) {
          return parsed;
        }
      }

      return new Date();
    }

    parseResponseItems(resData, pageLimit) {
      const result = {
        items: [],
        hasMore: false,
        recognized: false
      };

      if (!resData || typeof resData !== 'object') return result;

      if (resData.data && typeof resData.data === 'object') {
        const data = resData.data;
        const list = data.list || data.item || data.logs || data.items;

        if (Array.isArray(list)) {
          result.items = list;
          result.recognized = true;
          if (data.has_more !== undefined) {
            result.hasMore = Boolean(data.has_more);
          } else if (data.more !== undefined) {
            result.hasMore = Boolean(data.more);
          } else {
            result.hasMore = list.length === pageLimit;
          }
          return result;
        }
      }

      if (Array.isArray(resData.list)) {
        result.items = resData.list;
        result.recognized = true;
        if (resData.has_more !== undefined) {
          result.hasMore = Boolean(resData.has_more);
        } else if (resData.more !== undefined) {
          result.hasMore = Boolean(resData.more);
        } else {
          result.hasMore = resData.list.length === pageLimit;
        }
      }

      return result;
    }

    extractFirstText(el, selectorList) {
      for (const selector of selectorList) {
        const target = el.querySelector(selector);
        if (!target) continue;
        const text = (target.innerText || target.textContent || '').trim();
        if (text) return text;
      }
      return '';
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

    // Try fetching via Shopee's internal REST API endpoints
    async fetchViaAPI(progressCallback) {
      this.isCollecting = true;
      this.shouldStop = false;

      const endpoints = [
        '/api/v4/coin/get_user_coin_log',
        '/api/v2/coin/get_coin_log',
        '/api/v4/coin/get_coin_log_list'
      ];

      let successfulEndpoint = null;
      let offset = 0;
      const limit = 50;
      let totalFetched = 0;
      let hasMore = true;

      // Find working endpoint
      for (const ep of endpoints) {
        try {
          const testUrl = `${ep}?limit=10&offset=0&type=0`;
          const resp = await fetch(testUrl, { credentials: 'include' });
          if (resp.ok) {
            const json = await resp.json();
            const parsed = this.parseResponseItems(json, 10);
            if (parsed.recognized) {
              successfulEndpoint = ep;
              break;
            }
          }
        } catch (e) {
          console.warn(`[ShopeeCoinCollector] Endpoint ${ep} test failed:`, e);
        }
      }

      if (!successfulEndpoint) {
        console.warn('[ShopeeCoinCollector] Direct API endpoints failed/blocked. Trying DOM fallback...');
        return false;
      }

      console.log(`[ShopeeCoinCollector] Using API endpoint: ${successfulEndpoint}`);

      while (hasMore && !this.shouldStop) {
        try {
          const apiUrl = `${successfulEndpoint}?limit=${limit}&offset=${offset}&type=0`;
          const response = await fetch(apiUrl, { credentials: 'include' });
          
          if (!response.ok) {
            console.error(`API response HTTP ${response.status}`);
            break;
          }

          const resData = await response.json();
          const parsed = this.parseResponseItems(resData, limit);
          const items = parsed.items;
          hasMore = parsed.hasMore;

          if (items.length === 0) {
            hasMore = false;
            break;
          }

          for (const item of items) {
            try {
              const rec = this.normalizeRawLogItem(item);
              this.collectedRecords.set(rec.id, rec);
            } catch (itemErr) {
              console.warn('[ShopeeCoinCollector] Skip malformed item:', itemErr);
            }
          }

          offset += items.length;
          totalFetched = this.collectedRecords.size;

          if (progressCallback) {
            progressCallback({
              status: 'fetching',
              fetchedCount: totalFetched,
              hasMore: hasMore,
              records: this.getRecordsArray()
            });
          }

          // Respectful throttle delay between pagination calls
          await new Promise(r => setTimeout(r, 250));

        } catch (err) {
          console.error('[ShopeeCoinCollector] Error fetching API page:', err);
          break;
        }
      }

      this.isCollecting = false;
      return this.collectedRecords.size > 0;
    }

    // DOM Scraper Fallback
    scrapeFromDOM() {
      const itemSelectors = [
        'div[data-sqe="coin-history-item"]',
        '.coin-history-item',
        '.shopee-coin-log-item',
        '.coin-history-list > div',
        'div[class*="coin"][class*="history"][class*="item"]',
        'div[class*="transaction"][class*="item"]',
        'div[class*="record"][class*="item"]',
        'tr.coin-row'
      ];

      const itemSet = new Set();
      itemSelectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((el) => itemSet.add(el));
      });

      const items = Array.from(itemSet).filter((el) => {
        const txt = (el.innerText || '').trim();
        if (!txt) return false;
        const hasAmount = /[+-]\s*\d+(?:[.,]\d+)?/.test(txt);
        const hasCoinText = /(蝦幣|coin)/i.test(txt);
        const hasDate = /\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}|\d{1,2}:\d{2}/.test(txt);
        return hasAmount || (hasCoinText && hasDate);
      });

      let countBefore = this.collectedRecords.size;

      items.forEach((el, index) => {
        try {
          let title = this.extractFirstText(el, [
            '[data-sqe="coin-history-item-title"]',
            '[class*="title"]',
            '[class*="description"]',
            '[class*="desc"]',
            '[class*="reason"]',
            'strong'
          ]);

          let dateText = this.extractFirstText(el, [
            '[data-sqe="coin-history-item-time"]',
            'time',
            '[class*="date"]',
            '[class*="time"]',
            '[class*="create"]'
          ]);

          let amountText = this.extractFirstText(el, [
            '[data-sqe="coin-history-item-amount"]',
            '[class*="amount"]',
            '[class*="coin-change"]',
            '[class*="value"]',
            '[class*="num"]'
          ]);

          let orderSn = this.extractFirstText(el, [
            '[class*="order"]',
            '[class*="sn"]',
            '[data-sqe*="order"]'
          ]);

          const rawText = (el.innerText || '').trim();
          const lines = rawText.split('\n').map(s => s.trim()).filter(Boolean);

          if (!amountText) {
            amountText = lines.find(t => /[+-]\s*\d+(?:[.,]\d+)?/.test(t)) || '';
          }

          if (!dateText) {
            dateText = lines.find(t => /\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}|\d{1,2}:\d{2}/.test(t)) || '';
          }

          if (!title) {
            title = lines.find(t => !/[+-]\s*\d+(?:[.,]\d+)?/.test(t) && !/\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}|\d{1,2}:\d{2}/.test(t)) || `紀錄 ${index + 1}`;
          }

          const fallbackOrderMatch = rawText.match(/(?:訂單(?:編號)?|Order(?:\s*SN)?)[：:\s#-]*([A-Za-z0-9-]{8,})/i);
          if ((!orderSn || orderSn.length < 6) && fallbackOrderMatch) {
            orderSn = fallbackOrderMatch[1];
          }

          const amountMatch = amountText.match(/-?\d+(?:[.,]\d+)?/);
          const cleanAmount = Math.abs(parseFloat((amountMatch ? amountMatch[0] : '0').replace(/,/g, '')) || 0);
          if (cleanAmount <= 0 && !/(蝦幣|coin)/i.test(rawText)) return;

          const isExpired = amountText.includes('過期') || title.includes('過期') || title.includes('失效') || rawText.includes('過期');
          const isSpend = !isExpired && (
            amountText.includes('-') ||
            amountText.includes('使用') ||
            title.includes('折抵') ||
            title.includes('使用') ||
            title.includes('扣除')
          );

          const type = isExpired ? 'expired' : (isSpend ? 'spend' : 'gain');
          const parsedDate = this.parseTimestamp(dateText);
          const dateStr = this.formatDate(parsedDate);
          const recId = `dom_${parsedDate.getTime()}_${title}_${cleanAmount}_${type}`;

          if (!this.collectedRecords.has(recId)) {
            const record = new CoinRecord({
              id: recId,
              timestamp: parsedDate.toISOString(),
              dateStr: dateStr,
              title: title,
              type: type,
              amount: cleanAmount,
              displayAmount: type === 'spend' || type === 'expired' ? -cleanAmount : cleanAmount,
              orderSn: orderSn || '-'
            });
            this.collectedRecords.set(recId, record);
          }
        } catch (e) {
          console.error('Error parsing DOM item:', e);
        }
      });

      return this.collectedRecords.size - countBefore;
    }

    getRecordsArray() {
      const arr = Array.from(this.collectedRecords.values());
      // Sort descending by timestamp / dateStr
      return arr.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    clear() {
      this.collectedRecords.clear();
    }
  }

  return {
    CoinRecord,
    APIClient: new APIClient()
  };
})();
