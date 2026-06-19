import { revalidateTag } from "next/cache";

export async function revalidateCache(tag: string) {
  revalidateTag(tag, { expire: 0 });

  try {
    await fetch(`${process.env.FRONTEND_URL}/api/revalidate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: process.env.ADMIN_SECRET_TOKEN!,
      },
      body: JSON.stringify({ tag }),
    });
  } catch {
    // 前端暫時無法連線，不阻斷主流程
  }
}
