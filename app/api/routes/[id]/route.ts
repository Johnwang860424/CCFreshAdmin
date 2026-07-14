import { NextResponse } from "next/server";
import {
  renameRoute,
  deleteRoute,
  countSpotsInRoute,
} from "@/app/lib/routes";
import { badRequest, jsonHandler } from "@/app/lib/api";
import { revalidateCache } from "@/app/lib/revalidate";
import { MAX_LEN, parseId } from "@/app/lib/validation";

type Params = { params: Promise<{ id: string }> };

export const PUT = jsonHandler<Params>(async (request, { params }) => {
  const { id: idStr } = await params;
  const parsed = parseId(idStr);
  if ("error" in parsed) return badRequest(parsed.error);
  const { id } = parsed;

  const body = await request.json();
  const { name } = body as { name: string };

  const nameVal = name?.trim();
  if (!nameVal) {
    return NextResponse.json({ error: "路線名稱為必填欄位" }, { status: 400 });
  }
  if (nameVal.length > MAX_LEN.routeName) {
    return NextResponse.json(
      { error: `路線名稱不可超過 ${MAX_LEN.routeName} 字` },
      { status: 400 },
    );
  }

  try {
    await renameRoute(id, nameVal);
  } catch (err) {
    if ((err as { code?: string })?.code === "23505") {
      return NextResponse.json({ error: "路線名稱重複" }, { status: 400 });
    }
    throw err;
  }
  // 改名影響取貨點顯示的 routeName，故一併重新驗證 pickup-spots 快取。
  await revalidateCache("routes");
  await revalidateCache("pickup-spots");
  return { success: true };
}, "更新路線失敗");

export const DELETE = jsonHandler<Params>(async (_request, { params }) => {
  const { id: idStr } = await params;
  const parsed = parseId(idStr);
  if ("error" in parsed) return badRequest(parsed.error);
  const { id } = parsed;

  const count = await countSpotsInRoute(id);
  if (count > 0) {
    return NextResponse.json(
      { error: `此路線仍有 ${count} 個取貨點，無法刪除` },
      { status: 400 },
    );
  }

  try {
    await deleteRoute(id);
  } catch (err) {
    // 檢查與刪除之間若有取貨點被改派進來，會違反外鍵約束（Postgres 23503）。
    if ((err as { code?: string })?.code === "23503") {
      return NextResponse.json(
        { error: "此路線仍有取貨點，無法刪除" },
        { status: 400 },
      );
    }
    throw err;
  }

  await revalidateCache("routes");
  return { success: true };
}, "刪除路線失敗");
