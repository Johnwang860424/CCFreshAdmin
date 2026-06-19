-- 於 Neon SQL Editor 執行一次以建立資料表。

CREATE TABLE products (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  price      INTEGER NOT NULL,
  image_url  TEXT NOT NULL
);

CREATE TABLE pickup_spots (
  id         SERIAL PRIMARY KEY,
  city       TEXT NOT NULL,
  township   TEXT NOT NULL,
  UNIQUE (city, township)
);

-- 本次只建表，暫不接 UI / API（訂單由外部前台寫入，另案處理）
CREATE TABLE orders (
  id             SERIAL PRIMARY KEY,
  customer_name  TEXT NOT NULL,
  phone          TEXT,
  pickup_spot_id INTEGER REFERENCES pickup_spots(id) ON DELETE SET NULL,
  pickup_label   TEXT,                            -- 下單當下自取點快照
  status         TEXT NOT NULL DEFAULT 'pending', -- pending / confirmed / completed / cancelled
  note           TEXT,
  total          INTEGER NOT NULL DEFAULT 0,      -- NT$ 快照總額
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id           SERIAL PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,              -- 下單快照
  unit_price   INTEGER NOT NULL,           -- 下單快照
  quantity     INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE INDEX idx_order_items_order_id ON order_items(order_id);
