export const secretFieldFor = (transportId: string) =>
  transportId === "elegoo"
    ? { key: "mainboardId", label: "Mainboard ID", hidden: false, hint: "from the printer's screen or ElegooLink" }
    : { key: "apiKey", label: "API key / secret", hidden: true, hint: "optional" };

export function secretsPatch(transportId: string, value: string): { secrets?: Record<string, string> } {
  const trimmed = value.trim();
  return trimmed ? { secrets: { [secretFieldFor(transportId).key]: trimmed } } : {};
}
