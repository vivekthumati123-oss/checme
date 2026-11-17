"use strict";

function slugify(text) {
  if (typeof text !== "string") {
    throw new TypeError("text must be a string");
  }
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function truncate(text, max) {
  if (max < 1) {
    throw new RangeError("max must be >= 1");
  }
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, max - 1) + "…";
}

module.exports = { slugify, truncate };

// A5 push update check
