import { api } from "./apiClient";

/**
 * The unified "pay everything at once" checkout. Settles the caller's own
 * outstanding obligations for ONE group in a single deposit: cycle savings + an
 * optional top-up + any number of loan repayments + any number of penalties.
 *
 * The member gets a single PawaPay prompt (mobile money) or hands the treasurer
 * one lump of cash, and is charged a single transaction fee. The backend prices
 * the grand total once and splits it across every obligation on settlement — see
 * the "combined" branch of settlement.service.js in chuma-api.
 */
export type CheckoutPayload = {
  groupId: string;
  /** Cycle savings portion (>= 0). */
  contribution?: number;
  /** Extra savings above the base total (>= 0). */
  topup?: number;
  /** Loan repayments, each capped server-side to the loan's outstanding. */
  repayments?: { loanId: string; amount: number }[];
  /** Pending penalties to clear (all must be the caller's, same group). */
  penaltyIds?: string[];
  /** Project-fund groups (church) only: which project the savings pay into.
   *  Required by the API whenever the savings leg is above zero. */
  projectId?: string;
  /** "MTN MoMo" | "Airtel Money" | "Zamtel Kwacha" | "Cash" | … */
  paymentMethod: string;
  payerPhone?: string;
};

export type CheckoutResult = {
  transaction: any;
  pricing?: {
    base: number;
    platformFee: number;
    depositAmount: number;
    feesCovered: number;
  };
  message?: string;
};

export async function checkout(payload: CheckoutPayload): Promise<CheckoutResult> {
  return api("/payments/checkout", { method: "POST", body: payload });
}
