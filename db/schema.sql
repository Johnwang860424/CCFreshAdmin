-- 於 Neon SQL Editor 執行一次以建立資料表。

CREATE TABLE categories (
  id    SERIAL PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE
);

CREATE TABLE products (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  price        INTEGER NOT NULL,
  image_url    TEXT NOT NULL,
  category_id  INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
  spec         TEXT,
  description  TEXT,
  promo_type   TEXT,
  promo_config JSONB
);

CREATE TABLE pickup_spots (
  id         SERIAL PRIMARY KEY,
  city       TEXT NOT NULL,
  township   TEXT NOT NULL,
  UNIQUE (city, township)
);

CREATE TABLE orders (
  id               SERIAL PRIMARY KEY,
  customer_name    TEXT NOT NULL,
  phone            TEXT,
  delivery_method  TEXT NOT NULL DEFAULT 'pickup',
  -- 自取點以 FK 連結；ON DELETE RESTRICT 確保仍有訂單引用的取貨點無法被刪除。
  pickup_spot_id   INTEGER REFERENCES pickup_spots(id) ON DELETE RESTRICT,
  -- 現場取貨號碼牌：每個取貨點各自從 1 遞增（宅配訂單為 NULL）。
  -- 號碼作用域為單一取貨點，跨點可重複，故唯一鍵為 (pickup_spot_id, pickup_number)。
  -- 寫入端約定：pickup_number = (SELECT COALESCE(MAX(pickup_number),0)+1
  --   FROM orders WHERE pickup_spot_id = $spot)，撞唯一鍵時重試。
  -- 結單會刪除該分組訂單，故每檔團購結單後號碼自然歸 1。
  pickup_number    INTEGER,
  shipping_address TEXT,
  note             TEXT,
  total            INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pickup_spot_id, pickup_number)
);

CREATE TABLE order_items (
  id           SERIAL PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  unit_price   INTEGER NOT NULL,                       -- 單品原價快照（未折扣）
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  promo_type   TEXT,                                   -- 下單當下的促銷快照（NULL = 無促銷）
  promo_config JSONB,
  subtotal     INTEGER NOT NULL CHECK (subtotal >= 0)  -- 折扣後的實付小計；不可由 unit_price×quantity 推算
);

CREATE INDEX idx_order_items_order_id ON order_items(order_id);