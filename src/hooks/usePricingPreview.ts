import { useEffect, useState } from "react";
import { api } from "@/src/services/apiClient";

// Server-computed fee breakdown for a payout (share-out or loan disbursement).
// The client NEVER computes these — it only displays what /pricing/preview
// returns. When fees would exceed the amount, the server responds { tooSmall }.
export type PayoutPreview =
  | {
      owed: number;
      platformFee: number;
      transactionFee: number;
      totalFees: number;
      netReceived: number;
      tooSmall?: false;
    }
  | { tooSmall: true; reason?: string };

export type ContributionPreview = {
  base: number;
  platformFee: number;
  depositAmount: number;
  feesCovered: number;
  // The member's OWN network fee (charged by their MMO to their wallet, not
  // collected by us). Display-only heads-up. May be absent on older responses.
  networkFee?: number;
};

/**
 * Debounced POST /pricing/preview. Fires on amount changes (default 400ms
 * debounce) so we don't send a request per keystroke, and never throws into
 * render — failures surface as `error`, keeping the screen alive.
 */
export function usePricingPreview<T = PayoutPreview>(
  kind: "contribution" | "payout",
  amount: number,
  opts: { debounceMs?: number; enabled?: boolean } = {}
): { data: T | null; loading: boolean; error: string | null } {
  const { debounceMs = 400, enabled = true } = opts;
  const active = enabled && amount > 0;
  // Identifies the request a settled result belongs to, so loading and error can
  // be derived from it instead of being reset synchronously inside the effect.
  const key = kind + ":" + amount;
  const [settled, setSettled] = useState<{
    key: string;
    data: T | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await api<T>("/pricing/preview", {
          method: "POST",
          body: { kind, amount },
        });
        if (!cancelled) setSettled({ key, data: res, error: null });
      } catch (e: any) {
        if (!cancelled) {
          setSettled({
            key,
            data: null,
            error: e?.message || "Couldn't load fees. Please try again.",
          });
        }
      }
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, key, kind, amount, debounceMs]);

  // Loading until the settled result is the one for the current request. The
  // last payload is kept on screen while the next one is in flight, but an error
  // only ever belongs to the request that produced it.
  const fresh = settled?.key === key;
  return {
    data: active ? settled?.data ?? null : null,
    loading: active && !fresh,
    error: active && fresh ? settled.error : null,
  };
}
