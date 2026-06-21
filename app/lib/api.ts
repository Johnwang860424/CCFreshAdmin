import { NextResponse } from "next/server";

type RouteHandler<Ctx> = (request: Request, context: Ctx) => Promise<unknown>;

/**
 * 包住 route handler，把例外處理集中一處：
 * - handler 回傳 Response（含 NextResponse）→ 原樣透傳（早退的 400/401、CSV 下載等）。
 * - handler 回傳其他值 → 包成 JSON 200。
 * - 未捕捉的例外 → log 後回 500（訊息可透過 errorMessage 在地化）。
 * 讓各 route 專注在「拿資料 / 早退」。
 */
export function jsonHandler<Ctx = unknown>(
  fn: RouteHandler<Ctx>,
  errorMessage = "Internal Server Error",
) {
  return async (request: Request, context: Ctx): Promise<Response> => {
    try {
      const result = await fn(request, context);
      return result instanceof Response ? result : NextResponse.json(result);
    } catch (err) {
      console.error(err);
      return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
  };
}
