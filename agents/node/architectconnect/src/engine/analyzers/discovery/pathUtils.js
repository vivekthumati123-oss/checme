// ==================================================
// ARCHITECTCONNECT PATH UTILITIES
// ==================================================

function normalizePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}


function getDirectory(filePath) {
  const normalized =
    normalizePath(filePath);

  const parts =
    normalized.split("/");

  parts.pop();

  return parts.join("/");
}


function getFileName(filePath) {
  const normalized =
    normalizePath(filePath);

  return normalized
    .split("/")
    .pop() || "";
}


function getExtension(filePath) {
  const fileName =
    getFileName(filePath);

  const index =
    fileName.lastIndexOf(".");

  if (index < 0) {
    return "";
  }

  return fileName
    .slice(index)
    .toLowerCase();
}


function isInsideRoot(
  filePath,
  root
) {
  const path =
    normalizePath(filePath);

  const normalizedRoot =
    normalizePath(root);

  if (!normalizedRoot) {
    return true;
  }

  return (
    path === normalizedRoot ||
    path.startsWith(
      `${normalizedRoot}/`
    )
  );
}


function getFilesInsideRoot(
  contents,
  root
) {
  if (!Array.isArray(contents)) {
    return [];
  }

  return contents.filter(
    (item) => {
      const filePath =
        item &&
        (
          item.path ||
          item.name
        );

      return isInsideRoot(
        filePath,
        root
      );
    }
  );
}


export {
  normalizePath,
  getDirectory,
  getFileName,
  getExtension,
  isInsideRoot,
  getFilesInsideRoot
};
