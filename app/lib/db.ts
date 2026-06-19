import { neon } from "@neondatabase/serverless";

// Neon serverless HTTP driver — 適合 route handler 內單發查詢。
// 透過 tagged template 自動參數化，避免 SQL injection。
export const sql = neon(process.env.DATABASE_URL!);
