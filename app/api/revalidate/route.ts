import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { InvalidJsonError, readJson } from "@/app/lib/api";

// 可被外部 revalidate 的 tag。目前僅前台下單扣庫存後需要去除商品快取；
// 其餘 tag 的異動都源自後台自己，寫入時已 revalidate，不對外開放。
const ALLOWED_TAGS = ["products"] as const;
type AllowedTag = (typeof ALLOWED_TAGS)[number];

function isAllowedTag(value: unknown): value is AllowedTag {
  return ALLOWED_TAGS.includes(value as AllowedTag);
}

// 前台（客戶端 App）下單扣庫存後呼叫此 endpoint，讓後台的商品快取失效、
// 列表/訂單選單即時顯示最新剩餘量。與前台 /api/revalidate 共用同一組
// ADMIN_SECRET_TOKEN 做 Bearer 授權；此路由已在 proxy.ts matcher 排除，
// 不走 Google 登入檢查。注意：這裡直接 revalidateTag，不可走 revalidateCache
// （後者會再通知前台，形成迴圈）。
export async function POST(request: Request): Promise<Response> {
  try {
    const secret = process.env.ADMIN_SECRET_TOKEN;
    if (!secret) {
      throw new Error("ADMIN_SECRET_TOKEN is not set");
    }

    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (token !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await readJson(request);
    const tag = (body as { tag?: unknown } | null)?.tag;
    if (!isAllowedTag(tag)) {
      return NextResponse.json(
        { error: `Invalid tag. Allowed: ${ALLOWED_TAGS.join(", ")}` },
        { status: 400 },
      );
    }

    revalidateTag(tag, { expire: 0 });
    return NextResponse.json({ revalidated: true, tag, now: Date.now() });
  } catch (err) {
    if (err instanceof InvalidJsonError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json(
      { error: "Unable to revalidate cache" },
      { status: 500 },
    );
  }
}
