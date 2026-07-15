// 訂單管理頁「重複下訂」判定邏輯：純函式、框架無關。
// 與後端 countSameNameOrdersInGroup（app/lib/orders.ts）採同一語意：僅比對姓名，電話不比對。

/** 判定所需的最小訂單形狀（訂單管理頁的 Order 與 OrderRow 皆符合）。 */
interface NamedOrder {
  customerName: string;
}

/**
 * 重複下訂判定鍵：客戶姓名去除頭尾空白後的字串。僅「相同姓名」視為重複——
 * 電話不比對；姓名為空（理論上必填不會發生）回傳 null，不參與判定。
 */
export function orderKey(order: NamedOrder): string | null {
  const nameKey = order.customerName.trim();
  return nameKey !== "" ? nameKey : null;
}

/** 以整批訂單為母體，回傳出現超過一筆的姓名鍵集合。 */
export function duplicateNameKeys(orders: NamedOrder[]): Set<string> {
  const countByKey = new Map<string, number>();
  for (const order of orders) {
    const key = orderKey(order);
    if (key === null) continue;
    countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
  }
  return new Set(
    [...countByKey].filter(([, n]) => n > 1).map(([key]) => key),
  );
}

/** 重複下訂的訂單筆數（以訂單計，非客戶數）。 */
export function countDuplicateOrders(
  orders: NamedOrder[],
  dupKeys: Set<string>,
): number {
  let n = 0;
  for (const order of orders) {
    const key = orderKey(order);
    if (key !== null && dupKeys.has(key)) n++;
  }
  return n;
}

/**
 * 讓同一客戶的訂單相鄰：以鍵首次出現於母體 `population` 的索引為組序，
 * 組內靠穩定排序維持原相對順序。回傳新陣列，不動輸入。
 * 呼叫端保證 `orders` 內全為有姓名鍵、且鍵存在於母體的訂單（重複篩選開啟時的結果集）。
 */
export function sortDuplicatesAdjacent<T extends NamedOrder>(
  orders: T[],
  population: NamedOrder[],
): T[] {
  const firstSeen = new Map<string, number>();
  population.forEach((order, i) => {
    const key = orderKey(order);
    if (key !== null && !firstSeen.has(key)) firstSeen.set(key, i);
  });
  return [...orders].sort(
    (a, b) => firstSeen.get(orderKey(a)!)! - firstSeen.get(orderKey(b)!)!,
  );
}
