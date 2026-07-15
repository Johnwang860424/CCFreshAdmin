// 折扣優惠的「策略模式」核心：純資料/邏輯模組，前後端共用（勿引入 server-only 依賴）。
// 新增一種折扣方式 = 在此定義一個 PromoStrategy 並加入 PROMO_STRATEGIES。

/** 策略參數（存於 products.promo_config JSONB），目前皆為整數欄位。 */
export type PromoConfig = Record<string, number>;

/** 表單欄位中介資料：前端依此動態渲染輸入欄、後端據此做通用驗證。 */
interface PromoField {
  name: string; // config 的鍵
  label: string;
  min: number;
  max: number;
  placeholder?: string;
  tooltip?: string;
}

export interface PromoStrategy {
  type: string; // 存於 products.promo_type
  label: string; // 優惠方式下拉選項顯示
  fields: PromoField[];
  /** 驗證並正規化原始參數（來自 API body 的 config 物件）。 */
  validate(raw: unknown): { config: PromoConfig } | { error: string };
  /** 後台列表的優惠摘要文字。 */
  describe(config: PromoConfig): string;
  /** 整筆品項（單價 unitPrice × quantity）套用優惠後的小計（整數 NT$）。 */
  subtotal(config: PromoConfig, unitPrice: number, quantity: number): number;
}

/** 通用的整數欄位驗證，供多數策略重用。 */
function validateNumericFields(
  fields: PromoField[],
  raw: unknown,
): { config: PromoConfig } | { error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { error: "優惠設定格式錯誤" };
  }
  const input = raw as Record<string, unknown>;
  const config: PromoConfig = {};
  for (const f of fields) {
    const value = input[f.name];
    const num = Number(value);
    if (
      value === "" ||
      value === null ||
      value === undefined ||
      !Number.isInteger(num) ||
      num < f.min ||
      num > f.max
    ) {
      return {
        error: `${f.label}需為介於 ${f.min} ~ ${f.max} 的整數`,
      };
    }
    config[f.name] = num;
  }
  return { config };
}

// --- 策略：第二件折扣（折數採折數慣例，80 = 第二件 8 折） ---
const secondItemFields: PromoField[] = [
  {
    name: "discount",
    label: "第二件折數",
    min: 1,
    max: 99,
    placeholder: "例：80（即第二件 8 折）",
    tooltip: "80 = 第二件 8 折（第二件付原價 80%）",
  },
];

const secondItemStrategy: PromoStrategy = {
  type: "second_item",
  label: "第二件折扣",
  fields: secondItemFields,
  validate: (raw) => validateNumericFields(secondItemFields, raw),
  // config.discount 是百分比（80 = 付原價 80%），折數需除以 10（80 → 8 折、85 → 8.5 折）。
  describe: (config) => `第二件 ${config.discount / 10} 折`,
  // 每湊滿兩件，其中一件以 discount% 計價（買 4 件折 2 件…）；奇數件最後一件付原價。
  subtotal: (config, unitPrice, quantity) => {
    const discountedCount = Math.floor(quantity / 2);
    const fullCount = quantity - discountedCount;
    return (
      fullCount * unitPrice +
      discountedCount * Math.round((unitPrice * config.discount) / 100)
    );
  },
};

// --- 策略：X 件以上均價 Y 元（買滿門檻件數後，每件以指定均價計算） ---
const bulkAvgPriceFields: PromoField[] = [
  {
    name: "minQuantity",
    label: "件數門檻",
    min: 2,
    max: 999,
    placeholder: "例：3（買滿 3 件以上）",
    tooltip: "達到此件數（含）後，每件以均價計算",
  },
  {
    name: "avgPrice",
    label: "均價（元）",
    min: 0,
    max: 1000000,
    placeholder: "例：100（每件均價 100 元）",
    tooltip: "達門檻後每件的單價（NT$ 整數）",
  },
];

const bulkAvgPriceStrategy: PromoStrategy = {
  type: "bulk_avg_price",
  label: "X 件以上均價",
  fields: bulkAvgPriceFields,
  validate: (raw) => validateNumericFields(bulkAvgPriceFields, raw),
  describe: (config) =>
    `${config.minQuantity} 件以上均價 ${config.avgPrice} 元`,
  // 達門檻（含）後整筆每件以 avgPrice 計；未達門檻退回原價 × 數量。
  subtotal: (config, unitPrice, quantity) =>
    quantity >= config.minQuantity
      ? quantity * config.avgPrice
      : unitPrice * quantity,
};

/** 所有可用折扣策略；新增折扣方式時把策略加進來即可。 */
export const PROMO_STRATEGIES: PromoStrategy[] = [
  secondItemStrategy,
  bulkAvgPriceStrategy,
];

const STRATEGY_BY_TYPE = new Map(PROMO_STRATEGIES.map((s) => [s.type, s]));

export function getPromoStrategy(type: string): PromoStrategy | undefined {
  return STRATEGY_BY_TYPE.get(type);
}

/** 品項所帶的優惠資料（隨 Product 傳到前端供計價）。 */
export interface ProductPromo {
  type: string;
  config: PromoConfig;
}

/**
 * 計算單一品項折後小計。無優惠或策略不存在時退回原價 × 數量。
 * 框架無關，前後端共用。
 */
export function calcLineSubtotal(
  promo: ProductPromo | null,
  unitPrice: number,
  quantity: number,
): number {
  if (!promo) {
    return unitPrice * quantity;
  }
  const strategy = getPromoStrategy(promo.type);
  if (!strategy) {
    return unitPrice * quantity;
  }
  return strategy.subtotal(promo.config, unitPrice, quantity);
}

export interface NormalizedPromo {
  promoType: string | null;
  promoConfig: PromoConfig | null;
}

/**
 * 驗證並正規化優惠設定。type 為空視為無優惠（type/config 皆為 null = 等同停用）。
 * 框架無關：失敗回傳 { error }，由呼叫端決定如何回應。
 */
export function validatePromo(
  type: unknown,
  config: unknown,
): NormalizedPromo | { error: string } {
  if (type === null || type === undefined || type === "") {
    return { promoType: null, promoConfig: null };
  }
  if (typeof type !== "string") {
    return { error: "無效的優惠方式" };
  }
  const strategy = getPromoStrategy(type);
  if (!strategy) {
    return { error: "無效的優惠方式" };
  }
  const result = strategy.validate(config);
  if ("error" in result) {
    return result;
  }
  return {
    promoType: type,
    promoConfig: result.config,
  };
}
