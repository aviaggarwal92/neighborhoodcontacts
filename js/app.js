// Fetch Categories from /api/categories
async function fetchCategories() {
  try {
    const res = await fetch("/api/categories");
    if (res.ok) {
      const data = await res.json();
      categories = data.categories || [];
      renderCategoryChips();
      populateCategorySelects();
    }
  } catch (err) {
    console.error("Failed to load categories:", err);
  }
}

// Submit New Category to /api/categories
if (categoryForm) {
  categoryForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(categoryForm);
    const name = formData.get("name")?.trim();

    if (!name) return;

    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      const data = await res.json();

      if (res.ok) {
        closeCategoryModal();
        await fetchCategories();
        
        // Auto-select newly created category in forms
        if (data.category) {
          document.querySelectorAll("[data-category-select]").forEach((select) => {
            select.value = data.category.id || data.category.slug;
          });
        }
      } else {
        if (categoryError) {
          categoryError.textContent = data.error || "Error adding category.";
          categoryError.classList.remove("hidden");
        }
      }
    } catch (err) {
      console.error("Error submitting category:", err);
      if (categoryError) {
        categoryError.textContent = "Network error. Please try again.";
        categoryError.classList.remove("hidden");
      }
    }
  });
}