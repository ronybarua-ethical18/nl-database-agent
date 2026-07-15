/**
 * The demo e-commerce schema, as shown to the LLM.
 * Keep this in sync with scripts/seed.ts.
 */
export const SCHEMA_DESCRIPTION = `
Postgres database: demo e-commerce shop.

CREATE TABLE customers (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  email      text NOT NULL UNIQUE,
  country    text NOT NULL,            -- e.g. 'Germany', 'United States'
  created_at timestamptz NOT NULL
);

CREATE TABLE products (
  id       serial PRIMARY KEY,
  name     text NOT NULL,
  category text NOT NULL,              -- e.g. 'Electronics', 'Books', 'Clothing'
  price    numeric(10,2) NOT NULL      -- current list price in USD
);

CREATE TABLE orders (
  id          serial PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES customers(id),
  status      text NOT NULL,           -- 'pending' | 'paid' | 'shipped' | 'delivered' | 'cancelled'
  created_at  timestamptz NOT NULL
);

CREATE TABLE order_items (
  id         serial PRIMARY KEY,
  order_id   integer NOT NULL REFERENCES orders(id),
  product_id integer NOT NULL REFERENCES products(id),
  quantity   integer NOT NULL,
  unit_price numeric(10,2) NOT NULL    -- price actually paid per unit
);

Notes:
- Revenue for an order item = quantity * unit_price.
- Prefer human-readable columns (names over ids) in results.
`.trim();
