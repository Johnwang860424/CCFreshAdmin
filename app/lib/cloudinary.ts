import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export { cloudinary };

export function extractPublicId(url: string): string | null {
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-z]+$/i);
  return match ? match[1] : null;
}

export async function deleteCloudinaryImage(url: string): Promise<void> {
  const publicId = extractPublicId(url);
  if (!publicId) {
    console.warn(`[cloudinary] 無法從網址解析 public ID，略過刪除：${url}`);
    return;
  }

  const { result } = await cloudinary.uploader.destroy(publicId);
  if (result !== "ok" && result !== "not found") {
    throw new Error(`Cloudinary 刪除失敗（${publicId}）：${result}`);
  }
  if (result === "not found") {
    console.warn(`[cloudinary] 找不到要刪除的圖片：${publicId}`);
  }
}
