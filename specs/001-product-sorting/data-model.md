# Phase 1 Data Model: 商品排序功能

## Entity: products（既有，新增一欄）

| 欄位 | 型別 | 說明 |
|------|------|------|
| `sort_order` | `INTEGER NOT NULL` | 全域顯示順序鍵，數值小者在前。新環境由 schema 建立；既有環境由 migration 回填。 |

- **排序語意**: `ORDER BY sort_order, id`（`id` 為 tie-breaker，保險用）。
- **唯一性**: 由應用層保證連續且唯一（migration 回填唯一、reorder 重寫唯一、新增取 MAX+1）；不加 DB UNIQUE 約束，以容忍重排當下的瞬時狀態並簡化單語句更新。
- **Index**: `CREATE INDEX idx_products_sort_order ON products(sort_order);`

### Validation rules

- reorder 輸入 `ids`：非空整數陣列、元素皆為正整數、陣列內不重複。
- 不存在於 DB 的 id 於更新時自然略過（`WHERE p.id = v.id`），不視為錯誤。

## Migration（既有環境，一次性，於 Neon SQL Editor 執行）

```sql
ALTER TABLE products ADD COLUMN sort_order INTEGER;
UPDATE products SET sort_order = id;            -- 以既有建立序回填
ALTER TABLE products ALTER COLUMN sort_order SET NOT NULL;
CREATE INDEX idx_products_sort_order ON products(sort_order);
```

## schema.sql（新環境）

`products` 定義中加入：

```sql
  sort_order   INTEGER NOT NULL,
```

並於檔末加 index 建立語句。

## 資料層介面（app/lib/products.ts）

- `ProductRow` 增加 `sortOrder: number`，`toProductRow` 對應 `row.sort_order`。
- `getProducts` 的 SELECT 加 `p.sort_order`，`ORDER BY p.sort_order, p.id`。
- `addProduct` 的 INSERT 加 `sort_order`，值為 `(SELECT COALESCE(MAX(sort_order),0)+1 FROM products)`。
- 新增 `reorderProducts(ids: number[]): Promise<void>`，執行 Decision 3 的單語句 UPDATE。
