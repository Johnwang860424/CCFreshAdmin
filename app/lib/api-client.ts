// 前端共用的 fetch 包裝：統一處理 !res.ok 時從 body 取出後端錯誤訊息，
// 並提供瀏覽器下載 Blob 的工具。僅供 client component 使用。

/** fetch 並解析 JSON；非 2xx 時丟出帶有後端 `error` 訊息的 Error。 */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || "請求失敗");
  }
  return res.json() as Promise<T>;
}

function jsonRequest(method: string) {
  return <T = { success: true }>(url: string, data?: unknown) =>
    fetchJson<T>(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
}

export const postJson = jsonRequest("POST");
export const putJson = jsonRequest("PUT");
export const deleteJson = jsonRequest("DELETE");

/** 觸發瀏覽器下載一個 Blob 為指定檔名。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
