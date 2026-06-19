import { NextResponse } from "next/server";
import {
  deleteProduct,
  getProductImageUrl,
  updateProductDetails,
} from "@/app/lib/products";
import { deleteCloudinaryImage } from "@/app/lib/cloudinary";
import { revalidateCache } from "@/app/lib/revalidate";
import { MAX_LEN, parseId } from "@/app/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  try {
    const { id: idStr } = await params;
    const parsed = parseId(idStr);
    if ("error" in parsed) return parsed.error;
    const { id } = parsed;
    const body = await request.json();
    const { price, imageUrl, oldImageUrl, categoryId, spec, description } =
      body as {
        price: number | string;
        imageUrl: string;
        oldImageUrl?: string;
        categoryId: number | string;
        spec?: string;
        description?: string;
      };

    const priceNum = Number(price);
    if (
      String(price).trim() === "" ||
      !Number.isInteger(priceNum) ||
      priceNum < 0 ||
      !imageUrl
    ) {
      return NextResponse.json(
        { error: "有效價格（非負整數）和圖片為必填欄位" },
        { status: 400 }
      );
    }

    if (spec && spec.length > MAX_LEN.spec) {
      return NextResponse.json(
        { error: `規格不可超過 ${MAX_LEN.spec} 字` },
        { status: 400 },
      );
    }
    if (description && description.length > MAX_LEN.description) {
      return NextResponse.json(
        { error: `說明不可超過 ${MAX_LEN.description} 字` },
        { status: 400 },
      );
    }

    const categoryNum = Number(categoryId);
    if (!Number.isInteger(categoryNum) || categoryNum <= 0) {
      return NextResponse.json({ error: "請選擇分類" }, { status: 400 });
    }

    const specVal = spec?.trim() || null;
    const descriptionVal = description?.trim() || null;

    await updateProductDetails(
      id,
      priceNum,
      imageUrl,
      categoryNum,
      specVal,
      descriptionVal,
    );

    if (oldImageUrl && oldImageUrl !== imageUrl) {
      await deleteCloudinaryImage(oldImageUrl);
    }

    await revalidateCache("products");
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to update product:", err);
    return NextResponse.json({ error: "更新商品失敗" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id: idStr } = await params;
    const parsed = parseId(idStr);
    if ("error" in parsed) return parsed.error;
    const { id } = parsed;

    // 刪除前直接查最新的 image_url，避免用到過時的快取資料
    const imageUrl = await getProductImageUrl(id);

    await deleteProduct(id);

    // DB 記錄刪除成功後才清理 Cloudinary 圖片
    if (imageUrl) {
      await deleteCloudinaryImage(imageUrl);
    }

    await revalidateCache("products");
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to delete product:", err);
    return NextResponse.json({ error: "刪除商品失敗" }, { status: 500 });
  }
}
