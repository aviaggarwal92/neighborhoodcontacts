document.addEventListener("DOMContentLoaded", () => {
  let activeUserLocation = null;
  let is25MileActive = false;

  const locationFilterBtn = document.getElementById("locationFilterBtn");
  const fabAdd = document.getElementById("fabAdd");
  const addSheet = document.getElementById("addSheet");
  const closeAddSheet = document.getElementById("closeAddSheet");
  const manualForm = document.getElementById("manualForm");
  const photoForm = document.getElementById("photoForm");

  // Open "Add Contact" modal when clicking the plus button (+)
  if (fabAdd && addSheet) {
    fabAdd.addEventListener("click", () => {
      addSheet.classList.remove("hidden");
      autoFetchUserLocation();
    });
  }

  // Close "Add Contact" modal
  if (closeAddSheet && addSheet) {
    closeAddSheet.addEventListener("click", () => {
      addSheet.classList.add("hidden");
    });
  }

  // Close modals when clicking overlay background or home buttons
  document.querySelectorAll("[data-go-home]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".sheet-overlay").forEach((sheet) => sheet.classList.add("hidden"));
    });
  });

  // Tab switching between Manual and Photo entry
  const tabBtns = document.querySelectorAll("[data-add-tab]");
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const tabTarget = btn.getAttribute("data-add-tab");
      document.getElementById("tabManual").classList.toggle("active", tabTarget === "manual");
      document.getElementById("tabPhoto").classList.toggle("active", tabTarget === "photo");
    });
  });

  // Automatically fetch GPS location and reverse geocode
  function autoFetchUserLocation() {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;

          const manualLat = document.getElementById("manualLat");
          const manualLon = document.getElementById("manualLon");
          const photoLat = document.getElementById("photoLat");
          const photoLon = document.getElementById("photoLon");

          if (manualLat) manualLat.value = lat;
          if (manualLon) manualLon.value = lon;
          if (photoLat) photoLat.value = lat;
          if (photoLon) photoLon.value = lon;

          try {
            const res = await fetch(
              `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`
            );
            const data = await res.json();
            const city = data.address?.city || data.address?.town || data.address?.village || data.address?.county || "";
            const state = data.address?.state || "";
            const readableLoc = city && state ? `${city}, ${state}` : data.display_name?.split(",")[0] || "Current Location";

            const manualLoc = document.getElementById("manualLocation");
            const photoLoc = document.getElementById("photoLocation");
            if (manualLoc) manualLoc.value = readableLoc;
            if (photoLoc) photoLoc.value = readableLoc;
          } catch (err) {
            console.error("Reverse geocoding error:", err);
          }
        },
        (err) => {
          console.warn("Location permission denied or unavailable:", err);
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

  // Fetch contacts from API
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
        if (addSheet) addSheet.classList.add("hidden");
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