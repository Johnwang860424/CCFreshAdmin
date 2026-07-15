import { NextResponse } from "next/server";
import {
  batchAdjustOrderItems,
  OrderInputError,
} from "@/app/lib/orders";
import { badRequest, jsonHandler, readJson } from "@/app/lib/api";
import { validateBatchOrderAdjustmentBody } from "@/app/lib/validation";

export const POST = jsonHandler(async (request) => {
  const body = await readJson(request);
  const parsed = validateBatchOrderAdjustmentBody(body);
  if ("error" in parsed) return badRequest(parsed.error);

  try {
    return await batchAdjustOrderItems(parsed.value);
  } catch (error) {
    if (error instanceof OrderInputError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}, "批次調整訂單失敗");
