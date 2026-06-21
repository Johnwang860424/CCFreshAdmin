// CSV 與檔名相關工具：框架無關（不依賴 DOM 或 next），server route 與 client 頁面共用。

/** 將單一儲存格轉為安全的 CSV 欄位（含逗號/引號/換行時以雙引號包裹並跳脫）。 */
export function escapeCsvCell(value: string | number | null | undefined): string {
  const str = value == null ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/**
 * 將二維陣列組成 CSV 字串，預設前置 UTF-8 BOM 讓 Excel 正確顯示中文。
 * 以 CRLF 斷行（Excel 相容）。
 */
export function buildCsv(
  rows: (string | number | null | undefined)[][],
  { bom = true }: { bom?: boolean } = {},
): string {
  const body = rows.map((cells) => cells.map(escapeCsvCell).join(",")).join("\r\n");
  return bom ? `﻿${body}` : body;
}

/** 台北時區的 YYYY-MM-DD 日期戳，供匯出檔名使用。 */
export function taipeiDateStamp(date = new Date()): string {
  return date
    .toLocaleDateString("zh-TW", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    .replace(/\//g, "-");
}

/** 移除無法用於檔名（或會破壞 Content-Disposition）的字元。 */
export function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}
