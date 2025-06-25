export const generateCourseSlug = (title) => {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

export const validateCourseData = (data) => {
  const errors = [];

  if (!data.title || data.title.length < 5) {
    errors.push("Title must be at least 5 characters long");
  }

  if (data.title && data.title.length > 200) {
    errors.push("Title must be less than 200 characters");
  }

  if (!data.description || data.description.length < 20) {
    errors.push("Description must be at least 20 characters long");
  }

  if (!data.shortDescription || data.shortDescription.length < 10) {
    errors.push("Short description must be at least 10 characters long");
  }

  if (data.shortDescription && data.shortDescription.length > 500) {
    errors.push("Short description must be less than 500 characters");
  }

  if (!data.categoryId) {
    errors.push("Category is required");
  }

  if (
    !data.level ||
    !["BEGINNER", "INTERMEDIATE", "ADVANCED", "ALL_LEVELS"].includes(data.level)
  ) {
    errors.push("Valid level is required");
  }

  if (!data.price || data.price < 0) {
    errors.push("Valid price is required");
  }

  if (data.price > 100000) {
    errors.push("Price cannot exceed ₹100,000");
  }

  if (data.discountPrice && data.discountPrice >= data.price) {
    errors.push("Discount price must be less than original price");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};
