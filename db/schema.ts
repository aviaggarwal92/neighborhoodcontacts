import { sql } from "drizzle-orm";
import { pgTable, serial, text, timestamp, integer, uniqueIndex, index } from "drizzle-orm/pg-core";

export const categories = pgTable(
  "categories",
  {
    id: serial().primaryKey(),
    slug: text().notNull().unique(),
    name: text().notNull(),
    icon: text().notNull().default("wrench"),
  },
  (table) => [
    uniqueIndex("categories_normalized_name_idx").on(
      sql`lower(regexp_replace(trim(${table.name}), '[[:space:]]+', ' ', 'g'))`,
    ),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: serial().primaryKey(),
    name: text().notNull(),
    phone: text().notNull(),
    normalizedPhone: text("normalized_phone").notNull(),
    categoryId: integer("category_id").notNull().references(() => categories.id),
    businessName: text("business_name").default(""),
    pricing: text().default(""),
    notes: text().default(""),
    addedBy: text("added_by").default(""),
    source: text().default("manual"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("contacts_normalized_phone_idx").on(table.normalizedPhone),
    index("contacts_created_at_id_idx").on(table.createdAt, table.id),
    index("contacts_category_created_at_id_idx").on(table.categoryId, table.createdAt, table.id),
  ],
);

export const reviews = pgTable(
  "reviews",
  {
    id: serial().primaryKey(),
    contactId: integer("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    author: text().notNull(),
    rating: integer().notNull(),
    comment: text().default(""),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [index("reviews_contact_id_idx").on(table.contactId)],
);
