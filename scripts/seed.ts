/**
 * Milestone 0 — seed script.
 *
 * Drops and recreates the demo e-commerce schema, then fills it with ~11k
 * realistic rows via @faker-js/faker.
 *
 * Run with: npm run seed  (uses DATABASE_URL_OWNER from .env)
 *
 * Deliberately does NOT import src/lib/db.ts: that module reads DATABASE_URL
 * (the read-only role) and wraps every query in `BEGIN READ ONLY`. Seeding
 * needs write access, so it builds its own client from DATABASE_URL_OWNER.
 *
 * Table grants are not re-applied here — `ALTER DEFAULT PRIVILEGES` on the
 * owner role covers every table it creates. See
 * docs/milestone-0-skeleton-live.md §3 step 2.
 */
import { config } from "dotenv";
import postgres from "postgres";
import { faker } from "@faker-js/faker";
import { SCHEMA_DDL } from "../src/lib/schema";

// Next.js loads `.env.local`, but plain `dotenv/config` reads only `.env` —
// which would leave DATABASE_URL_OWNER undefined here. Load both, first wins.
config({ path: [".env.local", ".env"], quiet: true });

const CUSTOMER_COUNT = 400;
const PRODUCT_COUNT = 80;
const ORDER_COUNT = 3_000;
/** Months of order history, ending with the current (partial) month. */
const MONTHS_BACK = 18;
/** Customers start signing up before the order window so early orders have buyers. */
const CUSTOMER_MONTHS_BACK = 24;
const CHUNK_SIZE = 1_000;

/** Fixed lists keep aggregates readable — faker's full country set is too sparse to group by. */
const COUNTRIES = [
  { weight: 22, value: "United States" },
  { weight: 12, value: "Germany" },
  { weight: 10, value: "United Kingdom" },
  { weight: 8, value: "France" },
  { weight: 7, value: "Canada" },
  { weight: 7, value: "Australia" },
  { weight: 6, value: "Netherlands" },
  { weight: 6, value: "Japan" },
  { weight: 5, value: "Brazil" },
  { weight: 5, value: "India" },
  { weight: 4, value: "Spain" },
  { weight: 4, value: "Sweden" },
];

const CATEGORIES = [
  "Electronics",
  "Books",
  "Clothing",
  "Home & Kitchen",
  "Sports & Outdoors",
  "Toys & Games",
];

type CustomerRow = {
  name: string;
  email: string;
  country: string;
  created_at: Date;
};
type ProductRow = { name: string; category: string; price: string };
type OrderRow = { customer_id: number; status: string; created_at: Date };
type OrderItemRow = {
  order_id: number;
  product_id: number;
  quantity: number;
  unit_price: string;
};

/** Monthly buckets, oldest first. The last bucket ends at `now`, so it is partial. */
function monthBuckets(now: Date): { start: Date; end: Date }[] {
  const buckets: { start: Date; end: Date }[] = [];
  for (let i = MONTHS_BACK; i >= 0; i--) {
    // Date.UTC normalises negative month values into the previous year.
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1),
    );
    const rawEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1),
    );
    buckets.push({ start, end: rawEnd > now ? now : rawEnd });
  }
  return buckets;
}

/**
 * Spread ORDER_COUNT across the buckets with a mild upward trend, so
 * time-series charts have a shape. Every bucket gets orders by construction —
 * including last month, which the headline demo question depends on.
 */
function ordersPerBucket(buckets: { start: Date; end: Date }[]): number[] {
  const weights = buckets.map((b, i) => {
    const trend = 1 + i / (buckets.length - 1); // 1.0 → 2.0
    const monthMs =
      Date.UTC(b.start.getUTCFullYear(), b.start.getUTCMonth() + 1, 1) -
      b.start.getTime();
    const elapsed = (b.end.getTime() - b.start.getTime()) / monthMs; // <1 for the current month
    return trend * elapsed;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map((w) =>
    Math.max(1, Math.floor((w / total) * ORDER_COUNT)),
  );
  // Hand any rounding remainder to the most recent full month.
  const remainder = ORDER_COUNT - counts.reduce((a, b) => a + b, 0);
  if (remainder > 0) counts[counts.length - 2] += remainder;
  return counts;
}

function statusFor(created: Date, now: Date): string {
  if (faker.number.int({ min: 1, max: 100 }) <= 5) return "cancelled";
  const ageDays = (now.getTime() - created.getTime()) / 86_400_000;
  if (ageDays > 60) {
    return faker.helpers.weightedArrayElement([
      { weight: 9, value: "delivered" },
      { weight: 1, value: "shipped" },
    ]);
  }
  if (ageDays > 21) {
    return faker.helpers.weightedArrayElement([
      { weight: 5, value: "delivered" },
      { weight: 4, value: "shipped" },
      { weight: 1, value: "paid" },
    ]);
  }
  if (ageDays > 7) {
    return faker.helpers.weightedArrayElement([
      { weight: 4, value: "shipped" },
      { weight: 4, value: "paid" },
      { weight: 2, value: "pending" },
    ]);
  }
  return faker.helpers.weightedArrayElement([
    { weight: 5, value: "pending" },
    { weight: 4, value: "paid" },
    { weight: 1, value: "shipped" },
  ]);
}

/** Number of entries <= t in an ascending array. */
function countAtMost(sorted: number[], t: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

async function insertChunked(
  sql: postgres.Sql,
  table: string,
  rows: Record<string, unknown>[],
  columns: string[],
): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const inserted = await sql`
      insert into ${sql(table)} ${sql(chunk, ...columns)}
      returning id
    `;
    for (const row of inserted) ids.push(row.id as number);
  }
  return ids;
}

async function main() {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) {
    console.error(
      "DATABASE_URL_OWNER is not set. Copy .env.example to .env and fill in the\n" +
        "owner connection string (the read-only DATABASE_URL cannot create tables).",
    );
    process.exit(1);
  }

  // Reproducible rows: reseed and you get the same data back, which makes
  // "reproduce the bug" possible. The now() anchor below still moves.
  faker.seed(42);

  const sql = postgres(url, {
    max: 1,
    connect_timeout: 30,
    onnotice: () => {}, // silence "table does not exist, skipping"
  });

  try {
    const now = new Date();

    console.log("dropping and recreating tables…");
    await sql.unsafe(
      "drop table if exists order_items, orders, products, customers cascade",
    );
    await sql.unsafe(SCHEMA_DDL);

    // ---- customers -------------------------------------------------------
    const customerWindowStart = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth() - CUSTOMER_MONTHS_BACK,
        1,
      ),
    );
    const customers: CustomerRow[] = Array.from(
      { length: CUSTOMER_COUNT },
      (_, i) => {
        const name = faker.person.fullName();
        return {
          name,
          // faker does not guarantee unique emails; customers.email is UNIQUE.
          email: faker.internet
            .email({ firstName: name.split(" ")[0] })
            .replace("@", `+${i}@`)
            .toLowerCase(),
          country: faker.helpers.weightedArrayElement(COUNTRIES),
          created_at: faker.date.between({ from: customerWindowStart, to: now }),
        };
      },
    ).sort((a, b) => a.created_at.getTime() - b.created_at.getTime());

    const customerIds = await insertChunked(sql, "customers", customers, [
      "name",
      "email",
      "country",
      "created_at",
    ]);
    const signupTimes = customers.map((c) => c.created_at.getTime());
    console.log(`  customers    ${customerIds.length}`);

    // ---- products --------------------------------------------------------
    const usedNames = new Set<string>();
    const products: ProductRow[] = [];
    while (products.length < PRODUCT_COUNT) {
      const name = faker.commerce.productName();
      if (usedNames.has(name)) continue;
      usedNames.add(name);
      products.push({
        name,
        category: faker.helpers.arrayElement(CATEGORIES),
        price: faker.commerce.price({ min: 5, max: 600, dec: 2 }),
      });
    }
    const productIds = await insertChunked(sql, "products", products, [
      "name",
      "category",
      "price",
    ]);
    console.log(`  products     ${productIds.length}`);

    // Zipf-ish popularity so "top 5 products" has a clear, stable answer
    // instead of a coin flip between 80 near-identical products.
    const productPool = productIds.map((id, i) => ({
      weight: Math.max(1, Math.round(100 / (i + 1))),
      value: { id, price: Number(products[i].price) },
    }));

    // ---- orders ----------------------------------------------------------
    const buckets = monthBuckets(now);
    const perBucket = ordersPerBucket(buckets);
    const orders: OrderRow[] = [];
    buckets.forEach((bucket, bi) => {
      for (let i = 0; i < perBucket[bi]; i++) {
        const createdAt = faker.date.between({
          from: bucket.start,
          to: bucket.end,
        });
        // Only customers who had signed up by then can place the order.
        const eligible = countAtMost(signupTimes, createdAt.getTime());
        const customerIndex =
          eligible > 0 ? faker.number.int({ min: 0, max: eligible - 1 }) : 0;
        orders.push({
          customer_id: customerIds[customerIndex],
          status: statusFor(createdAt, now),
          created_at: createdAt,
        });
      }
    });
    const orderIds = await insertChunked(sql, "orders", orders, [
      "customer_id",
      "status",
      "created_at",
    ]);
    console.log(`  orders       ${orderIds.length}`);

    // ---- order_items -----------------------------------------------------
    const items: OrderItemRow[] = [];
    for (const orderId of orderIds) {
      const lineCount = faker.helpers.weightedArrayElement([
        { weight: 4, value: 1 },
        { weight: 3, value: 2 },
        { weight: 2, value: 3 },
        { weight: 1, value: 4 },
      ]);
      const seen = new Set<number>();
      for (let i = 0; i < lineCount; i++) {
        const product = faker.helpers.weightedArrayElement(productPool);
        if (seen.has(product.id)) continue; // no duplicate product per order
        seen.add(product.id);
        // ~20% of lines are discounted, which is why unit_price exists at all
        // and why revenue must be computed from it, not products.price.
        const discounted = faker.number.int({ min: 1, max: 100 }) <= 20;
        const factor = discounted
          ? 1 - faker.number.int({ min: 5, max: 25 }) / 100
          : 1;
        items.push({
          order_id: orderId,
          product_id: product.id,
          quantity: faker.helpers.weightedArrayElement([
            { weight: 6, value: 1 },
            { weight: 3, value: 2 },
            { weight: 1, value: 3 },
          ]),
          unit_price: (product.price * factor).toFixed(2),
        });
      }
    }
    const itemIds = await insertChunked(sql, "order_items", items, [
      "order_id",
      "product_id",
      "quantity",
      "unit_price",
    ]);
    console.log(`  order_items  ${itemIds.length}`);

    // ---- the sanity check the demo depends on ----------------------------
    const [lastMonth] = await sql`
      select count(*)::int as lines,
             coalesce(sum(oi.quantity), 0)::int as units
      from orders o
      join order_items oi on oi.order_id = o.id
      where o.created_at >= date_trunc('month', now()) - interval '1 month'
        and o.created_at <  date_trunc('month', now())
    `;
    console.log(
      `\nlast month: ${lastMonth.lines} order lines, ${lastMonth.units} units sold`,
    );
    if (lastMonth.lines === 0) {
      console.error(
        "WARNING: last month has no orders — the demo question " +
          '"top 5 products sold last month" will return nothing.',
      );
      process.exitCode = 1;
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("seed failed:", err);
  process.exit(1);
});
