document.addEventListener("DOMContentLoaded", () => {
  let activeUserLocation = null;
  let is25MileActive = false;

  const locationFilterBtn = document.getElementById("locationFilterBtn");
  const fabAdd = document.getElementById("fabAdd");
  const manualForm = document.getElementById("manualForm");
  const photoForm = document.getElementById("photoForm");

  // Automatically fetch current location when opening the "Add Contact" sheet
  if (fabAdd) {
    fabAdd.addEventListener("click", () => {
      autoFetchUserLocation();
    });
  }

  function autoFetchUserLocation() {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;

          // Set hidden coordinate fields
          document.getElementById("manualLat").value = lat;
          document.getElementById("manualLon").value = lon;
          document.getElementById("photoLat").value = lat;
          document.getElementById("photoLon").value = lon;

          // Reverse geocode lat/lon into readable address/city
          try {
            const res = await fetch(
              `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`
            );
            const data = await res.json();
            const city = data.address?.city || data.address?.town || data.address?.village || data.address?.county || "";
            const state = data.address?.state || "";
            const readableLoc = city && state ? `${city}, ${state}` : data.display_name?.split(",")[0] || "Current Location";

            document.getElementById("manualLocation").value = readableLoc;
            document.getElementById("photoLocation").value = readableLoc;
          } catch (err) {
            console.error("Reverse geocoding error:", err);
            document.getElementById("manualLocation").placeholder = "e.g., Plano, TX";
            document.getElementById("photoLocation").placeholder = "e.g., Plano, TX";
          }
        },
        (err) => {
          console.warn("Location permission denied or unavailable:", err);
          document.getElementById("manualLocation").placeholder = "e.g., Plano, TX";
          document.getElementById("photoLocation").placeholder = "e.g., Plano, TX";
        }
      );
    }
  }

  // Toggle 25-Mile Radius Filter
  if (locationFilterBtn) {
    locationFilterBtn.addEventListener("click", () => {
      if (!is25MileActive) {
        if ("geolocation" in navigator) {
          locationFilterBtn.innerText = "⏳ Detecting location…";
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              activeUserLocation = {
                lat: pos.coords.latitude,
                lon: pos.coords.longitude
              };
              is25MileActive = true;
              locationFilterBtn.innerText = "📍 Within 25 mi (Active)";
              locationFilterBtn.classList.add("active");
              fetchContacts();
            },
            (err) => {
              alert("Could not access location. Please enable location permissions.");
              locationFilterBtn.innerText = "📍 Within 25 miles";
            }
          );
        } else {
          alert("Geolocation is not supported by your browser.");
        }
      } else {
        is25MileActive = false;
        activeUserLocation = null;
        locationFilterBtn.innerText = "📍 Within 25 miles";
        locationFilterBtn.classList.remove("active");
        fetchContacts();
      }
    });
  }

  // Fetch contacts from Vercel API endpoint
  async function fetchContacts() {
    let url = "/api/contacts";
    if (is25MileActive && activeUserLocation) {
      url += `?lat=${activeUserLocation.lat}&lon=${activeUserLocation.lon}&radius=25`;
    }
    try {
      const res = await fetch(url);
      const data = await res.json();
      renderContactList(data);
    } catch (err) {
      console.error("Failed to load contacts:", err);
    }
  }

  function renderContactItem(contact) {
    const li = document.createElement("li");
    li.className = "contact-card";

    let locationTag = "";
    if (contact.location) {
      locationTag = `<div class="contact-location">📍 ${escapeHtml(contact.location)}</div>`;
    }

    let distanceTag = "";
    if (contact.distanceMiles !== undefined) {
      distanceTag = `<span class="distance-badge">${Math.round(contact.distanceMiles)} mi away</span>`;
    }

    li.innerHTML = `
      <div class="contact-header">
        <h3>${escapeHtml(contact.name)}</h3>
        ${distanceTag}
      </div>
      ${contact.businessName ? `<p class="business-name">${escapeHtml(contact.businessName)}</p>` : ""}
      ${locationTag}
      <a href="tel:${escapeHtml(contact.phone)}" class="contact-phone">${escapeHtml(contact.phone)}</a>
    `;
    return li;
  }

  if (manualForm) {
    manualForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const formData = new FormData(manualForm);
      const payload = {
        name: formData.get("name")?.trim(),
        businessName: formData.get("businessName")?.trim() || null,
        location: formData.get("location")?.trim() || null,
        latitude: formData.get("latitude") ? parseFloat(formData.get("latitude")) : null,
        longitude: formData.get("longitude") ? parseFloat(formData.get("longitude")) : null,
        pricing: formData.get("pricing")?.trim() || null,
        phone: formData.get("phone")?.trim(),
        categorySlug: formData.get("categorySlug"),
        notes: formData.get("notes")?.trim() || null,
        addedBy: formData.get("addedBy")?.trim() || null,
      };

      await saveContact(payload);
    });
  }

  if (photoForm) {
    photoForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const formData = new FormData(photoForm);
      const payload = {
        name: formData.get("name")?.trim(),
        businessName: formData.get("businessName")?.trim() || null,
        location: formData.get("location")?.trim() || null,
        latitude: formData.get("latitude") ? parseFloat(formData.get("latitude")) : null,
        longitude: formData.get("longitude") ? parseFloat(formData.get("longitude")) : null,
        pricing: formData.get("pricing")?.trim() || null,
        phone: formData.get("phone")?.trim(),
        categorySlug: formData.get("categorySlug"),
        notes: formData.get("notes")?.trim() || null,
        addedBy: formData.get("addedBy")?.trim() || null,
      };

      await saveContact(payload);
    });
  }

  async function saveContact(payload) {
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        document.getElementById("addSheet").classList.add("hidden");
        fetchContacts();
      }
    } catch (err) {
      console.error("Error saving contact:", err);
    }
  }

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  function renderContactList(contacts) {
    const contactList = document.getElementById("contactList");
    if (!contactList) return;
    contactList.innerHTML = "";
    contacts.forEach((c) => contactList.appendChild(renderContactItem(c)));
  }

  fetchContacts();
});