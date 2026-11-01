import { createHash } from "node:crypto";
import type { Hotel } from "@travel/core";
import { env } from "./env";

/**
 * Live hotel rates.
 *
 * Provider: Expedia Group Rapid API (partner access required).
 * Docs: https://developers.expediagroup.com/docs/products/rapid
 *
 * Live rates are fetched only for hotels whose Expedia property id is known.
 * Curators attach that id to "stay" local picks in the Local picks admin; a
 * hotel the planner chooses from those picks then gets real nightly prices
 * for the traveler's dates. Every other hotel shows the planner's estimate.
 *
 * This adapter follows Rapid's documented signature auth and the
 * GET /v3/properties/availability endpoint. Verify it against your partner
 * test environment (EXPEDIA_RAPID_BASE_URL=https://test.ean.com) before launch.
 */

export const liveRatesEnabled = () => {
  const e = env.expedia();
  return !!(e.apiKey && e.secret);
};

function authHeader(): string {
  const { apiKey, secret } = env.expedia();
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = createHash("sha512").update(apiKey + secret + ts).digest("hex");
  return `EAN APIKey=${apiKey},Signature=${sig},timestamp=${ts}`;
}

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

interface RapidRate {
  occupancy_pricing?: Record<string, { totals?: { inclusive?: { request_currency?: { value?: string; currency?: string } } } }>;
}
interface RapidProperty {
  property_id: string;
  rooms?: { rates?: RapidRate[] }[];
}

/**
 * Attach live rates (lowest available inclusive total) to hotels that carry an Expedia id.
 * Never throws: on any failure hotels keep their estimate.
 */
export async function attachLiveRates(
  hotels: (Hotel & { expediaPropertyId?: string | null })[],
  startDate: string | null | undefined,
  nights: number,
  adults: number,
  customerIp: string,
): Promise<void> {
  if (!liveRatesEnabled() || !startDate) return;
  const withIds = hotels.filter((h) => h.expediaPropertyId);
  if (!withIds.length) return;

  const checkin = startDate;
  const checkout = addDays(startDate, Math.max(1, nights));
  const params = new URLSearchParams({
    checkin,
    checkout,
    currency: "USD",
    country_code: "US",
    language: "en-US",
    occupancy: String(Math.max(1, Math.min(8, adults))),
    rate_plan_count: "1",
    sales_channel: "website",
    sales_environment: "hotel_only",
  });
  withIds.forEach((h) => params.append("property_id", h.expediaPropertyId!));

  try {
    const res = await fetch(`${env.expedia().baseUrl}/v3/properties/availability?${params}`, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        Authorization: authHeader(),
        "User-Agent": "TravelApp/0.1",
        "Customer-Ip": customerIp || "127.0.0.1",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error("Rapid availability failed", res.status, await res.text().catch(() => ""));
      return;
    }
    const props = (await res.json()) as RapidProperty[];
    const fetchedAt = new Date().toISOString();
    for (const prop of props) {
      let best: number | null = null;
      for (const room of prop.rooms ?? [])
        for (const rate of room.rates ?? [])
          for (const occ of Object.values(rate.occupancy_pricing ?? {})) {
            const v = Number(occ.totals?.inclusive?.request_currency?.value);
            if (Number.isFinite(v) && (best === null || v < best)) best = v;
          }
      if (best === null) continue;
      const hotel = withIds.find((h) => h.expediaPropertyId === prop.property_id);
      if (!hotel) continue;
      hotel.liveRate = {
        provider: "expedia",
        totalUsd: Math.round(best),
        nightlyUsd: Math.round(best / Math.max(1, nights)),
        checkin,
        checkout,
        fetchedAt,
      };
    }
  } catch (e) {
    console.error("Rapid availability error", e);
  }
}

export const adultsFor = (party: string) => (party === "Solo" ? 1 : party === "Group of friends" ? 4 : 2);
