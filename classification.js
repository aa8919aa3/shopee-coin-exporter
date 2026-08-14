/**
 * Shopee Coin Classification Engine 2.0
 * Classifies source and usage transactions using structural fields before text rules.
 */

window.ShopeeCoinClassification = (function () {
  'use strict';

  const SOURCE_CATEGORIES = Object.freeze([
    '每日簽到',
    '每日登入',
    '購物/訂單',
    '退款/沖正',
    '蝦皮遊戲',
    '短影音',
    '蝦皮直播',
    '評價',
    'VIP訂閱',
    '蝦皮聯名卡',
    '蝦幣獎勵',
    '行銷活動/任務',
    '其他來源'
  ]);

  const USAGE_CATEGORIES = Object.freeze([
    '訂單蝦幣折抵',
    '票券/服務兌換',
    '一般消費折抵',
    '活動消耗',
    '蝦幣過期',
    '其他使用'
  ]);

  const ACTIVITY_CATEGORIES = Object.freeze([...SOURCE_CATEGORIES, ...USAGE_CATEGORIES]);
  const FALLBACK_CATEGORIES = new Set(['其他來源', '其他使用']);
  const CONFIDENCE_LEVELS = Object.freeze(['high', 'medium', 'low']);

  function cleanText(value) {
    return String(value ?? '').trim();
  }

  function normalizeOrderSn(value) {
    const orderSn = cleanText(value);
    return orderSn && orderSn !== '-' && orderSn !== '0' ? orderSn : '-';
  }

  function hasOrderSn(record) {
    return normalizeOrderSn(record?.orderSn) !== '-';
  }

  function result(category, ruleId, confidence, explanation) {
    return { category, ruleId, confidence, explanation };
  }

  function sourceText(record) {
    return {
      name: cleanText(record?.rawName || record?.title),
      reason: cleanText(record?.rawReason),
      title: cleanText(record?.title)
    };
  }

  function matchesStrong(texts, pattern) {
    return pattern.test(texts.name) || pattern.test(texts.reason);
  }

  function classifySpend(record, texts) {
    if (hasOrderSn(record)) {
      return result('訂單蝦幣折抵', 'usage.order-number', 'high', '負向交易具有訂單編號，判定為訂單蝦幣折抵。');
    }

    const voucherPattern = /禮券|喜客券|即享券|票券|電子券|數位商品券|餐券|兌換券|一次抵用型|限定品牌使用|\bvoucher\b|\bgift\s*card\b/i;
    if (voucherPattern.test(texts.name) || voucherPattern.test(texts.reason)) {
      return result('票券/服務兌換', 'usage.voucher-or-service', 'high', '無訂單編號且名稱或原因符合票券／服務兌換模式。');
    }

    const explicitActivitySpend = /^(?:蝦皮)?(?:遊戲|直播|短影音|任務|活動).*(?:使用|消耗|扣除)|(?:活動|任務)內(?:使用|消耗)/i;
    if (explicitActivitySpend.test(texts.reason) || explicitActivitySpend.test(texts.name)) {
      return result('活動消耗', 'usage.explicit-activity-spend', 'medium', '原始活動名稱或原因明確表示活動內消耗。');
    }

    if (/蝦幣.*(?:折抵|使用)|(?:折抵|使用).*蝦幣|付款折抵/i.test(texts.reason)) {
      return result('一般消費折抵', 'usage.explicit-coin-deduction', 'medium', 'API 原始原因明確表示蝦幣折抵或使用。');
    }

    return result('其他使用', 'usage.fallback', 'low', '缺少訂單編號，且沒有符合高信心使用規則。');
  }

  function classifyGain(record, texts) {
    if (matchesStrong(texts, /每日登入|每日登錄|登入獎勵|登錄獎勵/i)) {
      return result('每日登入', 'source.daily-login', 'high', '名稱或 API 原始原因符合每日登入獎勵。');
    }
    if (matchesStrong(texts, /簽到|報到/i)) {
      return result('每日簽到', 'source.daily-checkin', 'high', '名稱或 API 原始原因符合每日簽到。');
    }
    if (matchesStrong(texts, /退款|退貨|取消訂單|補償|沖正|退回蝦幣/i)) {
      return result('退款/沖正', 'source.explicit-refund', 'high', '名稱或 API 原始原因明確表示退款、補償或沖正。');
    }
    if (matchesStrong(texts, /^(?:蝦皮)?短影音(?:\s|[-—：:]|$)|^Shopee\s*Video(?:\s|[-—：:]|$)|透過蝦皮短影音|觀看.*短影音/i)) {
      return result('短影音', 'source.short-video', 'high', '明確的短影音活動名稱或原因。');
    }
    if (matchesStrong(texts, /^(?:完成訂單)?評價|^蝦皮評價|評價獎勵|評論獎勵|評分獎勵/i)) {
      return result('評價', 'source.review', 'high', '明確的評價或評論獎勵。');
    }
    if (matchesStrong(texts, /VIP\s*訂閱|VIP\s*會員|會員訂閱|VIP\s*專屬寶箱/i)) {
      return result('VIP訂閱', 'source.vip-subscription', 'high', '明確的 VIP 訂閱或會員回饋。');
    }
    if (matchesStrong(texts, /蝦皮聯名卡|聯名卡|蝦皮信用卡|Shopee\s*信用卡|國泰.*蝦皮.*卡/i)) {
      return result('蝦皮聯名卡', 'source.co-branded-card', 'high', '明確的蝦皮聯名卡或信用卡回饋。');
    }
    if (matchesStrong(texts, /^(?:蝦幣獎勵|Coin\s*Reward)(?:\s|[-—：:]|$)|蝦幣(?:獎勵|回饋)(?:發放|入帳)?$/i)) {
      return result('蝦幣獎勵', 'source.coin-reward', 'high', '明確的蝦幣獎勵或回饋名稱。');
    }
    if (matchesStrong(texts, /^(?:蝦皮直營寶箱|蝦幣寶箱)(?:\s|[-—：:]|$)|寶箱.*(?:獲得|抽中).*蝦幣/i)) {
      return result('蝦幣獎勵', 'source.coin-treasure-reward', 'medium', '寶箱名稱或原因明確表示獲得蝦幣獎勵。');
    }
    if (matchesStrong(texts, /^(?:蝦蝦果園|蝦皮遊戲|遊戲蝦幣|蝦皮夾夾樂|潮電夢想箱|消消樂|Shopee\s*Game)(?:\s|[-—：:]|$)|恭喜.*遊戲.*蝦幣/i)) {
      return result('蝦皮遊戲', 'source.shopee-game', 'high', '明確的蝦皮遊戲活動名稱或原因。');
    }
    if (matchesStrong(texts, /^(?:蝦皮直播|直播蝦幣)(?:\s|[-—：:]|$)|透過蝦皮直播|在蝦皮直播中獲得/i)) {
      return result('蝦皮直播', 'source.shopee-live', 'high', '明確的蝦皮直播活動名稱或原因。');
    }
    if (matchesStrong(texts, /任務|挑戰|獎勵領取成功|蝦幣天天送/i)) {
      return result('行銷活動/任務', 'source.marketing-task', 'medium', '名稱或原因符合任務、挑戰或行銷活動。');
    }
    if (matchesStrong(texts, /完成訂單|訂單回饋|購物回饋|下單回饋|賣場回饋/i)) {
      return result('購物/訂單', 'source.order-reward', 'medium', '名稱或原因明確表示訂單或購物回饋。');
    }
    if (hasOrderSn(record)) {
      return result('購物/訂單', 'source.order-number-reward', 'high', '正向交易具有訂單編號，且未命中評價等更具體規則，判定為購物或訂單回饋。');
    }

    return result('其他來源', 'source.fallback', 'low', '沒有符合高信心來源規則，保留為其他來源。');
  }

  function classifyRecord(record) {
    const type = cleanText(record?.type);
    const texts = sourceText(record);

    if (type === 'expired') {
      return result('蝦幣過期', 'usage.expired', 'high', '交易類型為過期。');
    }
    if (type === 'spend') return classifySpend(record, texts);
    if (type === 'gain') return classifyGain(record, texts);
    return result('其他使用', 'unknown.fallback', 'low', '未知交易類型，無法可靠分類。');
  }

  function applyClassification(record, classification) {
    record.category = classification.category;
    record.categoryRuleId = classification.ruleId;
    record.categoryConfidence = classification.confidence;
    record.categoryExplanation = classification.explanation;
    return record;
  }

  function classifyRecords(records) {
    const source = Array.isArray(records) ? records : [];
    source.forEach(record => applyClassification(record, classifyRecord(record)));

    const spendsByOrderAndAmount = new Set();
    const spendsByTitleAndAmount = new Map();
    source.forEach(record => {
      if (record?.type !== 'spend') return;
      const orderSn = normalizeOrderSn(record.orderSn);
      const amountMicros = Math.abs(Number(record.amountMicros) || 0);
      if (orderSn !== '-') spendsByOrderAndAmount.add(`${orderSn}\u0000${amountMicros}`);
      const title = cleanText(record.rawName || record.title);
      const key = `${title}\u0000${amountMicros}`;
      spendsByTitleAndAmount.set(key, true);
    });

    let pairedRefunds = 0;
    let pairedRefundAmountMicros = 0;
    source.forEach(record => {
      if (record?.type !== 'gain' || !['其他來源', '購物/訂單'].includes(record.category)) return;
      const orderSn = normalizeOrderSn(record.orderSn);
      const title = cleanText(record.rawName || record.title);
      const amountMicros = Math.abs(Number(record.amountMicros) || 0);
      const titleAmountKey = `${title}\u0000${amountMicros}`;
      const matchedByOrder = orderSn !== '-' && spendsByOrderAndAmount.has(`${orderSn}\u0000${amountMicros}`);
      const matchedByTitleAndAmount = orderSn === '-' && spendsByTitleAndAmount.has(titleAmountKey);
      if (!matchedByOrder && !matchedByTitleAndAmount) return;

      applyClassification(record, result(
        '退款/沖正',
        matchedByOrder ? 'source.matched-refund-order' : 'source.matched-refund-title-amount',
        matchedByOrder ? 'high' : 'medium',
        matchedByOrder
          ? '正向交易與一筆使用紀錄具有相同訂單編號及金額，判定為退款或沖正。'
          : '正向交易與一筆無訂單編號的使用紀錄具有相同標題及金額，判定為退款或沖正。'
      ));
      pairedRefunds += 1;
      pairedRefundAmountMicros += amountMicros;
    });

    return { records: source, pairedRefunds, pairedRefundAmountMicros };
  }

  function computeQuality(records) {
    const source = Array.isArray(records) ? records : [];
    const confidenceCounts = { high: 0, medium: 0, low: 0 };
    const ruleHits = Object.create(null);
    let sourceAmountMicros = 0;
    let usageAmountMicros = 0;
    let sourceFallbackCount = 0;
    let sourceFallbackAmountMicros = 0;
    let usageFallbackCount = 0;
    let usageFallbackAmountMicros = 0;

    source.forEach(record => {
      const amountMicros = Math.abs(Number(record?.amountMicros) || 0);
      const confidence = CONFIDENCE_LEVELS.includes(record?.categoryConfidence) ? record.categoryConfidence : 'low';
      const ruleId = cleanText(record?.categoryRuleId) || 'unknown.fallback';
      confidenceCounts[confidence] += 1;
      ruleHits[ruleId] = (ruleHits[ruleId] || 0) + 1;

      if (record?.type === 'gain') {
        sourceAmountMicros += amountMicros;
        if (record.category === '其他來源') {
          sourceFallbackCount += 1;
          sourceFallbackAmountMicros += amountMicros;
        }
      } else if (record?.type === 'spend' || record?.type === 'expired') {
        usageAmountMicros += amountMicros;
        if (record.category === '其他使用') {
          usageFallbackCount += 1;
          usageFallbackAmountMicros += amountMicros;
        }
      }
    });

    const percent = (part, total) => total > 0 ? Math.round((part / total) * 10000) / 100 : 0;
    return {
      totalRecords: source.length,
      confidenceCounts,
      ruleHits,
      sourceFallbackCount,
      sourceFallbackAmountMicros,
      sourceFallbackPercent: percent(sourceFallbackAmountMicros, sourceAmountMicros),
      usageFallbackCount,
      usageFallbackAmountMicros,
      usageFallbackPercent: percent(usageFallbackAmountMicros, usageAmountMicros)
    };
  }

  return {
    SOURCE_CATEGORIES,
    USAGE_CATEGORIES,
    ACTIVITY_CATEGORIES,
    FALLBACK_CATEGORIES,
    normalizeOrderSn,
    classifyRecord,
    classifyRecords,
    computeQuality
  };
})();
