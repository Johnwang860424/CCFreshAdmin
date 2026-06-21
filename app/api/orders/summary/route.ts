import { getOrderCities, getCityOrderMatrix } from "@/app/lib/orders";
import { jsonHandler } from "@/app/lib/api";

// 縣市訂單統計：
// - 無 city 參數 → 回傳目前有自取訂單的縣市清單（供下拉選單）
// - 有 city 參數 → 回傳該縣市「鄉鎮 × 商品」的數量交叉表
export const GET = jsonHandler(async (request) => {
  const city = new URL(request.url).searchParams.get("city");

  if (!city) {
    const cities = await getOrderCities();
    return { cities };
  }

  return getCityOrderMatrix(city);
}, "無法讀取訂單統計");
