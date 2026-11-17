export function buildSchemaVersion(major: number, minor: number): string {
  if (major < 0) {
    throw new RangeError("major must be >= 0");
  }
  return `${major}.${minor}`;
}
