import { db } from "../db/index.js";
import { categories } from "../db/schema.js";
import { sql } from "drizzle-orm";

function normalizeCategoryName(raw: unknown) {
  return String(raw ?? "").trim().replace(/\s+/g, " ");
}

function categorySlug(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function findDuplicate(name: string) {
  const [existing] = await db
    .select()
    .from(categories)
    .where(
      sql`lower(regexp_replace(trim(${categories.name}), '[[:space:]]+', ' ', 'g')) = lower(${name})`,
    )
    .limit(1);
  return existing;
}

async function slugExists(slug: string) {
  const [existing] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(sql`${categories.slug} = ${slug}`)
    .limit(1);
  return Boolean(existing);
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueViolation(error.cause);
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const rows = await db.select().from(categories).orderBy(categories.id);
      return res.status(200).json({ categories: rows });
    } catch (error) {
      console.error("Fetch categories error:", error);
      return res.status(500).json({ error: "Failed to load categories." });
    }
  }

  if (req.method === "POST") {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const name = normalizeCategoryName(body.name);
    const slug = categorySlug(name);

    if (name.length < 2 || name.length > 60 || !slug) {
      return res.status(400).json({ error: "Enter a category name between 2 and 60 characters." });
    }

    const existing = await findDuplicate(name);
    if (existing) {
      return res.status(409).json({
        error: `"${existing.name}" already exists.`,
        existingCategory: existing,
      });
    }

    for (let suffix = 1; ; suffix += 1) {
      const availableSlug = suffix === 1 ? slug : `${slug}-${suffix}`;
      if (await slugExists(availableSlug)) continue;

      try {
        const [category] = await db
          .insert(categories)
          .values({ name, slug: availableSlug, icon: "star" })
          .returning();
        return res.status(201).json({ category });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;

        const duplicate = await findDuplicate(name);
        if (duplicate) {
          return res.status(409).json({
            error: `"${duplicate.name}" already exists.`,
            existingCategory: duplicate,
          });
        }
      }
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end("Method not allowed");
}