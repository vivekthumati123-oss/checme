export function multiply(a: number, b: number): number {
  if (a === 0 || b === 0) {
    return 0;
  }
  return a * b;
}

export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error("Division by zero");
  }
  return a / b;
}
