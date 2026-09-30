import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);

  // GET: Fetch contacts (Filtered by 25-mile radius if lat/lon provided)
  if (req.method === "GET") {
    const { lat, lon, radius = 25 } = req.query;

    if (lat && lon) {
      const userLat = parseFloat(lat);
      const userLon = parseFloat(lon);
      const maxMiles = parseFloat(radius);

      const contacts = await sql`
        SELECT 
          id, name, business_name AS "businessName", pricing, phone, location, 
          category_slug AS "categorySlug", notes, added_by AS "addedBy",
          (point(longitude, latitude) <@> point(${userLon}, ${userLat})) AS "distanceMiles"
        FROM contacts
        WHERE latitude IS NOT NULL 
          AND longitude IS NOT NULL
          AND (point(longitude, latitude) <@> point(${userLon}, ${userLat})) <= ${maxMiles}
        ORDER BY "distanceMiles" ASC;
      `;
      return res.status(200).json(contacts);
    }

    const allContacts = await sql`
      SELECT id, name, business_name AS "businessName", pricing, phone, location, category_slug AS "categorySlug", notes, added_by AS "addedBy"
      FROM contacts
      ORDER BY id DESC;
    `;
    return res.status(200).json(allContacts);
  }

  // POST: Add new contact & auto-save location and coordinates
  if (req.method === "POST") {
    const { name, businessName, pricing, phone, location, latitude: clientLat, longitude: clientLon, categorySlug, notes, addedBy } = req.body;

    let latitude = clientLat || null;
    let longitude = clientLon || null;

    // Fallback forward-geocode if client coordinates weren't supplied but a custom address string was
    if ((!latitude || !longitude) && location) {
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
        console.error("Geocoding failed:", err);
      }
    }

    const inserted = await sql`
      INSERT INTO contacts (name, business_name, pricing, phone, location, latitude, longitude, category_slug, notes, added_by)
      VALUES (${name}, ${businessName}, ${pricing}, ${phone}, ${location}, ${latitude}, ${longitude}, ${categorySlug}, ${notes}, ${addedBy})
      RETURNING id;
    `;

    return res.status(201).json({ success: true, id: inserted[0].id });
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}