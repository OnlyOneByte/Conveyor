import type { Scene } from "../scene.ts";
import { dialog, fleet, fleetPage } from "./13-printers.ts";

export const scenes: Scene[] = [
  fleetPage(
    "printers-clear-secrets",
    [
      { click: "button[aria-label='Edit Garage Klipper']" },
      { waitFor: `${dialog} >> text=An API key is saved for this printer.` },
      { wait: 600 },
      { fulfill: "**/api/catalog/printers", method: "PUT", status: 200, json: { ok: true } },
      {
        fulfill: "**/api/catalog/printers",
        method: "GET",
        status: 200,
        json: fleet.map((printer) =>
          printer.id === "klipper-garage" ? { ...printer, hasSecrets: false } : printer,
        ),
      },
      { click: `${dialog} button:has-text('Clear saved secrets')` },
      { waitFor: `${dialog} >> text=Clear the saved API key now?` },
      { waitFor: `${dialog} button:has-text('Keep it'):focus` },
      { wait: 600 },
      { click: `${dialog} button:has-text('Clear it')` },
      { waitFor: `${dialog} p[role=status]:focus >> text=Saved API key cleared.` },
      { wait: 800 },
    ],
    true,
  ),
  fleetPage("printers-clear-secrets-keep", [
    { click: "button[aria-label='Edit Voron 2.4']" },
    { click: `${dialog} button:has-text('Clear saved secrets')` },
    { click: `${dialog} button:has-text('Keep it')` },
    { waitFor: `${dialog} >> text=An API key is saved for this printer.` },
    { waitFor: `${dialog} button:has-text('Clear saved secrets'):focus` },
    { wait: 400 },
  ]),
  fleetPage("printers-clear-secrets-confirm", [
    { click: "button[aria-label='Edit Garage Klipper']" },
    { click: `${dialog} button:has-text('Clear saved secrets')` },
    { waitFor: `${dialog} [role=group][aria-describedby] >> text=Clear the saved API key now?` },
    { wait: 400 },
  ]),
  fleetPage("printers-clear-secrets-double", [
    { click: "button[aria-label='Edit Garage Klipper']" },
    { waitFor: `${dialog} >> text=An API key is saved for this printer.` },
    {
      doubleClicks: `${dialog} button:has-text('Clear saved secrets')`,
      across: [0.6, 0.75, 0.9, 0.5],
      reset: `${dialog} button:has-text('Keep it')`,
    },
    { waitFor: `${dialog} >> text=An API key is saved for this printer.` },
  ]),
  fleetPage("printers-clear-secrets-keyboard", [
    { click: "button[aria-label='Edit Garage Klipper']" },
    { fulfill: "**/api/catalog/printers", method: "PUT", status: 200, json: { ok: true } },
    {
      fulfill: "**/api/catalog/printers",
      method: "GET",
      status: 200,
      json: fleet.map((printer) =>
        printer.id === "klipper-garage" ? { ...printer, hasSecrets: false } : printer,
      ),
    },
    { click: `${dialog} button:has-text('Clear saved secrets')` },
    { press: "Tab" },
    { press: "Enter" },
    { waitFor: `${dialog} p[role=status]:focus >> text=Saved API key cleared.`, timeout: 3000 },
  ]),
  fleetPage("printers-clear-secrets-reset", [
    { click: "button[aria-label='Edit Garage Klipper']" },
    { click: `${dialog} button:has-text('Clear saved secrets')` },
    { waitFor: `${dialog} >> text=Clear the saved API key now?` },
    { press: "Escape" },
    { click: "button[aria-label='Edit Voron 2.4']" },
    { waitFor: `${dialog} button:has-text('Clear saved secrets')`, timeout: 2000 },
    { press: "Escape" },
    { click: "button[aria-label='Edit Garage Klipper']" },
    { waitFor: `${dialog} button:has-text('Clear saved secrets')`, timeout: 2000 },
  ]),
  fleetPage("printers-clear-secrets-fails", [
    { click: "button[aria-label='Edit Garage Klipper']" },
    {
      fulfill: "**/api/catalog/printers",
      method: "PUT",
      status: 500,
      json: { error: "disk full" },
    },
    { click: `${dialog} button:has-text('Clear saved secrets')` },
    { wait: 600 },
    { click: `${dialog} button:has-text('Clear it')` },
    { waitFor: `${dialog} [role=alert] >> text=disk full` },
    { waitFor: `${dialog} button:has-text('Clear it'):focus`, timeout: 2000 },
  ]),
];
