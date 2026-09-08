// What a statement CALLS things, per group type.
//
// A savings group and a church group hold a member's money for opposite
// reasons: one keeps a stake that comes back at share-out, the other takes a
// gift that funds a project and is never repaid. The figures the API returns
// are the same either way — it is the words around them that have to change,
// or a church member reads "closing savings balance" as money they are owed.
//
// The screen, the PDF and the CSV all read from here so the copy a member sees
// and the copy they hand to someone else cannot drift apart. Adding a group
// type means adding a flavour below, not hunting for strings in three files.
//
// Shape does NOT vary by flavour, only wording. Every statement reads the same
// way on screen — the totals card, then the activity, and the detail behind any
// one line a tap away on its receipt — because a phone statement is read
// standing up. The exports stay full for every flavour: a document handed to
// someone else is read at a desk, and the itemisation is why it exists. So the
// ledger and breakdown labels below are export-only copy.

import { GroupType, isProjectFundType } from "@/src/types";
import type { StatementTxnType } from "@/src/services/statement";

export type StatementFlavour = "savings" | "project-fund";

export interface StatementCopy {
  /** Cover label on the PDF and the first line of the CSV. */
  docLabel: string;
  /** Big figure at the top of the screen; the screen upper-cases it. */
  balanceLabel: string;
  summaryTitle: string;
  openingLabel: string;
  /** Money in — a contribution, or a gift. */
  inLabel: string;
  /** Money out. `null` where the type never pays anything back, which drops
   *  the row rather than showing a permanent zero. */
  outLabel: string | null;
  closingLabel: string;
  /** Exports only — the screen carries no ledger. See the note at the top. */
  ledgerTitle: string;
  ledgerEmpty: string;
  /** Heading over the movement list. */
  activityTitle: string;
  /**
   * What to call a movement, where the API's own wording is written for a
   * savings group. Only the types that actually read wrong need an entry;
   * everything else falls through to the description the API sent.
   */
  activityLabels: Partial<Record<StatementTxnType, string>>;
  /** Heading over the per-project rows. Only a flavour with projects uses it. */
  projectsTitle: string;
  /** Column heading for what this member gave to each project. */
  projectsAmountLabel: string;
  /** The ledger's own first and last rows, which bracket the running balance. */
  ledgerOpeningRow: string;
  ledgerClosingRow: string;
  /** Sits under the figures on screen; the PDF uses `footnotePdf`. */
  footnote: string;
  footnotePdf: string;
  /** Stem of the exported file name. */
  fileStem: string;
}

const COPY: Record<StatementFlavour, StatementCopy> = {
  savings: {
    docLabel: "Savings statement",
    balanceLabel: "Closing savings balance",
    summaryTitle: "Savings summary",
    openingLabel: "Opening balance",
    inLabel: "Contributions",
    outLabel: "Share-out paid",
    closingLabel: "Closing balance",
    ledgerTitle: "Savings account",
    ledgerEmpty: "No savings movement in this period.",
    activityTitle: "All activity",
    // The API already words these for a savings group.
    activityLabels: {},
    // A savings group has no projects, so these never render.
    projectsTitle: "Projects",
    projectsAmountLabel: "You gave",
    ledgerOpeningRow: "Opening balance",
    ledgerClosingRow: "Closing balance",
    footnote:
      "Your savings balance counts contributions and share-outs only. Loans, repayments, penalties and fees are real money and show in your activity, but they do not change your stake. Tap any line for its receipt.",
    footnotePdf:
      "This is an official Chuma statement. The balance shown is your savings stake in the group — contributions and share-outs only. Loans, repayments, penalties and fees are real money and are itemised under Where your money went; they do not change your stake.",
    fileStem: "Chuma-Statement",
  },
  "project-fund": {
    docLabel: "Giving statement",
    balanceLabel: "Total given",
    summaryTitle: "Giving summary",
    openingLabel: "Given before this period",
    inLabel: "Given this period",
    // A project fund never shares out, so there is no counterpart to giving.
    outLabel: null,
    closingLabel: "Total given",
    ledgerTitle: "Giving record",
    ledgerEmpty: "No giving in this period.",
    activityTitle: "Activity",
    activityLabels: {
      // "Cycle contribution" is a savings group's word for it, and a member
      // reading a lump payment does not need to be told which internal type
      // produced it. A combined payment is not all giving, so it is not called
      // giving.
      contribution: "Giving",
      combined: "Payment",
    },
    projectsTitle: "What you gave toward",
    projectsAmountLabel: "You gave",
    ledgerOpeningRow: "Brought forward",
    ledgerClosingRow: "Total given",
    footnote:
      "This total is what you have given, not a balance you can draw on — a project fund is never shared out. Fees and penalties show in your activity, but they do not count as giving. Tap any line for its receipt.",
    footnotePdf:
      "This is an official Chuma statement. The total shown is what this member has given toward the group's projects. A project fund is not repaid and is never shared out, so nothing here is a claim on the group. Fees are real money and are itemised under Where your money went; they do not count as giving.",
    fileStem: "Chuma-Giving-Statement",
  },
};

export const statementCopy = (flavour: StatementFlavour): StatementCopy => COPY[flavour];

/**
 * What one movement is called on this kind of statement.
 *
 * The project it paid into wins whenever the API supplies one: a church member
 * gave to a named thing, and "Church building" is the only label that answers
 * the question they opened the statement to ask. Below that sits the per-type
 * wording, and below that the description the API sent — which is already the
 * right one for a savings group.
 *
 * Screen and exports both go through here, so the line a member taps and the
 * line they hand to someone else carry the same name.
 */
export const movementLabel = (
  copy: StatementCopy,
  movement: {
    type: StatementTxnType;
    description: string;
    projectLabel?: string | null;
  }
): string =>
  movement.projectLabel ??
  copy.activityLabels[movement.type] ??
  movement.description;

/**
 * Which wording a statement should use.
 *
 * A statement scoped to one group follows that group's type. Scoped to "All
 * groups" it can only use the giving wording when EVERY group gives toward
 * projects — mixing a church group in with a savings group leaves the savings
 * wording, which is the one that still describes a share-out correctly.
 */
export function statementFlavourFor(
  groupTypes: (GroupType | undefined)[]
): StatementFlavour {
  return groupTypes.length > 0 && groupTypes.every((t) => isProjectFundType(t))
    ? "project-fund"
    : "savings";
}
