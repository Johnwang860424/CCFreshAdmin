import {
  getOrdersByLocation,
  getOrderLocations,
  getDeliveryOrders,
  hasDeliveryOrders,
} from "@/app/lib/orders";
import { jsonHandler } from "@/app/lib/api";

// 訂單查詢：
// - 無參數 → 回傳有自取訂單的縣市/鄉鎮清單與是否有宅配訂單（供下拉選單）。
//   進到畫面時僅取清單，不載入全部訂單。
// - method=delivery → 回傳所有宅配訂單（含明細）。宅配無結構化縣市/鄉鎮。
// - city 參數（可再加 township）→ 回傳該縣市/鄉鎮的自取訂單（含明細）。
export const GET = jsonHandler(async (request) => {
  const params = new URL(request.url).searchParams;
  const city = params.get("city");
  const method = params.get("method");

  if (method === "delivery") {
    return getDeliveryOrders();
  }

  if (!city) {
    const [locations, hasDelivery] = await Promise.all([
      getOrderLocations(),
      hasDeliveryOrders(),
    ]);
    return { locations, hasDelivery };
  }

  const township = params.get("township");
  return getOrdersByLocation(city, township || null);
}, "無法讀取訂單資料");
