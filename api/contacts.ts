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
      location: contacts.location,
      latitude: contacts.latitude,
      longitude: contacts.longitude,
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

    // Location coordinates (Defaults to McKinney, TX 75071)
    const lat = url.searchParams.get("lat") ? parseFloat(url.searchParams.get("lat")!) : 33.1972;
    const lon = url.searchParams.get("lon") ? parseFloat(url.searchParams.get("lon")!) : -96.6398;
    const radius = url.searchParams.get("radius") ? parseFloat(url.searchParams.get("radius")!) : 25;

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

    // Apply PostgreSQL earthdistance 25-mile radius filter
    if (lat && lon) {
      filter = sql<boolean>`${filter} and (
        ${contacts.latitude} is not null 
        and ${contacts.longitude} is not null 
        and (point(${contacts.longitude}::float8, ${contacts.latitude}::float8) <@> point(${lon}::float8, ${lat}::float8)) <= ${radius}
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
          location: contacts.location,
          latitude: contacts.latitude,
          longitude: contacts.longitude,
          createdAt: contacts.createdAt,
          categoryId: contacts.categoryId,
          categorySlug: categories.slug,
          categoryName: categories.name,
          reviewCount: sql<number>`count(${reviews.id})::int`,
          averageRating: sql<number>`coalesce(avg(${reviews.rating}), 0)::float`,
          distanceMiles: sql<number>`(point(${contacts.longitude}::float8, ${contacts.latitude}::float8) <@> point(${lon}::float8, ${lat}::float8))::float`,
        })
        .from(contacts)
        .innerJoin(categories, eq(contacts.categoryId, categories.id))
        .leftJoin(reviews, eq(reviews.contactId, contacts.id))
        .where(filter)
        .groupBy(contacts.id, categories.id)
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
    const { 
      name, 
      phone, 
      categorySlug, 
      businessName, 
      pricing, 
      notes, 
      addedBy, 
      source, 
      location, 
      latitude: clientLat, 
      longitude: clientLon 
    } = body;

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

    let latitude = clientLat ? parseFloat(clientLat) : 33.1972;
    let longitude = clientLon ? parseFloat(clientLon) : -96.6398;
    let locationTag = location || "McKinney, TX 75071";

    // Optional forward-geocoding fallback if custom location string provided without coordinates
    if ((!clientLat || !clientLon) && location) {
      try {
        const geoRes = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(location)}`,
          { headers: { "User-Agent": "HighlandLakesDirectory/1.0" } }
        );
        const geoData = await geoRes.json();
        if (geoData && geoData.length > 0) {
          latitude = parseFloat(geoData[0].lat);
          longitude = parseFloat(geoData[0].lon);
        }
      } catch (err) {
        console.error("Geocoding fallback failed:", err);
      }
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
        location: locationTag,
        latitude,
        longitude,
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