import { NextResponse } from "next/server";
import { getRouteOrderMatrix } from "@/app/lib/orders";
import { getRoutes } from "@/app/lib/routes";
import { jsonHandler } from "@/app/lib/api";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 路線訂單統計：
// - 無任何參數 → 回傳全部路線清單（供下拉選單：全部路線 / 各路線 / 未分路線）。
// - 帶 route 與/或日期 → 回傳該條件的「取貨點 × 商品」數量交叉表。
//   route：`all` 或省略（全部路線）｜ `unassigned`（未分路線）｜ `<id>`（指定路線）。
//   from/to（YYYY-MM-DD，台北時區）：省略時不限日期（全部）。
export const GET = jsonHandler(async (request) => {
  const params = new URL(request.url).searchParams;
  const routeParam = params.get("route");
  const fromParam = params.get("from");
  const toParam = params.get("to");

  // 下拉清單載入：無 route 也無日期。
  if (!routeParam && !fromParam && !toParam) {
    const routes = await getRoutes();
    return { routes: routes.map((r) => ({ id: r.id, name: r.name })) };
  }

  let route: number | "unassigned" | "all";
  if (!routeParam || routeParam === "all") {
    route = "all";
  } else if (routeParam === "unassigned") {
    route = "unassigned";
  } else {
    const n = Number(routeParam);
    if (!Number.isInteger(n) || n <= 0) {
      return NextResponse.json({ error: "無效的路線" }, { status: 400 });
    }
    route = n;
  }

  if ((fromParam && !DATE_RE.test(fromParam)) || (toParam && !DATE_RE.test(toParam))) {
    return NextResponse.json({ error: "日期格式錯誤" }, { status: 400 });
  }
  // 省略日期時以極寬區間代表「不限日期」。
  const from = fromParam || "0001-01-01";
  const to = toParam || "9999-12-31";

  return getRouteOrderMatrix(route, from, to);
}, "無法讀取訂單統計");
