export const secretFieldFor = (transportId: string) =>
  transportId === "elegoo"
    ? {
        key: "mainboardId",
        label: "Mainboard ID",
        hidden: false,
        hint: "On the printer's screen, or in ElegooLink.",
      }
    : {
        key: "apiKey",
        label: "API key",
        hidden: true,
        hint: "Optional. Only needed if Moonraker asks for one.",
      };

export function secretsPatch(
  transportId: string,
  value: string,
): { secrets?: Record<string, string> } {
  const trimmed = value.trim();
  return trimmed ? { secrets: { [secretFieldFor(transportId).key]: trimmed } } : {};
}
