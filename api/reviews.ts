import { db } from "../db/index.js";
import { reviews, contacts } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";

export default async function handler(req: Request) {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const contactId = Number(url.searchParams.get("contactId"));
    if (!contactId) return Response.json({ error: "Missing contactId." }, { status: 400 });
    const rows = await db.select().from(reviews).where(eq(reviews.contactId, contactId)).orderBy(desc(reviews.createdAt));
    return Response.json({ reviews: rows });
  }

  if (req.method === "POST") {
    const body = await req.json();
    const { contactId, author, rating, comment } = body;

    if (!contactId || !author || !rating) {
      return Response.json({ error: "Contact, name, and rating are required." }, { status: 400 });
    }
    const ratingNum = Number(rating);
    if (ratingNum < 1 || ratingNum > 5) {
      return Response.json({ error: "Rating must be between 1 and 5." }, { status: 400 });
    }

    const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
    if (!contact) {
      return Response.json({ error: "Contact not found." }, { status: 404 });
    }

    const [inserted] = await db
      .insert(reviews)
      .values({ contactId, author, rating: ratingNum, comment: comment ?? "" })
      .returning();

    return Response.json({ review: inserted }, { status: 201 });
  }

  return new Response("Method not allowed", { status: 405 });
}

export const config = {
  runtime: "edge",
};