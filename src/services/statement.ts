// Member account statement — the bank-statement view of one member's money.
//
// The running balance tracks SAVINGS only (contributions in, share-out out),
// so `closingBalance` reconciles with the savings figure shown everywhere else
// in the app. Loans, repayments, penalties and fees are real cash movements
// that touch no savings figure, so they are reported under `activity` with
// their own money-in/money-out totals. See chuma-api statement.service.js.

import { api } from "./apiClient";
import type { GroupType } from "@/src/types";

export type StatementTxnType =
  | "contribution"
  | "combined"
  | "loan"
  | "repayment"
  | "share-out"
  | "penalty"
  | "fee"
  | "withdrawal";

export interface StatementLine {
  id: string;
  date: string;
  type: StatementTxnType;
  groupName: string;
  description: string;
  note: string;
  delta: number; // signed savings movement
  balance: number; // running savings balance after this line
  status: "completed" | "pending" | "failed";
  receiptId: string | null;
}

export interface StatementActivity {
  id: string;
  date: string;
  type: StatementTxnType;
  groupName: string;
  description: string;
  note: string;
  amount: number; // absolute
  direction: "in" | "out";
  status: "completed" | "pending" | "failed";
  receiptId: string | null;
}

/**
 * One line of the cash breakdown: what a slice of the period's money was FOR.
 *
 * Built by the backend from each transaction's own meta, so a single combined
 * payment shows up as its legs — savings, loan repayment, penalties — rather
 * than as one lump the member cannot account for. The rows on each side always
 * sum to that side's total.
 */
export interface StatementPurpose {
  key: string;
  label: string;
  amount: number; // positive magnitude
  count: number;
}

/**
 * One project a member gave toward in the period.
 *
 * Only project-fund groups produce these — a savings contribution buys a stake,
 * not a project — so an empty array is the normal case and is what the client
 * keys the whole section off. `amount` is what THIS member gave; `collected`
 * and `targetAmount` are the group's progress, shown beside it for context.
 *
 * Giving that names no project (made before the group opened one, or to a
 * project since archived) arrives as a single "General giving" row with a null
 * `projectId`, so the rows still sum to `savingsIn`.
 */
export interface StatementProject {
  projectId: string | null;
  name: string;
  groupId: string;
  groupName: string;
  targetAmount: number | null;
  collected: number;
  status: "active" | "completed" | "archived" | null;
  amount: number;
  count: number;
}

export interface Statement {
  statementId: string;
  generatedAt: string;
  period: { from: string; to: string };
  member: { name: string; phone: string };
  group: { id: string; name: string; groupType?: GroupType; role: string } | null;
  openingBalance: number;
  closingBalance: number;
  savingsIn: number;
  savingsOut: number;
  totals: {
    moneyIn: number;
    moneyOut: number;
    net: number;
    pending: number;
    byType: Record<string, { count: number; in: number; out: number }>;
  };
  /** Per-project giving. Empty for savings groups; absent on an older API. */
  projects?: StatementProject[];
  /** Optional: absent when talking to an API older than the breakdown. */
  breakdown?: {
    in: StatementPurpose[];
    out: StatementPurpose[];
  };
  lines: StatementLine[];
  activity: StatementActivity[];
}

export async function getStatement(opts: {
  from: Date;
  to: Date;
  groupId?: string | null;
}): Promise<Statement> {
  const params = new URLSearchParams({
    from: opts.from.toISOString(),
    to: opts.to.toISOString(),
  });
  if (opts.groupId) params.set("groupId", opts.groupId);
  const res = await api<{ statement: Statement }>(`/statement?${params}`);
  return res.statement;
}
