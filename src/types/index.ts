export type Role = "Chairperson" | "Treasurer" | "Secretary" | "Member";

export interface Member {
  id: string;
  userId?: string;
  name: string;
  role: Role;
  phone: string;
  avatar?: string;
  savings: number;
  contributions: number;
  loanActive?: number;
  // "pending" = invited but hasn't accepted yet. They are NOT part of the group
  // until they accept — don't count them, don't show them as members.
  status?: "pending" | "active" | "removed";
  invitedByName?: string;
  invitedAt?: string;
  lastInviteSentAt?: string;
  // Frozen at removal. A former member's row is kept as the group's record of
  // them — savings goes to 0 when the refund lands, these do not.
  exitedAt?: string;
  exitSavings?: number;
  exitRefund?: number;
  exitLoanCleared?: number;
}

export type GroupType =
  | "savings-group"
  | "cooperative"
  | "womens-group"
  | "church-group"
  | "investment-group";

/**
 * Types that collect toward NAMED PROJECTS instead of running a contribution
 * cycle. A church group takes whatever members choose to give, whenever they
 * give it, and spends it on the project it was given for — so it has no fixed
 * amount, no frequency, no deadline, no late penalty, no loans and no
 * share-out. What it has instead is `Group.projects`.
 * Mirrors PROJECT_FUND_TYPES in the API's logic.service.js.
 */
export const PROJECT_FUND_TYPES: GroupType[] = ["church-group"];

export const isProjectFundType = (t?: GroupType | "" | null): boolean =>
  !!t && PROJECT_FUND_TYPES.includes(t);

/** A thing the group is raising money for — "Church building", "Mission trip". */
export interface GroupProject {
  id: string;
  name: string;
  targetAmount: number | null; // null = no goal set
  collected: number;
  status: "active" | "completed" | "archived";
  createdAt?: string;
}

// A repayment tier caps how long a loan may run based on its size. Loans are
// matched to the first tier whose `maxAmount` covers the amount; the top tier
// uses `maxAmount: null` to catch everything above the last band. This lets a
// K200 loan be repaid quickly while a K5,000 loan gets a longer term.
export interface LoanRepaymentTier {
  maxAmount: number | null; // inclusive upper bound of the band; null = no cap (top tier)
  maxMonths: number; // longest repayment term allowed for loans in this band
}

export interface GroupConstitution {
  penaltyRules: {
    lateContribution: { enabled: boolean; penaltyType: "flat" | "percent"; penaltyRate?: number; penaltyAmount?: number };
    missingMeeting: { enabled: boolean; amount: number };
    lateRepayment: { enabled: boolean; penaltyType: "flat" | "percent"; penaltyRate?: number; penaltyAmount?: number };
  };
  gracePeriodDays: number;
  loanMultiplier: number;
  loanInterestRate: number;
  loanRepaymentMonths: number; // legacy single cap — kept as a fallback
  loanRepaymentTiers?: LoanRepaymentTier[];
  // No new loans may be issued within this many months of share-out, so every
  // loan is due before the cycle closes. VSLA norm is 1–2 months.
  loanFreeWindowMonths?: number;
  internalLendingEnabled: boolean;
  approvalThreshold: "2-of-3" | "majority" | "all";
  penaltyFundsDestination?: "group-pool" | "emergency-fund" | "welfare-account";
}

export interface GroupGovernance {
  chairperson: "self" | string;
  treasurerPhone: string | null;
  secretaryPhone: string | null;
  approvalThreshold: GroupConstitution["approvalThreshold"];
  permissions: Record<string, boolean>;
}

export interface FeeStatus {
  status: "paid" | "grace" | "locked";
  daysIntoGrace: number;
  daysLeft: number;
  monthsOwed: number;
  amountOwed: number;
  locked: boolean;
}

export interface Group {
  id: string;
  name: string;
  description: string;
  groupType?: GroupType;
  constitution?: GroupConstitution;
  governance?: GroupGovernance;
  totalSavings: number;
  walletBalance: number;
  loanCirculation: number;
  memberCount: number;
  cycleProgress: number; // 0-1
  shareOutDate: string;
  contributionAmount: number;
  contributionFrequency: string;
  loanInterestRate: number; // % per month
  loanMaxMultiplier: number; // x of savings
  members: Member[];
  /** Savings projects. Only project-fund types (church) have any — see
   *  isProjectFundType. Always set by the service layer; optional so older
   *  shapes still type. */
  projects?: GroupProject[];
  /** Removed members, kept as history. Never counted as members of the group.
   *  Always set by the service layer; optional so older shapes still type. */
  formerMembers?: Member[];
  yourRole: Role;
  healthScore?: number;
  savingsGrowth?: number;
  repaymentRate?: number;
  defaults?: number;
  nextContributionDate?: string;
  nextContributionAmount?: number;
  memberRetention?: number;
  registrationFee?: number;
  registrationPaid?: boolean;
  registrationPaidAt?: string;
  registrationMethod?: string;
  monthlyFee?: number;
  feeDueDay?: number;
  feePaidThrough?: string;
  feeStatus?: FeeStatus;
  createdAt?: string;
}

export interface TxnItem {
  id: string;
  type: "contribution" | "loan" | "repayment" | "share-out" | "withdrawal" | "penalty" | "fee";
  amount: number;
  status: "completed" | "pending" | "failed";
  groupId: string;
  groupName: string;
  memberId?: string;
  date: string;
  note?: string;
  direction: "in" | "out";
  networkFee?: number; // member's own MMO fee on money-in (display-only, stored on the txn)
}

export interface Loan {
  id: string;
  groupId: string;
  groupName: string;
  memberId: string;
  memberName: string;
  principal: number;
  outstanding: number;
  interestRate: number;
  durationMonths: number;
  installmentAmount: number;
  nextDueDate: string;
  installmentsPaid: number;
  totalInstallments: number;
  status: "active" | "pending" | "completed" | "rejected";
  history: { date: string; amount: number; type: "disbursement" | "repayment" }[];
}

/** One admin's decision on an approval — the row of its history trail. */
export interface ApprovalVote {
  /** Who voted. Absent on older votes recorded before the id was stored. */
  adminId?: string;
  adminName: string;
  decision: "approve" | "reject";
  at: string;
}

export interface Approval {
  id: string;
  type:
    | "loan"
    | "withdrawal"
    | "rule-change"
    | "admin-action"
    | "member-removal"
    | "group-deletion"
    | "share-out"
    // An admin acknowledging that cash physically reached them. Needs one
    // admin, not a quorum — see the API's cashReceipt service.
    | "cash-receipt";
  title: string;
  description: string;
  requestedBy: string;
  requestedById: string;
  amount?: number;
  groupId: string;
  groupName: string;
  votesFor: number;
  votesAgainst: number;
  totalVoters: number;
  /** share-out only: how this run pays. Voters are approving the method too —
   *  "manual" means the group pays each member itself (notes, the treasurer's
   *  own mobile money, a bank transfer) and confirms each one in the app. */
  payoutMethod?: "manual" | "mobile-money";
  timestamp: string;
  // "executed" = approved AND its action has run (a refund paid, a share-out
  // distributed). An approved-but-not-executed action can be run again.
  status: "pending" | "approved" | "rejected" | "executed";
  /** cash-receipt only: whose duty this receipt is. The treasurer, who keeps
   *  the cash box — and the chairperson only when the group has no treasurer.
   *  Any admin may still confirm it; this is who it was addressed to. Absent on
   *  receipts raised before the role was recorded. */
  confirmerRole?: "Treasurer" | "Chairperson";
  /** Who a member-removal is about — they never vote on their own removal. */
  targetUserId?: string;
  targetName?: string;
  /** Who decided, and when — shown on resolved approvals in the history. */
  votes?: ApprovalVote[];
  /** When it stopped being pending. Absent while still pending. */
  resolvedAt?: string;
}

export interface Penalty {
  id: string;
  groupId: string;
  groupName: string;
  memberId: string;
  memberName: string;
  violationType: "lateContribution" | "missingMeeting" | "lateRepayment" | "other";
  reason: string;
  amount: number;
  fundsDestination: "group-pool" | "emergency-fund" | "welfare-account";
  status: "pending" | "paid";
  createdAt: string;
  dueContext?: string;
}

export interface Notice {
  id: string;
  /** "invite" is actionable; "invite_accepted" is the inviter's confirmation. */
  type:
    | "loan"
    | "contribution"
    | "governance"
    | "security"
    | "repayment"
    | "invite"
    | "invite_accepted"
    | "penalty"
    | "kyc";
  title: string;
  body: string;
  date: string;
  read: boolean;
  groupId?: string;
  groupName?: string;
  invitedBy?: string;
  penaltyAmount?: number;
  penaltyReason?: string;
  penaltyId?: string;
  transactionId?: string;
}
