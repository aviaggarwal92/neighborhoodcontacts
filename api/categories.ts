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

export default async function handler(req: Request) {
  if (req.method === "GET") {
    const rows = await db.select().from(categories).orderBy(categories.id);
    return Response.json({ categories: rows });
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const name = normalizeCategoryName(body.name);
    const slug = categorySlug(name);

    if (name.length < 2 || name.length > 60 || !slug) {
      return Response.json({ error: "Enter a category name between 2 and 60 characters." }, { status: 400 });
    }

    const existing = await findDuplicate(name);
    if (existing) {
      return Response.json(
        { error: `"${existing.name}" already exists.`, existingCategory: existing },
        { status: 409 },
      );
    }

    for (let suffix = 1; ; suffix += 1) {
      const availableSlug = suffix === 1 ? slug : `${slug}-${suffix}`;
      if (await slugExists(availableSlug)) continue;

      try {
        const [category] = await db
          .insert(categories)
          .values({ name, slug: availableSlug, icon: "star" })
          .returning();
        return Response.json({ category }, { status: 201 });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;

        const duplicate = await findDuplicate(name);
        if (duplicate) {
          return Response.json(
            { error: `"${duplicate.name}" already exists.`, existingCategory: duplicate },
            { status: 409 },
          );
        }
      }
    }
  }

  return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
}

export const config = {
  runtime: "edge",
};