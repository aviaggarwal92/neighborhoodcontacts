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
  // ...unchanged, identical to your original file...
}

export default async function handler(req: Request) {
  const url = new URL(req.url);

  if (req.method === "GET") {
    // ...unchanged logic...
  }

  if (req.method === "POST") {
    // ...unchanged logic...
  }

  if (req.method === "PATCH") {
    // ...unchanged logic...
  }

  if (req.method === "DELETE") {
    // ...unchanged logic...
  }

  return new Response("Method not allowed", { status: 405 });
}

export const config = {
  runtime: "edge",
};