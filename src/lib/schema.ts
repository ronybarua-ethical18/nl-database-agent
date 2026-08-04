/**
 * The demo e-commerce schema.
 *
 * SCHEMA_DDL is the single source of truth: `scripts/seed.ts` executes it to
 * create the real tables, and SCHEMA_DESCRIPTION (built from it below) is the
 * text shown to the LLM. Keeping one copy means the prompt cannot drift from
 * the database — a drift that would surface as quietly degraded accuracy
 * rather than as an error.
 */

/** Executable Postgres. The `--` column notes are real SQL comments. */
export const SCHEMA_DDL = `
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
`.trim();

/** Tables in dependency order — children last. Used for DROP/TRUNCATE ordering. */
export const TABLES = ["customers", "products", "orders", "order_items"] as const;

export const SCHEMA_DESCRIPTION = `
Postgres database: demo e-commerce shop.

${SCHEMA_DDL}

Notes:
- Revenue for an order item = quantity * unit_price.
- unit_price is the price actually paid and may differ from products.price
  (discounts), so revenue must be computed from order_items.unit_price.
- Cancelled orders (status = 'cancelled') are still rows in orders; exclude
  them when the question is about actual sales or revenue.
- Prefer human-readable columns (names over ids) in results.
`.trim();
