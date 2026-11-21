export function exhaustive(value: never): never {
  throw new Error(`unhandled value: ${JSON.stringify(value)}`);
}
