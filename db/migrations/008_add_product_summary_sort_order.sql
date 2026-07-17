-- 008: 商品「統計排序」（路線訂單統計畫面的商品欄順序）。
-- 於 Neon SQL Editor 手動執行一次。
--
-- 初始值直接回填為現有 sort_order（前台排序），之後兩套排序各自獨立維護：
-- 於商品管理頁的「統計排序」模式整批改寫（1-based，同 sort_order 模式），
-- 新增商品時取 MAX(summary_sort_order)+1 排在最後。

ALTER TABLE products
  ADD COLUMN summary_sort_order INTEGER;

UPDATE products SET summary_sort_order = sort_order;

ALTER TABLE products
  ALTER COLUMN summary_sort_order SET NOT NULL;
