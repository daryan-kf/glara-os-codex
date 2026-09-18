"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { inputClass } from "./shared";
// Free OpenStreetMap-based typeahead geocoder; results are biased to Metro
// Vancouver and filtered to Canada. Only the typed address text is sent.
const endpoint = "https://photon.komoot.io/api/";
type Suggestion = {
  address: string;
  city: string;
  province: string;
  postal: string;
  label: string;
};
function parseFeatures(payload: unknown): Suggestion[] {
  const features =
    payload && typeof payload === "object" && "features" in payload
      ? (payload.features as {
          properties?: Record<string, string | undefined>;
        }[])
      : [];
  const rows: Suggestion[] = [];
  for (const feature of features.slice(0, 8)) {
    const p = feature.properties ?? {};
    if (p.countrycode !== "CA") continue;
    const address = [p.housenumber, p.street ?? p.name]
      .filter(Boolean)
      .join(" ")
      .trim();
    const city = p.city ?? p.district ?? p.county ?? "";
    if (!address) continue;
    const province = p.state === "British Columbia" ? "BC" : (p.state ?? "BC");
    const suggestion = {
      address,
      city,
      province,
      postal: p.postcode ?? "",
      label: [address, city, p.postcode].filter(Boolean).join(", "),
    };
    if (!rows.some((r) => r.label === suggestion.label)) rows.push(suggestion);
  }
  return rows.slice(0, 6);
}
export function AddressFields({
  initial,
}: {
  initial?: {
    address_line_1?: string | null;
    city?: string | null;
    province?: string | null;
    postal_code?: string | null;
  };
}) {
  const viewer = useQuery(api.profiles.viewer);
  const lookupEnabled = viewer?.address_lookup_enabled === true;
  const [address, setAddress] = useState(initial?.address_line_1 ?? ""),
    [city, setCity] = useState(initial?.city ?? "Vancouver"),
    [province, setProvince] = useState(initial?.province ?? "BC"),
    [postal, setPostal] = useState(initial?.postal_code ?? ""),
    [suggestions, setSuggestions] = useState<Suggestion[]>([]),
    [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined),
    controller = useRef<AbortController>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      controller.current?.abort();
    },
    [],
  );
  function search(term: string) {
    clearTimeout(timer.current);
    controller.current?.abort();
    if (!lookupEnabled || term.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      const abort = new AbortController();
      controller.current = abort;
      try {
        const response = await fetch(
          `${endpoint}?q=${encodeURIComponent(term)}&limit=8&lang=en&lat=49.25&lon=-122.9`,
          { signal: abort.signal },
        );
        if (!response.ok) return;
        const rows = parseFeatures(await response.json());
        setSuggestions(rows);
        setOpen(rows.length > 0);
      } catch {
        /* Suggestions are best-effort; typing always works without them. */
      }
    }, 300);
  }
  return (
    <>
      <div className="relative">
        <label className="grid gap-2 text-sm font-medium">
          Address line 1
          <input
            className={inputClass}
            name="address_line_1"
            value={address}
            required
            autoComplete="off"
            placeholder="Start typing the street address…"
            onChange={(e) => {
              setAddress(e.target.value);
              search(e.target.value);
            }}
            onBlur={() => setTimeout(() => setOpen(false), 200)}
            onFocus={() => setOpen(suggestions.length > 0)}
          />
        </label>
        {open && (
          <ul
            role="listbox"
            aria-label="Address suggestions"
            className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border bg-card shadow-lg"
          >
            {suggestions.map((s) => (
              <li key={s.label}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setAddress(s.address);
                    if (s.city) setCity(s.city);
                    if (s.province) setProvince(s.province);
                    if (s.postal) setPostal(s.postal);
                    setOpen(false);
                  }}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <label className="grid gap-2 text-sm font-medium">
        City
        <input
          className={inputClass}
          name="city"
          value={city}
          required
          onChange={(e) => setCity(e.target.value)}
        />
      </label>
      <label className="grid gap-2 text-sm font-medium">
        Province
        <input
          className={inputClass}
          name="province"
          value={province}
          required
          onChange={(e) => setProvince(e.target.value)}
        />
      </label>
      <label className="grid gap-2 text-sm font-medium">
        Postal code
        <input
          className={inputClass}
          name="postal_code"
          value={postal}
          onChange={(e) => setPostal(e.target.value)}
        />
      </label>
    </>
  );
}
