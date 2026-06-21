import {
  deleteProduct,
  getProductImageUrl,
  updateProductDetails,
} from "@/app/lib/products";
import { jsonHandler } from "@/app/lib/api";
import { deleteCloudinaryImage } from "@/app/lib/cloudinary";
import { revalidateCache } from "@/app/lib/revalidate";
import { parseId, validateProductBody } from "@/app/lib/validation";

type Params = { params: Promise<{ id: string }> };

export const PUT = jsonHandler<Params>(async (request, { params }) => {
  const { id: idStr } = await params;
  const parsedId = parseId(idStr);
  if ("error" in parsedId) return parsedId.error;
  const { id } = parsedId;

  const body = await request.json();
  const parsed = validateProductBody(body, { requireName: false });
  if ("error" in parsed) return parsed.error;
  const p = parsed.value;

  const { oldImageUrl } = body as { oldImageUrl?: string };

  await updateProductDetails(
    id,
    p.price,
    p.imageUrl,
    p.categoryId,
    p.spec,
    p.description,
    p.promoType,
    p.promoConfig,
  );

  if (oldImageUrl && oldImageUrl !== p.imageUrl) {
    await deleteCloudinaryImage(oldImageUrl);
  }

  await revalidateCache("products");
  return { success: true };
}, "更新商品失敗");

export const DELETE = jsonHandler<Params>(async (_request, { params }) => {
  const { id: idStr } = await params;
  const parsed = parseId(idStr);
  if ("error" in parsed) return parsed.error;
  const { id } = parsed;

  const imageUrl = await getProductImageUrl(id);

  await deleteProduct(id);

  if (imageUrl) {
    await deleteCloudinaryImage(imageUrl);
  }

  await revalidateCache("products");
  await revalidateCache("categories");
  return { success: true };
}, "刪除商品失敗");
