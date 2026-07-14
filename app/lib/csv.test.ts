import { describe, expect, it } from "vitest";
import { buildCsv, escapeCsvCell, safeFilename, taipeiDateStamp } from "./csv";

describe("escapeCsvCell", () => {
  it("一般值原樣輸出，null/undefined 轉空字串", () => {
    expect(escapeCsvCell("abc")).toBe("abc");
    expect(escapeCsvCell(123)).toBe("123");
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });

  it("含逗號/引號/換行時以雙引號包裹並跳脫內部引號", () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('說"引號"')).toBe('"說""引號"""');
    expect(escapeCsvCell("兩\n行")).toBe('"兩\n行"');
  });
});

describe("buildCsv", () => {
  it("預設前置 UTF-8 BOM 並以 CRLF 斷行", () => {
    const csv = buildCsv([
      ["名稱", "數量"],
      ["蘋果", 3],
    ]);
    expect(csv).toBe("﻿名稱,數量\r\n蘋果,3");
  });

  it("bom: false 時不加 BOM", () => {
    expect(buildCsv([["a"]], { bom: false })).toBe("a");
  });
});

describe("taipeiDateStamp", () => {
  it("以台北時區輸出 YYYY-MM-DD（UTC 深夜已跨日）", () => {
    // UTC 2026-07-13 20:00 = 台北 2026-07-14 04:00
    expect(taipeiDateStamp(new Date("2026-07-13T20:00:00Z"))).toBe("2026-07-14");
  });
});

describe("safeFilename", () => {
  it("移除檔名非法字元", () => {
    expect(safeFilename('訂單_2026:07*14?.xlsx')).toBe("訂單_2026_07_14_.xlsx");
    expect(safeFilename('a\\b/c<d>e|f"g')).toBe("a_b_c_d_e_f_g");
  });
});
