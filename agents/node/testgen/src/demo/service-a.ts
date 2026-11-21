export function processServiceA(input: string): string {
  if (!input) return "empty";
  return `service-a-${input.trim().toLowerCase()}`;
}
