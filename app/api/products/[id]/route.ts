import {
  deleteProduct,
  getProductImageUrls,
  saveProductImages,
  updateProductDetails,
} from "@/app/lib/products";
import { badRequest, jsonHandler } from "@/app/lib/api";
import { deleteCloudinaryImage } from "@/app/lib/cloudinary";
import { revalidateCache } from "@/app/lib/revalidate";
import {
  parseId,
  validateProductBody,
  validateProductImages,
} from "@/app/lib/validation";

type Params = { params: Promise<{ id: string }> };

export const PUT = jsonHandler<Params>(async (request, { params }) => {
  const { id: idStr } = await params;
  const parsedId = parseId(idStr);
  if ("error" in parsedId) return badRequest(parsedId.error);
  const { id } = parsedId;

  const body = await request.json();
  const parsed = validateProductBody(body, { requireName: false });
  if ("error" in parsed) return badRequest(parsed.error);
  const p = parsed.value;

  const images = validateProductImages((body as { imageUrls?: unknown }).imageUrls);
  if ("error" in images) return badRequest(images.error);
  const newImageUrls = images.value;

  // 先取舊圖集合以便算差集，再原子寫入新集合（含封面鏡射）與其餘欄位。
  const oldImageUrls = await getProductImageUrls(id);
  await saveProductImages(id, newImageUrls);
  await updateProductDetails(
    id,
    p.price,
    p.categoryId,
    p.spec,
    p.description,
    p.promoType,
    p.promoConfig,
    p.stock,
  );

  // 刪除「舊有但已不在新集合」的圖，避免 Cloudinary 孤兒；不誤刪仍在用的圖。
  const removed = oldImageUrls.filter((url) => !newImageUrls.includes(url));
  await Promise.all(removed.map((url) => deleteCloudinaryImage(url)));

  await revalidateCache("products");
  return { success: true };
}, "更新商品失敗");

export const DELETE = jsonHandler<Params>(async (_request, { params }) => {
  const { id: idStr } = await params;
  const parsed = parseId(idStr);
  if ("error" in parsed) return badRequest(parsed.error);
  const { id } = parsed;

  // 先取全部圖 URL，刪商品（CASCADE 清 product_images）後再刪 Cloudinary 全部檔。
  const imageUrls = await getProductImageUrls(id);

  await deleteProduct(id);

  await Promise.all(imageUrls.map((url) => deleteCloudinaryImage(url)));

  await revalidateCache("products");
  await revalidateCache("categories");
  return { success: true };
}, "刪除商品失敗");
