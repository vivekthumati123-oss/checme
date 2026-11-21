export function processServiceD(items: string[]): number {
  return items.filter((x) => x.length > 3).length;
}
