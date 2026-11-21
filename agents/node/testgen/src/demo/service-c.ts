export function processServiceC(flag: boolean, name: string): string {
  if (flag) {
    return `active:${name}`;
  }
  return `inactive:${name}`;
}
