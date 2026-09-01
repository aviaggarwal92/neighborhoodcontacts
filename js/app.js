(() => {
  const state = {
    categories: [],
    contacts: [],
    activeCategory: "all",
    search: "",
    totalContacts: 0,
    hasMoreContacts: false,
    contactsLoading: false,
    contactsRequestId: 0,
    categoryShareCache: new Map(),
    currentDetailId: null,
    currentDetailContact: null,
    selectedRating: 0,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const categoryChips = $("#categoryChips");
  const contactList = $("#contactList");
  const emptyState = $("#emptyState");
  const resultCount = $("#resultCount");
  const categoryShareButton = $("#categoryShareButton");
  const categoryShareLabel = $("#categoryShareLabel");
  const searchInput = $("#searchInput");
  const listStatus = $("#listStatus");
  const loadMoreSentinel = $("#loadMoreSentinel");
  const loadMoreButton = $("#loadMoreButton");
  const toast = $("#toast");
  const CONTACT_PAGE_SIZE = 24;
  let contactsController;

  function syncSheetScrollLock() {
    const hasOpenSheet = $$(".sheet-overlay").some((sheet) => !sheet.classList.contains("hidden"));
    document.body.classList.toggle("sheet-open", hasOpenSheet);
  }

  function openSheet(sheet) {
    const scroller = sheet.querySelector(".sheet");
    if (scroller) scroller.scrollTop = 0;
    sheet.classList.remove("hidden");
    syncSheetScrollLock();
  }

  function closeSheet(sheet) {
    sheet.classList.add("hidden");
    syncSheetScrollLock();
  }

  function goHome() {
    $$(".sheet-overlay").forEach((sheet) => sheet.classList.add("hidden"));
    syncSheetScrollLock();
    state.currentDetailId = null;
    state.currentDetailContact = null;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  $$('[data-go-home]').forEach((button) => button.addEventListener("click", goHome));

  function showToast(message) {
    toast.textContent = message;
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 2600);
  }

  function starGlyphs(rating) {
    const rounded = Math.round(rating);
    return "★★★★★".slice(0, rounded).padEnd(0) + "☆☆☆☆☆".slice(rounded);
  }

  function formatPhoneHref(phone) {
    return "tel:" + phone.replace(/[^\d+]/g, "");
  }

  function sanitizePhone(value) {
    const rawValue = String(value || "");
    const hasLeadingPlus = /^\s*\+/.test(rawValue);
    const phoneBody = rawValue
      .replace(/[^\d().\-\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return `${hasLeadingPlus ? "+" : ""}${phoneBody}`.slice(0, 30);
  }

  function formatWhatsAppShareUrl(contact) {
    const lines = [
      "Highland Lakes contact",
      contact.name,
      contact.businessName || "",
      contact.phone,
      contact.categoryName ? `Category: ${contact.categoryName}` : "",
      contact.pricing ? `Pricing: ${contact.pricing}` : "",
      contact.notes ? `Notes: ${contact.notes}` : "",
      "Shared from Highland Lakes Directory",
    ].filter(Boolean);

    return `https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`;
  }

  function formatCategoryWhatsAppShareUrl(category, contacts) {
    const contactLines = contacts.flatMap((contact, index) => [
      `${index + 1}. ${contact.name}${contact.businessName ? ` — ${contact.businessName}` : ""}`,
      `Phone: ${contact.phone}`,
      contact.pricing ? `Pricing: ${contact.pricing}` : "",
      contact.notes ? `Notes: ${contact.notes}` : "",
      "",
    ]);
    const lines = [
      `Highland Lakes ${category.name}`,
      `${contacts.length} contact${contacts.length === 1 ? "" : "s"}`,
      "",
      ...contactLines,
      "Shared from Highland Lakes Directory",
    ];

    return `https://wa.me/?text=${encodeURIComponent(lines.join("\n").trim())}`;
  }

  function whatsAppIcon() {
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20.5 11.7a8.4 8.4 0 0 1-12.4 7.4L3.5 20.5l1.4-4.4A8.4 8.4 0 1 1 20.5 11.7Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.2 7.8c.2-.5.5-.5.8-.5h.5c.2 0 .4.1.5.4l.8 1.9c.1.3 0 .5-.2.7l-.6.7c-.2.2-.1.4 0 .6.7 1.3 1.7 2.3 3 3 .2.1.4.2.6 0l.8-1c.2-.2.4-.3.7-.2l1.8.9c.3.1.4.3.4.5 0 .3-.2 1.5-1.1 2.1-.6.4-1.4.6-2.3.3-1.2-.3-2.8-1-4.4-2.4-1.8-1.6-3-3.6-3.3-4.8-.3-1.1 0-1.8.3-2.2.4-.4.8-.5 1.1-.5" fill="currentColor"/></svg>`;
  }

  // ---------- Data loading ----------
  async function loadCategories() {
    const res = await fetch("/api/categories");
    const data = await res.json();
    state.categories = data.categories || [];
    renderChips();
    populateCategorySelects();
    renderCategoryShare();
  }

  async function loadContacts({ append = false } = {}) {
    if (append && (!state.hasMoreContacts || state.contactsLoading)) return;

    if (!append) {
      contactsController?.abort();
      contactsController = new AbortController();
      state.contacts = [];
      state.totalContacts = 0;
      state.hasMoreContacts = false;
      state.categoryShareCache.clear();
      renderLoadingSkeletons();
    }

    const requestId = ++state.contactsRequestId;
    const offset = append ? state.contacts.length : 0;
    state.contactsLoading = true;
    listStatus.textContent = append ? "Loading more contacts…" : "Loading contacts…";
    updatePaginationControls();

    const params = new URLSearchParams();
    if (state.activeCategory !== "all") params.set("category", state.activeCategory);
    if (state.search) params.set("search", state.search);
    params.set("limit", String(CONTACT_PAGE_SIZE));
    params.set("offset", String(offset));

    try {
      const res = await fetch(`/api/contacts?${params.toString()}`, {
        signal: contactsController?.signal,
      });
      if (!res.ok) throw new Error("Contact request failed");
      const data = await res.json();
      if (requestId !== state.contactsRequestId) return;

      const nextContacts = data.contacts || [];
      state.contacts = append ? [...state.contacts, ...nextContacts] : nextContacts;
      state.totalContacts = data.total ?? state.contacts.length;
      state.hasMoreContacts = Boolean(data.hasMore);
      renderContacts(nextContacts, { append });
      listStatus.textContent = "";
    } catch (error) {
      if (error.name === "AbortError") return;
      if (!append) contactList.replaceChildren();
      listStatus.textContent = "Contacts could not load. Check your connection and try again.";
    } finally {
      if (requestId === state.contactsRequestId) {
        state.contactsLoading = false;
        updatePaginationControls();
      }
    }
  }

  // ---------- Rendering ----------
  function renderChips() {
    const all = [{ slug: "all", name: "All" }, ...state.categories];
    categoryChips.innerHTML = "";
    all.forEach((cat) => {
      const btn = document.createElement("button");
      const isActive = state.activeCategory === cat.slug;
      btn.type = "button";
      btn.className = "chip" + (isActive ? " active" : "");
      btn.textContent = cat.name;
      btn.setAttribute("aria-pressed", String(isActive));
      btn.addEventListener("click", () => {
        state.activeCategory = isActive ? "all" : cat.slug;
        renderChips();
        loadContacts();
      });
      categoryChips.appendChild(btn);
    });
  }

  function populateCategorySelects() {
    $$('[data-category-select]').forEach((select) => {
      const selectedValue = select.value;
      select.replaceChildren();
      state.categories.forEach((category) => {
        const option = document.createElement("option");
        option.value = category.slug;
        option.textContent = category.name;
        select.appendChild(option);
      });
      if (state.categories.some((category) => category.slug === selectedValue)) {
        select.value = selectedValue;
      }
    });
  }

  function renderLoadingSkeletons() {
    resultCount.textContent = "Loading contacts";
    emptyState.classList.add("hidden");
    contactList.innerHTML = Array.from({ length: 6 }, () => `
      <li class="contact-card contact-card-skeleton" aria-hidden="true">
        <span class="skeleton-line skeleton-line-name"></span>
        <span class="skeleton-line skeleton-line-business"></span>
        <span class="skeleton-line skeleton-line-phone"></span>
      </li>
    `).join("");
  }

  function renderContacts(contactsToRender, { append = false } = {}) {
    if (!append) contactList.replaceChildren();
    const loadedCount = state.contacts.length;
    resultCount.textContent = state.hasMoreContacts
      ? `${loadedCount} of ${state.totalContacts} contacts`
      : `${state.totalContacts} contact${state.totalContacts === 1 ? "" : "s"}`;
    emptyState.classList.toggle("hidden", state.totalContacts > 0);
    renderCategoryShare();

    const fragment = document.createDocumentFragment();
    contactsToRender.forEach((c) => {
      const li = document.createElement("li");
      li.className = "contact-card";
      li.innerHTML = `
        <div class="card-top">
          <div>
            <p class="card-name">${escapeHtml(c.name)}</p>
            ${c.businessName ? `<p class="card-business">${escapeHtml(c.businessName)}</p>` : ""}
          </div>
          <span class="category-pill">${escapeHtml(c.categoryName)}</span>
        </div>
        <div class="card-bottom">
          <div class="card-contact-info">
            <a class="card-phone" href="${formatPhoneHref(c.phone)}" onclick="event.stopPropagation()">${escapeHtml(c.phone)}</a>
            ${c.pricing ? `<span class="card-pricing">${escapeHtml(c.pricing)}</span>` : ""}
          </div>
          <div class="card-actions">
            <span class="card-rating">
              ${
                c.reviewCount > 0
                  ? `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 1.5l2.6 5.6 6.1.6-4.6 4.1 1.3 6-5.4-3.2-5.4 3.2 1.3-6-4.6-4.1 6.1-.6z"/></svg> ${Number(c.averageRating).toFixed(1)} (${c.reviewCount})`
                  : `<span class="no-reviews">No reviews yet</span>`
              }
            </span>
            <a class="whatsapp-share whatsapp-share-compact" href="${formatWhatsAppShareUrl(c)}" target="_blank" rel="noopener noreferrer" aria-label="Share ${escapeHtml(c.name)} on WhatsApp" onclick="event.stopPropagation()">
              ${whatsAppIcon()}
              <span>Share</span>
            </a>
          </div>
        </div>
      `;
      li.addEventListener("click", () => openDetail(c.id));
      fragment.appendChild(li);
    });
    contactList.appendChild(fragment);
  }

  function updatePaginationControls() {
    const showLoadMore = state.hasMoreContacts || (state.contactsLoading && state.contacts.length > 0);
    loadMoreSentinel.classList.toggle("hidden", !showLoadMore);
    loadMoreButton.disabled = state.contactsLoading;
    loadMoreButton.textContent = state.contactsLoading ? "Loading…" : "Load more contacts";
  }

  function renderCategoryShare() {
    const category = state.categories.find((item) => item.slug === state.activeCategory);

    if (!category) {
      categoryShareButton.classList.add("hidden");
      categoryShareButton.removeAttribute("href");
      return;
    }

    categoryShareLabel.textContent = "Share category";
    categoryShareButton.href = "#";
    categoryShareButton.setAttribute("aria-label", `Share all ${category.name} contacts on WhatsApp`);
    categoryShareButton.classList.remove("hidden");
  }

  async function loadAllCategoryContacts(categorySlug) {
    if (state.categoryShareCache.has(categorySlug)) return state.categoryShareCache.get(categorySlug);

    const contacts = [];
    let total = 1;
    while (contacts.length < total) {
      const params = new URLSearchParams({
        category: categorySlug,
        limit: "100",
        offset: String(contacts.length),
      });
      const res = await fetch(`/api/contacts?${params.toString()}`);
      if (!res.ok) throw new Error("Category share request failed");
      const data = await res.json();
      contacts.push(...(data.contacts || []));
      total = data.total ?? contacts.length;
      if (!data.hasMore) break;
    }

    state.categoryShareCache.set(categorySlug, contacts);
    return contacts;
  }

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[m]));
  }

  loadMoreButton.addEventListener("click", () => loadContacts({ append: true }));

  if ("IntersectionObserver" in window) {
    const loadMoreObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadContacts({ append: true });
    }, { rootMargin: "320px 0px" });
    loadMoreObserver.observe(loadMoreSentinel);
  }

  categoryShareButton.addEventListener("click", async (event) => {
    event.preventDefault();
    const category = state.categories.find((item) => item.slug === state.activeCategory);
    if (!category || categoryShareButton.getAttribute("aria-busy") === "true") return;

    categoryShareButton.setAttribute("aria-busy", "true");
    categoryShareLabel.textContent = "Preparing…";
    try {
      const contacts = await loadAllCategoryContacts(category.slug);
      if (contacts.length === 0) {
        showToast("No contacts to share in this category");
        return;
      }
      window.location.assign(formatCategoryWhatsAppShareUrl(category, contacts));
    } catch {
      showToast("Could not prepare the category share");
    } finally {
      categoryShareButton.removeAttribute("aria-busy");
      renderCategoryShare();
    }
  });

  // ---------- Search ----------
  let searchTimer;
  searchInput.addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = e.target.value.trim();
      loadContacts();
    }, 250);
  });

  // ---------- Add sheet ----------
  const addSheet = $("#addSheet");
  const fabAdd = $("#fabAdd");
  const closeAddSheet = $("#closeAddSheet");
  const manualForm = $("#manualForm");

  function showAddTab(tabName) {
    $$('[data-add-tab]').forEach((button) => {
      const isActive = button.dataset.addTab === tabName;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    });
    $("#tabManual").classList.toggle("active", tabName === "manual");
    $("#tabPhoto").classList.toggle("active", tabName === "photo");
  }

  $$('[data-add-tab]').forEach((button) => {
    button.addEventListener("click", () => showAddTab(button.dataset.addTab));
  });

  fabAdd.addEventListener("click", () => {
    resetManualTab();
    resetPhotoTab();
    showAddTab("manual");
    openSheet(addSheet);
  });
  closeAddSheet.addEventListener("click", () => closeSheet(addSheet));
  addSheet.addEventListener("click", (e) => { if (e.target === addSheet) closeSheet(addSheet); });

  function renderDuplicateCard(container, contact) {
    container.innerHTML = `
      <div class="dup-label">Already in the directory</div>
      <p class="dup-name">${escapeHtml(contact.name)}${contact.businessName ? " · " + escapeHtml(contact.businessName) : ""}</p>
      <p class="dup-phone">${escapeHtml(contact.phone)} · ${escapeHtml(contact.categoryName)}</p>
    `;
    container.classList.remove("hidden");
    container.onclick = () => {
      closeSheet(addSheet);
      openDetail(contact.id);
    };
  }

  async function submitContact(formData, errorEl, dupEl) {
    errorEl.classList.add("hidden");
    dupEl.classList.add("hidden");
    const payload = Object.fromEntries(formData.entries());
    payload.phone = sanitizePhone(payload.phone);
    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || "Something went wrong.";
      errorEl.classList.remove("hidden");
      if (data.existingContact) renderDuplicateCard(dupEl, data.existingContact);
      return false;
    }
    return true;
  }

  manualForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    fd.set("source", "manual");
    const ok = await submitContact(fd, $("#manualError"), $("#manualDuplicateCard"));
    if (ok) {
      closeSheet(addSheet);
      showToast("Contact saved");
      loadContacts();
    }
  });

  $("#photoForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    fd.set("source", "photo");
    const ok = await submitContact(fd, $("#photoError"), $("#photoDuplicateCard"));
    if (ok) {
      closeSheet(addSheet);
      showToast("Contact saved");
      loadContacts();
    }
  });

  // ---------- Photo intake ----------
  const photoInput = $("#photoInput");
  const photoPreview = $("#photoPreview");
  const photoStatus = $("#photoStatus");
  const photoForm = $("#photoForm");

  function resetManualTab() {
    manualForm.reset();
    $("#manualError").classList.add("hidden");
    $("#manualDuplicateCard").classList.add("hidden");
  }

  $$('input[name="phone"]').forEach((input) => {
    input.addEventListener("input", () => {
      const filteredValue = sanitizePhone(input.value);
      if (input.value !== filteredValue) input.value = filteredValue;
    });
  });

  $("#photoChooseBtn").addEventListener("click", () => {
    photoInput.value = "";
    photoInput.click();
  });

  function resetPhotoTab() {
    photoInput.value = "";
    photoPreview.classList.add("hidden");
    photoPreview.removeAttribute("src");
    photoStatus.classList.add("hidden");
    photoStatus.classList.remove("loading", "error");
    photoForm.classList.add("hidden");
    photoForm.reset();
    $("#photoError").classList.add("hidden");
    $("#photoDuplicateCard").classList.add("hidden");
  }

  // ---------- Category creation ----------
  const categorySheet = $("#categorySheet");
  const categoryForm = $("#categoryForm");
  const categoryError = $("#categoryError");
  let categoryTargetSelectId = null;

  function openCategorySheet(targetSelectId = null) {
    categoryTargetSelectId = targetSelectId;
    categoryForm.reset();
    categoryError.classList.add("hidden");
    openSheet(categorySheet);
    categoryForm.elements.name.focus();
  }

  function closeCategorySheet() {
    closeSheet(categorySheet);
    categoryTargetSelectId = null;
  }

  $("#openCategorySheet").addEventListener("click", () => openCategorySheet());
  $$('[data-open-category]').forEach((button) => {
    button.addEventListener("click", () => openCategorySheet(button.dataset.openCategory));
  });
  $("#closeCategorySheet").addEventListener("click", closeCategorySheet);
  categorySheet.addEventListener("click", (e) => { if (e.target === categorySheet) closeCategorySheet(); });

  categoryForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    categoryError.classList.add("hidden");
    const submitButton = categoryForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;

    try {
      const payload = Object.fromEntries(new FormData(categoryForm).entries());
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        categoryError.textContent = data.error || "Could not add that category.";
        categoryError.classList.remove("hidden");
        return;
      }

      await loadCategories();
      if (categoryTargetSelectId) {
        const targetSelect = document.getElementById(categoryTargetSelectId);
        if (targetSelect) targetSelect.value = data.category.slug;
      }
      closeSheet(categorySheet);
      categoryTargetSelectId = null;
      showToast("Category added");
    } catch {
      categoryError.textContent = "Could not add that category. Check your connection and try again.";
      categoryError.classList.remove("hidden");
    } finally {
      submitButton.disabled = false;
    }
  });

  async function handlePhotoFile(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      photoStatus.textContent = "Please choose an image from your saved photos.";
      photoStatus.classList.remove("hidden", "loading");
      photoStatus.classList.add("error");
      return;
    }

    photoPreview.classList.add("hidden");
    photoStatus.textContent = "Scanning photo for text…";
    photoStatus.classList.remove("hidden");
    photoStatus.classList.add("loading");
    photoStatus.classList.remove("error");
    photoForm.classList.add("hidden");

    try {
      const { dataUrl } = await normalizeImageFile(file);
      photoPreview.src = dataUrl;
      photoPreview.classList.remove("hidden");

      const ocrText = await extractTextFromImage(dataUrl, (progress) => {
        photoStatus.textContent = `Scanning photo for text… ${progress}%`;
      });

      photoStatus.classList.add("hidden");
      photoStatus.classList.remove("loading");

      const guessedPhone = guessPhoneNumber(ocrText);

      photoForm.querySelector('[name="name"]').value = "";
      photoForm.querySelector('[name="businessName"]').value = "";
      photoForm.querySelector('[name="pricing"]').value = "";
      photoForm.querySelector('[name="phone"]').value = sanitizePhone(guessedPhone || "");
      photoForm.querySelector('[name="notes"]').value = ocrText.trim();
      photoForm.querySelector('[name="categorySlug"]').value = "other";
      photoForm.classList.remove("hidden");

      if (!guessedPhone) {
        photoStatus.textContent = "Couldn't find a phone number automatically. Check the scanned text below and fill in the details.";
        photoStatus.classList.remove("hidden", "error");
      }
    } catch (err) {
      photoStatus.textContent = err.message || "Something went wrong reading that photo. Try another saved image.";
      photoStatus.classList.remove("hidden", "loading");
      photoStatus.classList.add("error");
    }
  }

  function extractTextFromImage(dataUrl, onProgress) {
    return Tesseract.recognize(dataUrl, "eng", {
      logger: (info) => {
        if (info.status === "recognizing text" && onProgress) {
          onProgress(Math.round(info.progress * 100));
        }
      },
    }).then((result) => result.data.text || "");
  }

  function guessPhoneNumber(text) {
    const phoneRegex = /(\+?\d[\d\-.\s()]{6,}\d)/g;
    const matches = text.match(phoneRegex) || [];
    let best = "";
    let bestDigitCount = 0;
    matches.forEach((match) => {
      const digits = match.replace(/\D/g, "");
      if (digits.length >= 7 && digits.length <= 15 && digits.length > bestDigitCount) {
        best = match.trim();
        bestDigitCount = digits.length;
      }
    });
    return best;
  }

  photoInput.addEventListener("change", () => handlePhotoFile(photoInput.files[0]));

  // Keep supported images at their original resolution when the request stays
  // reasonably small. Tiny phone-number text is easier to read without an
  // unnecessary canvas resize. Other images are converted to a detailed JPEG.
  async function normalizeImageFile(file) {
    const supportedTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
    const maxOriginalBytes = 3 * 1024 * 1024;

    if (supportedTypes.has(file.type) && file.size <= maxOriginalBytes) {
      const dataUrl = await readFileAsDataUrl(file);
      return { dataUrl, base64: dataUrl.split(",")[1], mediaType: file.type };
    }

    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = objectUrl;
      });
      const canvas = document.createElement("canvas");
      const sourceWidth = img.naturalWidth || img.width;
      const sourceHeight = img.naturalHeight || img.height;
      const maxDimension = 2600;
      const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
      canvas.width = Math.round(sourceWidth * scale);
      canvas.height = Math.round(sourceHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Image conversion is unavailable.");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      let quality = 0.92;
      let dataUrl = canvas.toDataURL("image/jpeg", quality);
      while (dataUrl.length > 4_200_000 && quality > 0.62) {
        quality -= 0.1;
        dataUrl = canvas.toDataURL("image/jpeg", quality);
      }
      if (dataUrl.length > 4_200_000) {
        throw new Error("That photo is too large. Crop it closer to the contact details and try again.");
      }
      return { dataUrl, base64: dataUrl.split(",")[1], mediaType: "image/jpeg" };
    } catch (err) {
      if (err instanceof Error && err.message) throw err;
      throw new Error("That photo format could not be opened. Try saving it as a JPEG or PNG.");
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ---------- Detail sheet ----------
  const detailSheet = $("#detailSheet");
  const closeDetailSheet = $("#closeDetailSheet");
  const detailBody = $("#detailBody");
  const pricingEditForm = $("#pricingEditForm");
  const pricingEditError = $("#pricingEditError");
  closeDetailSheet.addEventListener("click", () => closeSheet(detailSheet));
  detailSheet.addEventListener("click", (e) => { if (e.target === detailSheet) closeSheet(detailSheet); });

  function renderDetailContact(contact) {
    state.currentDetailContact = contact;
    $("#detailName").textContent = contact.name;
    detailBody.innerHTML = `
      <div class="detail-pill-row">
        <span class="category-pill">${escapeHtml(contact.categoryName)}</span>
        <span class="card-rating">
          ${
            contact.reviewCount > 0
              ? `★ ${contact.averageRating.toFixed(1)} (${contact.reviewCount} review${contact.reviewCount === 1 ? "" : "s"})`
              : `<span class="no-reviews">No reviews yet</span>`
          }
        </span>
      </div>
      ${contact.businessName ? `<p class="detail-business">${escapeHtml(contact.businessName)}</p>` : ""}
      <div class="detail-pricing">
        <span>Pricing</span>
        <div class="detail-pricing-value${contact.pricing ? "" : " detail-pricing-empty"}">${
          contact.pricing ? escapeHtml(contact.pricing) : "No pricing shared yet"
        }</div>
        <button type="button" class="pricing-edit-btn" data-edit-pricing>${contact.pricing ? "Edit" : "Add pricing"}</button>
      </div>
      <a class="detail-call" href="${formatPhoneHref(contact.phone)}">
        <svg viewBox="0 0 24 24" fill="none"><path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.3 21 3 13.7 3 4.9c0-.6.4-1 1-1h3.4c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .8-.2 1z" fill="currentColor"/></svg>
        Call ${escapeHtml(contact.phone)}
      </a>
      <a class="whatsapp-share whatsapp-share-detail" href="${formatWhatsAppShareUrl(contact)}" target="_blank" rel="noopener noreferrer">
        ${whatsAppIcon()}
        Share on WhatsApp
      </a>
      ${contact.notes ? `<div class="detail-notes">${escapeHtml(contact.notes)}</div>` : ""}
      <p class="detail-meta">${contact.addedBy ? `Shared by ${escapeHtml(contact.addedBy)} · ` : ""}${contact.source === "photo" ? "Added from a photo" : "Added manually"}</p>
    `;
  }

  function closePricingEditor() {
    pricingEditForm.classList.add("hidden");
    pricingEditError.classList.add("hidden");
  }

  detailBody.addEventListener("click", (e) => {
    if (!e.target.closest("[data-edit-pricing]") || !state.currentDetailContact) return;
    pricingEditForm.elements.pricing.value = state.currentDetailContact.pricing || "";
    pricingEditError.classList.add("hidden");
    pricingEditForm.classList.remove("hidden");
    pricingEditForm.elements.pricing.focus();
  });

  $("#cancelPricingEdit").addEventListener("click", closePricingEditor);

  pricingEditForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.currentDetailId) return;

    pricingEditError.classList.add("hidden");
    const submitButton = pricingEditForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;

    try {
      const payload = Object.fromEntries(new FormData(pricingEditForm).entries());
      const res = await fetch(`/api/contacts?id=${state.currentDetailId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pricingEditError.textContent = data.error || "Could not update pricing.";
        pricingEditError.classList.remove("hidden");
        return;
      }

      renderDetailContact(data.contact);
      closePricingEditor();
      showToast(data.contact.pricing ? "Pricing updated" : "Pricing removed");
      await loadContacts();
    } catch {
      pricingEditError.textContent = "Could not update pricing. Check your connection and try again.";
      pricingEditError.classList.remove("hidden");
    } finally {
      submitButton.disabled = false;
    }
  });

  async function openDetail(id) {
    state.currentDetailId = id;
    const contact = state.contacts.find((c) => c.id === id) || (await fetchSingleContact(id));
    if (!contact) return;

    renderDetailContact(contact);
    closePricingEditor();
    resetReviewForm();
    openSheet(detailSheet);
    loadReviews(id);
  }

  async function fetchSingleContact(id) {
    await loadContacts();
    return state.contacts.find((c) => c.id === id);
  }

  async function loadReviews(contactId) {
    const res = await fetch(`/api/reviews?contactId=${contactId}`);
    const data = await res.json();
    const list = $("#reviewList");
    list.innerHTML = "";
    if (!data.reviews || data.reviews.length === 0) {
      list.innerHTML = `<li class="no-reviews-msg">No reviews yet — share how it went.</li>`;
      return;
    }
    data.reviews.forEach((r) => {
      const li = document.createElement("li");
      li.className = "review-item";
      li.innerHTML = `
        <div class="review-item-top">
          <span class="review-author">${escapeHtml(r.author)}</span>
          <span class="review-stars">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</span>
        </div>
        ${r.comment ? `<p class="review-comment">${escapeHtml(r.comment)}</p>` : ""}
      `;
      list.appendChild(li);
    });
  }

  // ---------- Star input ----------
  const starInput = $("#starInput");
  function resetReviewForm() {
    $("#reviewForm").reset();
    $("#reviewError").classList.add("hidden");
    state.selectedRating = 0;
    renderStars(0);
  }
  function renderStars(value) {
    $$("#starInput button").forEach((btn) => {
      btn.classList.toggle("filled", Number(btn.dataset.star) <= value);
    });
    $('#reviewForm [name="rating"]').value = value || "";
  }
  starInput.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    state.selectedRating = Number(btn.dataset.star);
    renderStars(state.selectedRating);
  });

  $("#reviewForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = $("#reviewError");
    errorEl.classList.add("hidden");
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    payload.contactId = state.currentDetailId;
    if (!payload.rating) {
      errorEl.textContent = "Pick a star rating.";
      errorEl.classList.remove("hidden");
      return;
    }
    const res = await fetch("/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || "Could not post that review.";
      errorEl.classList.remove("hidden");
      return;
    }
    resetReviewForm();
    showToast("Review posted");
    loadReviews(state.currentDetailId);
    loadContacts();
  });

  // ---------- Init ----------
  (async function init() {
    await Promise.all([loadCategories(), loadContacts()]);
  })();
})();
