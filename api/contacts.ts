import { db } from "../db/index.js";
import { categories, contacts, reviews } from "../db/schema.js";
import { eq, desc, sql } from "drizzle-orm";

function normalizePhone(raw: unknown) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function sanitizePhone(raw: unknown) {
  const rawValue = String(raw ?? "");
  const hasLeadingPlus = /^\s*\+/.test(rawValue);
  const phoneBody = rawValue
    .replace(/[^\d().\-\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${hasLeadingPlus ? "+" : ""}${phoneBody}`;
}

async function getContactWithStats(contactId: number) {
  const [contact] = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      phone: contacts.phone,
      businessName: contacts.businessName,
      pricing: contacts.pricing,
      notes: contacts.notes,
      addedBy: contacts.addedBy,
      source: contacts.source,
      createdAt: contacts.createdAt,
      categoryId: contacts.categoryId,
      categorySlug: categories.slug,
      categoryName: categories.name,
    })
    .from(contacts)
    .innerJoin(categories, eq(contacts.categoryId, categories.id))
    .where(eq(contacts.id, contactId));

  if (!contact) return null;

  const stats = await db
    .select({
      count: sql<number>`count(*)::int`,
      avg: sql<number>`coalesce(avg(${reviews.rating}), 0)::float`,
    })
    .from(reviews)
    .where(eq(reviews.contactId, contactId));

  return {
    ...contact,
    reviewCount: stats[0]?.count ?? 0,
    averageRating: stats[0]?.avg ?? 0,
  };
}

export default async function handler(req: Request) {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const categorySlug = url.searchParams.get("category");
    const search = url.searchParams.get("search")?.trim().toLowerCase();
    const requestedLimit = Number(url.searchParams.get("limit"));
    const requestedOffset = Number(url.searchParams.get("offset"));
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 100) : 24;
    const offset = Number.isFinite(requestedOffset) ? Math.max(Math.trunc(requestedOffset), 0) : 0;
    let filter = sql<boolean>`true`;
    if (categorySlug && categorySlug !== "all") {
      filter = sql<boolean>`${filter} and ${categories.slug} = ${categorySlug}`;
    }
    if (search) {
      filter = sql<boolean>`${filter} and (
        position(${search} in lower(${contacts.name})) > 0
        or position(${search} in lower(coalesce(${contacts.businessName}, ''))) > 0
        or position(${search} in lower(coalesce(${contacts.pricing}, ''))) > 0
        or position(${search} in lower(coalesce(${contacts.notes}, ''))) > 0
        or position(${search} in ${contacts.phone}) > 0
      )`;
    }

    const [rows, totals] = await Promise.all([
      db
        .select({
          id: contacts.id,
          name: contacts.name,
          phone: contacts.phone,
          businessName: contacts.businessName,
          pricing: contacts.pricing,
          notes: contacts.notes,
          addedBy: contacts.addedBy,
          source: contacts.source,
          createdAt: contacts.createdAt,
          categoryId: contacts.categoryId,
          categorySlug: categories.slug,
          categoryName: categories.name,
          reviewCount: sql<number>`coalesce((select count(*) from ${reviews} r where r.contact_id = ${contacts.id}), 0)::int`,
          averageRating: sql<number>`coalesce((select avg(r.rating) from ${reviews} r where r.contact_id = ${contacts.id}), 0)::float`,
        })
        .from(contacts)
        .innerJoin(categories, eq(contacts.categoryId, categories.id))
        .where(filter)
        .orderBy(desc(contacts.createdAt), desc(contacts.id))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(contacts)
        .innerJoin(categories, eq(contacts.categoryId, categories.id))
        .where(filter),
    ]);

    const total = totals[0]?.count ?? 0;

    return Response.json({
      contacts: rows,
      total,
      limit,
      offset,
      hasMore: offset + rows.length < total,
    });
  }

  if (req.method === "POST") {
    const body = await req.json();
    const { name, phone, categorySlug, businessName, pricing, notes, addedBy, source } = body;

    const sanitizedPhone = sanitizePhone(phone);
    const sanitizedPricing = String(pricing ?? "").trim();

    if (!name || !sanitizedPhone || !categorySlug) {
      return Response.json({ error: "Name, phone, and category are required." }, { status: 400 });
    }

    if (sanitizedPricing.length > 160) {
      return Response.json({ error: "Pricing must be 160 characters or fewer." }, { status: 400 });
    }

    const [category] = await db.select().from(categories).where(eq(categories.slug, categorySlug));
    if (!category) {
      return Response.json({ error: "Unknown category." }, { status: 400 });
    }

    const normalizedPhone = normalizePhone(sanitizedPhone);
    if (normalizedPhone.length < 7 || normalizedPhone.length > 15) {
      return Response.json({ error: "That phone number doesn't look valid." }, { status: 400 });
    }

    const [existing] = await db.select().from(contacts).where(eq(contacts.normalizedPhone, normalizedPhone));
    if (existing) {
      const existingWithStats = await getContactWithStats(existing.id);
      return Response.json(
        {
          error: "This number already exists in the directory.",
          existingContact: existingWithStats,
        },
        { status: 409 },
      );
    }

    const [inserted] = await db
      .insert(contacts)
      .values({
        name,
        phone: sanitizedPhone,
        normalizedPhone,
        categoryId: category.id,
        businessName: businessName ?? "",
        pricing: sanitizedPricing,
        notes: notes ?? "",
        addedBy: addedBy ?? "",
        source: source ?? "manual",
      })
      .returning();

    const full = await getContactWithStats(inserted.id);
    return Response.json({ contact: full }, { status: 201 });
  }

  if (req.method === "PATCH") {
    const id = Number(url.searchParams.get("id"));
    if (!id) return Response.json({ error: "Missing id." }, { status: 400 });

    const body = await req.json();
    const sanitizedPricing = String(body.pricing ?? "").trim();
    if (sanitizedPricing.length > 160) {
      return Response.json({ error: "Pricing must be 160 characters or fewer." }, { status: 400 });
    }

    const [updated] = await db
      .update(contacts)
      .set({ pricing: sanitizedPricing })
      .where(eq(contacts.id, id))
      .returning({ id: contacts.id });

    if (!updated) {
      return Response.json({ error: "Contact not found." }, { status: 404 });
    }

    const full = await getContactWithStats(updated.id);
    return Response.json({ contact: full });
  }

  if (req.method === "DELETE") {
    const id = Number(url.searchParams.get("id"));
    if (!id) return Response.json({ error: "Missing id." }, { status: 400 });
    await db.delete(contacts).where(eq(contacts.id, id));
    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
}

export const config = {
  runtime: "edge",
};