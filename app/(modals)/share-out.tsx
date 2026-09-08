import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScreenHeader } from "@/src/components/common/ScreenHeader";
import { Card } from "@/src/components/ui/Card";
import { Button } from "@/src/components/ui/Button";
import { Avatar } from "@/src/components/ui/Avatar";
import { StatusBadge } from "@/src/components/ui/StatusBadge";
import { ProgressBar } from "@/src/components/ui/ProgressBar";
import { useTheme } from "@/src/theme/ThemeContext";
import {
  computeShareOut,
  estimateGroupProfit,
  getMyShare,
  proposeShareOut,
  getShareOutPayouts,
  ShareOutPayout,
  ShareOutPayouts,
  ShareOutCompleted,
  ShareOutHistorySummary,
} from "@/src/services/shareOut";
import { confirmPayout } from "@/src/services/transactions";
import { getApprovals, getRequiredApprovals, voteOnApproval } from "@/src/services/approvals";
import { getGroups } from "@/src/services/groups";
import { getPenalties } from "@/src/services/penalties";
import { getCurrentUser } from "@/src/utils/currentUser";
import { Group, Penalty, Approval } from "@/src/types";
import { formatZMW } from "@/src/utils/currency";
import { MOBILE_MONEY_ON_HOLD } from "@/src/constants";
import { usePricingPreview, PayoutPreview } from "@/src/hooks/usePricingPreview";
import {
  Sparkles,
  Check,
  Lock,
  Clock,
  HandCoins,
  AlertTriangle,
  Smartphone,
  ChevronRight,
} from "lucide-react-native";
import { useAsyncEffect } from "@/src/hooks/useAsyncEffect";

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

/**
 * Where one member's money actually is. The distinction that matters is not
 * paid vs unpaid but who we are waiting on: pawaPay answers for itself, while a
 * payout the group makes on its own is unpaid until an admin says otherwise.
 */
function PayoutStatus({ p, colors }: { p: ShareOutPayout; colors: any }) {
  const line = (Icon: any, color: string, text: string) => (
    <View style={{ flexDirection: "row", alignItems: "center", marginTop: 3 }}>
      <Icon size={12} color={color} strokeWidth={2.5} />
      <Text style={{ color, fontSize: 11, fontWeight: "600", marginLeft: 4 }} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );

  if (p.status === "failed")
    return line(AlertTriangle, colors.danger, "Payout failed");

  if (p.status === "completed") {
    // Their whole share went to their own loan, so there was never anything to
    // hand over — say that rather than claiming we paid them nothing.
    if (p.amount <= 0 && p.appliedToLoan > 0)
      return line(Check, colors.textMuted, "Cleared against their loan");
    if (p.viaMobileMoney) return line(Check, colors.success, "Sent to mobile wallet");
    return line(
      Check,
      colors.success,
      [p.paymentMethod ? `Paid · ${p.paymentMethod}` : "Paid", p.confirmedByName]
        .filter(Boolean)
        .join(" · ")
    );
  }

  if (p.viaMobileMoney) return line(Clock, colors.textMuted, "Sending to wallet…");
  return line(Clock, colors.warning, "Not paid yet");
}

export default function ShareOutScreen() {
  const { colors } = useTheme();
  const router = useRouter();

  const { groupId } = useLocalSearchParams<{ groupId?: string }>();
  const activeGroupId = groupId ?? "";

  const [groups, setGroups] = useState<Group[]>([]);
  const [penalties, setPenalties] = useState<Penalty[]>([]);
  const [myUserId, setMyUserId] = useState("");
  const [loading, setLoading] = useState(true);

  const [shareOutApproval, setShareOutApproval] = useState<Approval | null>(null);
  const [voting, setVoting] = useState(false);
  const [approvalError, setApprovalError] = useState("");
  const [justApproved, setJustApproved] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  // Whether MY approve vote is on this cycle's share-out, read back from the
  // server so it survives a reload — not just something this session did.
  const [approvedShareOutMyself, setApprovedShareOutMyself] = useState(false);
  // The newest share-out approval whatever its status. The pending fetch above
  // loses it the moment the vote carries; this is what still remembers the
  // votes and the method a run in progress was approved with.
  const [latestShareOut, setLatestShareOut] = useState<Approval | null>(null);

  // The distribution the group is CURRENTLY paying out: one row per member
  // saying whether they have their money yet. It empties when the last member
  // is settled — a finished share-out is history, and history lives in Reports.
  const [payouts, setPayouts] = useState<ShareOutPayout[]>([]);
  const [payoutTotals, setPayoutTotals] = useState<ShareOutPayouts["totals"]>(null);
  const [confirmingId, setConfirmingId] = useState("");
  const [confirmError, setConfirmError] = useState("");

  // The last distribution, once it is over. Kept only to say it happened and
  // point at the report — the screen itself is back to the next cycle.
  const [lastCompleted, setLastCompleted] = useState<ShareOutCompleted | null>(null);
  // Every cycle the group has ever closed, as a count and a running total. The
  // receipt line is about the group's record, not about one run.
  const [history, setHistory] = useState<ShareOutHistorySummary | null>(null);
  // The run finished on THIS screen, in this session. Marking the final member
  // paid should land as an ending, not as the list silently emptying.
  const [justFinished, setJustFinished] = useState(false);

  // How the group pays this time. The constant is only the opening guess — the
  // server is the authority on whether pawaPay can disburse today, so the
  // picker unlocks the moment the hold lifts without shipping a new build.
  const [mobileMoneyHold, setMobileMoneyHold] = useState(MOBILE_MONEY_ON_HOLD);
  const [runMethod, setRunMethod] = useState<"manual" | "mobile-money" | null>(null);
  const [chosenMethod, setChosenMethod] = useState<"manual" | "mobile-money">("manual");

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [g, p, user, approvalsForGroup, everyApproval, dist] = await Promise.all([
        getGroups(),
        getPenalties({ groupId: activeGroupId }),
        getCurrentUser<{ _id: string }>(),
        getApprovals({ groupId: activeGroupId }),
        // The pending list above empties the moment the vote carries, so the
        // record of who approved this distribution only survives in the
        // resolved history. Handing out money depends on it — see myApproval.
        getApprovals({ groupId: activeGroupId, status: "all" }).catch(() => []),
        // A group that has never distributed has no payouts; that is not an
        // error and must not blank the rest of the screen.
        getShareOutPayouts(activeGroupId).catch(
          () =>
            ({
              shareOutId: null,
              payouts: [],
              totals: null,
              method: null,
              lastCompleted: null,
              history: null,
              mobileMoneyHold: MOBILE_MONEY_ON_HOLD,
            }) as ShareOutPayouts
        ),
      ]);
      setGroups(g);
      setPenalties(p);
      const uid = user?._id ? String(user._id) : "";
      setMyUserId(uid);
      setShareOutApproval(approvalsForGroup.find((a) => a.type === "share-out") ?? null);
      // Newest first from the API, so the first share-out row is this cycle's.
      const latestShareOut = everyApproval.find((a) => a.type === "share-out");
      setLatestShareOut(latestShareOut ?? null);
      setApprovedShareOutMyself(
        !!uid &&
          !!latestShareOut?.votes?.some(
            (v) => v.decision === "approve" && String(v.adminId ?? "") === uid
          )
      );
      setPayouts(dist.payouts);
      setPayoutTotals(dist.totals);
      setRunMethod(dist.method);
      setLastCompleted(dist.lastCompleted ?? null);
      setHistory(dist.history ?? null);
      setMobileMoneyHold(dist.mobileMoneyHold);
      // Nothing to choose while pawaPay cannot pay anyone.
      if (dist.mobileMoneyHold) setChosenMethod("manual");
      // Handed back so the caller can tell the difference between a run that is
      // still going and one that just ended on this screen.
      return dist;
    } finally {
      setLoading(false);
    }
  }, [activeGroupId]);

  useAsyncEffect(load);

  const group = groups.find((g) => g.id === activeGroupId);

  const penaltyIncome = penalties
    .filter(
      (p) =>
        p.groupId === activeGroupId &&
        p.status === "paid" &&
        p.fundsDestination === "group-pool"
    )
    .reduce((sum, p) => sum + p.amount, 0);

  const cycleMonths = group?.constitution?.loanRepaymentMonths ?? 12;

  const computedProfit = group
    ? estimateGroupProfit(
        group.loanCirculation ?? 0,
        group.loanInterestRate ?? 0,
        cycleMonths,
        penaltyIncome
      )
    : 0;

  const members = group
    ? (group.members ?? [])
        // Someone who never accepted the invite has no savings and no share.
        .filter((m: any) => m.status !== "pending")
        .map((m: any) => ({
          id: String(m.userId ?? m.id), name: m.name, contribution: m.savings,
        }))
    : [];

  const result = computeShareOut(members, computedProfit);

  const myId = myUserId;
  const myShare = getMyShare(result.members, myId);

  // The group's share-out record. An API that predates the summary still has a
  // finished run to report, so fall back to counting that one rather than
  // dropping the line the moment the numbers are missing.
  const historyRuns = history?.runs ?? (lastCompleted ? 1 : 0);
  const historyDistributed = history?.totalDistributed ?? lastCompleted?.totalPaid ?? 0;

  // Once a distribution has run, the allocations list stops being a projection
  // and becomes the record of it. It has to: settling a member's payout zeroes
  // their savings, so recomputing shares mid-distribution would show everyone
  // already paid as being owed nothing.
  const distributionStarted = payouts.length > 0;

  // A run that still owes somebody is mid-flight. It matters because the
  // approval that authorised it stops being pending the moment it carries, and
  // GET /approvals returns pending only — so on the next load there is nothing
  // left saying this group already voted, and the screen would offer to start
  // the share-out it is in the middle of paying out.
  const distributionInProgress =
    distributionStarted && !!payoutTotals && payoutTotals.paid < payoutTotals.count;

  // Every lock on this screen hangs off the caller's REAL role in THIS group,
  // never the demo role switcher, or buttons appear for people the server will
  // refuse. services/groups already derives it from the active membership with
  // the id shapes normalised — re-deriving it here let a pending invite row, or
  // a populated userId, hand someone the wrong buttons.
  const myRole = group?.yourRole;
  // The treasurer pays members and marks them off. The chairperson stands in
  // only for a group that currently has no treasurer, matching the API.
  const hasTreasurer = (group?.members ?? []).some(
    (m: any) => m.status === "active" && m.role === "Treasurer"
  );
  const payoutRole =
    myRole === "Treasurer" || (myRole === "Chairperson" && !hasTreasurer);

  // Holding the role is not enough: whoever hands out the money must have put
  // their own name on the plan first. hasVoted covers the vote just cast in
  // this session, before the reload that would read it back from the server.
  const iApprovedShareOut = approvedShareOutMyself || hasVoted;
  const canConfirmPayout = payoutRole && iApprovedShareOut;

  // Ending the cycle starts with the chairperson and nobody else.
  const isChairperson = myRole === "Chairperson";
  const isAdmin =
    myRole === "Chairperson" || myRole === "Treasurer" || myRole === "Secretary";

  // What this distribution pays by, in order of how settled it is: what the
  // transactions actually did, then what the pending approval committed to,
  // then what the picker is currently showing.
  const effectiveMethod =
    runMethod ?? shareOutApproval?.payoutMethod ?? chosenMethod;
  const payingManually = effectiveMethod === "manual";

  const allocationRows = distributionStarted
    ? payouts.map((p) => ({
        key: p.transactionId,
        name: p.memberName,
        subtitle:
          p.appliedToLoan > 0
            ? `${formatZMW(p.appliedToLoan, { compact: true })} cleared their loan`
            : "",
        amount: p.amount,
        growthPct: null as number | null,
        payout: p,
      }))
    : result.members.map((m) => ({
        key: m.id,
        name: m.name,
        subtitle: `Contributed ${formatZMW(m.contribution, { compact: true })}`,
        amount: m.share,
        growthPct: m.growthPct as number | null,
        payout: null as ShareOutPayout | null,
      }));

  // Confirming is not undoable — it settles the member's stake, closes their
  // part of the cycle and sends them their receipt — so it asks first. It asks
  // HOW as well as whether: the group may have paid in notes or sent mobile
  // money from its own phone, and the ledger should say which.
  const handleMarkPaid = (p: ShareOutPayout) => {
    const settle = async (paymentMethod: string) => {
      setConfirmingId(p.transactionId);
      setConfirmError("");
      try {
        await confirmPayout(p.transactionId, paymentMethod);
        // Re-read everything: settling changes the group's wallet and the
        // member's savings, not just this one row.
        const dist = await load({ silent: true });
        // That was the last one. The server has already retired the run, so
        // without this the list would just vanish under the treasurer's finger.
        if (dist && !dist.payouts.length && dist.lastCompleted) setJustFinished(true);
      } catch (e: any) {
        setConfirmError(
          e?.message || "Could not confirm the payment. Please try again."
        );
      } finally {
        setConfirmingId("");
      }
    };

    Alert.alert(
      `Paid ${p.memberName}?`,
      `How did you pay their ${formatZMW(p.amount)}? This settles their share-out, sends their receipt, and cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Cash", onPress: () => settle("Cash") },
        { text: "Mobile money", onPress: () => settle("Mobile Money") },
      ]
    );
  };

  // What the CURRENT member will actually receive after fees, computed by the
  // server (never on the client). Debounced; only runs once we know their share.
  const {
    data: payout,
    loading: payoutLoading,
    error: payoutError,
  } = usePricingPreview<PayoutPreview>("payout", myShare, { enabled: myShare > 0 });

  function formatShareOutDate(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
    });
  }

  const displayDate = group?.shareOutDate
    ? formatShareOutDate(group.shareOutDate)
    : "";
  const displayName = group?.name ?? "";

  const shareOutISO = group?.shareOutDate ?? "";
  const now = new Date();
  const stageDates = {
    finalContrib: addDays(shareOutISO, -48),
    loansRecovered: addDays(shareOutISO, -30),
    audit: addDays(shareOutISO, -20),
    approvalVote: addDays(shareOutISO, -5),
    distribution: shareOutISO,
  };
  const timeline = [
    { date: stageDates.finalContrib, title: "Final cycle contributions due" },
    { date: stageDates.loansRecovered, title: "Outstanding loans recovered" },
    { date: stageDates.audit, title: "Group audit & report" },
    { date: stageDates.approvalVote, title: "Share-out approval vote" },
    { date: stageDates.distribution, title: "Distribution to members" },
  ].map((stage) => ({
    ...stage,
    done: new Date(stage.date).getTime() < now.getTime(),
  }));

  // Pending invites can't vote, so they must not raise the approval bar.
  const adminCount = (group?.members ?? []).filter(
    (m) =>
      m.status !== "pending" &&
      ["Chairperson", "Treasurer", "Secretary"].includes(m.role)
  ).length;
  // A share-out needs EVERY active admin, not the group's usual threshold:
  // this is the one decision that empties the pool and closes everyone's
  // savings. Mirrors getRequiredApprovals("all", …) on the server.
  const requiredApprovals = getRequiredApprovals("all", adminCount);

  // While a run is in progress its approval has already resolved, so fall back
  // to the historical record rather than reporting "0 of 3 approvals" for a
  // distribution the group unanimously voted through.
  const activeApproval =
    shareOutApproval ?? (distributionInProgress ? latestShareOut : null);

  const votesFor = activeApproval?.votesFor ?? 0;
  const required = activeApproval?.totalVoters ?? requiredApprovals;
  const approved =
    shareOutApproval?.status === "approved" || justApproved || distributionInProgress;

  // The picker only exists while there is still a choice to make: before anyone
  // has proposed this cycle's distribution.
  const showMethodPicker =
    !distributionStarted && !approved && !shareOutApproval && isChairperson;

  const handleApprove = async () => {
    setVoting(true);
    setApprovalError("");
    try {
      let approval = shareOutApproval;
      let approvalId = approval?.id;

      if (!approvalId) {
        // no pending approval yet — propose one, then re-fetch to get its id
        try {
          await proposeShareOut(activeGroupId, chosenMethod);
        } catch (e: any) {
          // "Share-out already pending" is fine — it means one exists; fall through to re-fetch
          if (!String(e?.message || "").toLowerCase().includes("already pending")) throw e;
        }
        const list = await getApprovals({ groupId: activeGroupId });
        approval = list.find((a) => a.type === "share-out") ?? null;
        setShareOutApproval(approval);
        approvalId = approval?.id;
      }
      if (!approvalId) throw new Error("Could not create share-out approval.");

      const priorVotesFor = approval?.votesFor ?? 0;
      const priorRequired = approval?.totalVoters ?? requiredApprovals;

      await voteOnApproval(approvalId, "approve");
      setHasVoted(true);

      // re-fetch to reflect new vote count / possible approval+execution
      const refreshed = await getApprovals({ groupId: activeGroupId });
      const updated = refreshed.find((a) => a.type === "share-out") ?? null;

      if (updated) {
        setShareOutApproval(updated);
      } else if (priorVotesFor + 1 >= priorRequired) {
        // Backend GET /approvals returns pending only — a missing result right
        // after our deciding vote means it was approved and executed.
        setJustApproved(true);
        setShareOutApproval(
          approval ? { ...approval, votesFor: priorVotesFor + 1, status: "approved" } : approval
        );
      } else {
        setShareOutApproval(null);
      }

      // A deciding vote runs the distribution server-side. Without this the
      // screen keeps showing the projection it was voting on, and the payout
      // rows only appear if you leave and come back.
      await load({ silent: true });
    } catch (e: any) {
      setApprovalError(e?.message || "Could not record approval. Please try again.");
    } finally {
      setVoting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]} testID="shareout-screen">
        <ScreenHeader title="Share-out" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // The last member was just marked paid. The cycle is done, and this screen
  // has nothing left to run — so it says so and hands off to the record,
  // rather than dropping the treasurer back into a projection of the next one.
  if (justFinished && lastCompleted) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: colors.background }}
        edges={["top"]}
        testID="shareout-screen"
      >
        <ScreenHeader title="Share-out" subtitle={displayName} />
        <ScrollView contentContainerStyle={styles.content}>
          <Card
            padding={24}
            style={{ backgroundColor: colors.primary, borderColor: colors.primary }}
            testID="shareout-complete"
          >
            <View style={styles.completeCheck}>
              <Check size={26} color={colors.primary} strokeWidth={3} />
            </View>
            <Text
              style={{ color: "#fff", fontSize: 22, fontWeight: "700", marginTop: 16, letterSpacing: -0.3 }}
            >
              Share-out complete
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.85)", marginTop: 6, lineHeight: 20 }}>
              {`All ${lastCompleted.memberCount} member${
                lastCompleted.memberCount === 1 ? "" : "s"
              } have been paid. ${formatZMW(
                lastCompleted.totalPaid
              )} was distributed and everyone has their receipt.`}
            </Text>
          </Card>

          <View
            style={[styles.methodNote, { backgroundColor: colors.surfaceSecondary, marginTop: 16 }]}
          >
            <Sparkles size={16} color={colors.textMuted} strokeWidth={2.2} />
            <Text style={{ flex: 1, color: colors.textBody, fontSize: 12, lineHeight: 17 }}>
              This cycle is closed. The full breakdown is kept in the group&apos;s
              share-out history, and this screen is now ready for the next one.
            </Text>
          </View>

          <Button
            label="View share-out report"
            onPress={() => router.replace(`/reports?groupId=${activeGroupId}` as never)}
            testID="shareout-complete-report-btn"
          />
          <View style={{ height: 10 }} />
          <Button
            label="Done"
            variant="outline"
            onPress={() => router.back()}
            testID="shareout-complete-done-btn"
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
      testID="shareout-screen"
    >
      <ScreenHeader title="Share-out" subtitle={displayName} />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Hero */}
        <Card
          padding={22}
          style={{ backgroundColor: colors.primary, borderColor: colors.primary }}
        >
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Sparkles size={20} color="#fff" />
            <Text style={{ color: "rgba(255,255,255,0.85)", fontWeight: "600", marginLeft: 8 }}>
              ANNUAL SHARE-OUT
            </Text>
          </View>
          <Text style={{ color: "#fff", fontSize: 32, fontWeight: "700", marginTop: 12, letterSpacing: -0.5 }}>
            {formatZMW(result.totalToDistribute)}
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.8)", marginTop: 4 }}>
            Distribution on {displayDate}
          </Text>
          <View style={styles.heroStats}>
            <View>
              <Text style={styles.heroStatLabel}>Savings</Text>
              <Text style={styles.heroStatVal}>{formatZMW(result.totalSavings, { compact: true })}</Text>
            </View>
            <View style={styles.heroDivider} />
            <View>
              <Text style={styles.heroStatLabel}>Profit</Text>
              <Text style={styles.heroStatVal}>{formatZMW(result.profit, { compact: true })}</Text>
            </View>
            <View style={styles.heroDivider} />
            <View>
              <Text style={styles.heroStatLabel}>Your share</Text>
              <Text style={styles.heroStatVal}>{formatZMW(getMyShare(result.members, myId), { compact: true })}</Text>
            </View>
          </View>
        </Card>

        {/* What the current member actually receives after fees */}
        {!distributionStarted && myShare > 0 && (
          <Card padding={18} style={{ marginTop: 16 }} testID="shareout-net-receive">
            {payoutLoading && !payout ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <ActivityIndicator color={colors.primary} />
                <Text style={{ color: colors.textMuted, fontSize: 13 }}>
                  Calculating what you&apos;ll receive…
                </Text>
              </View>
            ) : payoutError ? (
              <Text style={{ color: colors.textMuted, fontSize: 13 }} testID="shareout-net-error">
                Couldn&apos;t load your payout breakdown. Try again shortly.
              </Text>
            ) : payout?.tooSmall ? (
              <Text style={{ color: colors.textMuted, fontSize: 13 }} testID="shareout-net-toosmall">
                This amount is too small to pay out after fees.
              </Text>
            ) : payout ? (
              <>
                <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "600", letterSpacing: 0.3 }}>
                  YOU&apos;LL RECEIVE
                </Text>
                <Text style={{ color: colors.textMain, fontSize: 28, fontWeight: "700", letterSpacing: -0.5, marginTop: 4 }}>
                  {formatZMW(payout.netReceived)}
                </Text>
                <View style={[styles.netDivider, { backgroundColor: colors.border }]} />
                <NetRow label="Owed" value={formatZMW(payout.owed)} colors={colors} />
                {payingManually ? (
                  // Cash has no transfer or platform fee to deduct, so the
                  // member takes the whole share — say that instead of listing
                  // three zeroes.
                  <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 10, lineHeight: 17 }}>
                    Paid in cash by your treasurer. No fees are deducted, so you
                    take the full share.
                  </Text>
                ) : (
                  <>
                    <NetRow label="Transaction fee" value={formatZMW(payout.transactionFee)} colors={colors} />
                    <NetRow label="Platform fee" value={formatZMW(payout.platformFee)} colors={colors} />
                    <NetRow label="You receive" value={formatZMW(payout.netReceived)} colors={colors} last />
                  </>
                )}
              </>
            ) : null}
          </Card>
        )}

        {/* The cycles the group has already been through. Not this screen's
            business any more — but saying nothing would read as them never
            happening, so they get one line and a way in.

            Framed as the group's record rather than as the last run: a group
            four years in has four of these behind it, and a line that names
            only the most recent one both hides the others and promises a
            single breakdown where the tap opens a list. Count and running
            total say what is actually through there. */}
        {!distributionStarted && lastCompleted ? (
          <Pressable
            onPress={() =>
              router.push(
                // The record itself, not the reports screen that also carries a
                // preview of it — the same list the group's Reports tab opens.
                // One run behind them and even that list is a detour, so go
                // straight to the only thing on it.
                (historyRuns === 1
                  ? `/share-out-run?groupId=${activeGroupId}&shareOutId=${lastCompleted.shareOutId}`
                  : `/share-out-history?groupId=${activeGroupId}`) as never
              )
            }
            testID="shareout-last-completed"
            style={({ pressed }) => [
              styles.methodNote,
              {
                backgroundColor: colors.surfaceSecondary,
                marginTop: 16,
                marginBottom: 0,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Check size={16} color={colors.success} strokeWidth={2.5} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.textMain, fontSize: 13, fontWeight: "600" }}>
                {`${historyRuns} share-out${historyRuns === 1 ? "" : "s"} · ${formatZMW(
                  historyDistributed
                )} distributed`}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 }}>
                {historyRuns === 1
                  ? `Paid to ${lastCompleted.memberCount} member${
                      lastCompleted.memberCount === 1 ? "" : "s"
                    }${
                      lastCompleted.completedAt
                        ? ` on ${fmtDate(lastCompleted.completedAt)}`
                        : ""
                    }`
                  : `Most recent ${
                      lastCompleted.completedAt ? fmtDate(lastCompleted.completedAt) : "run"
                    } · ${lastCompleted.memberCount} member${
                      lastCompleted.memberCount === 1 ? "" : "s"
                    }`}
              </Text>
            </View>
            <ChevronRight size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}

        {/* Allocations */}
        <Text style={[styles.label, { color: colors.textMuted, marginTop: 24 }]}>
          {distributionStarted ? "DISTRIBUTION" : "MEMBER ALLOCATIONS"}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 11, marginBottom: 8 }}>
          {distributionStarted && payoutTotals
            ? `${payoutTotals.paid} of ${payoutTotals.count} paid${
                payoutTotals.outstanding > 0
                  ? ` · ${formatZMW(payoutTotals.outstanding)} still to pay`
                  : ""
              }`
            : `Profit from loan interest${penaltyIncome > 0 ? " + penalty income" : ""} this cycle`}
        </Text>
        {distributionStarted && payoutTotals ? (
          <View style={{ marginBottom: 10 }} testID="shareout-payout-progress">
            <ProgressBar
              progress={payoutTotals.count > 0 ? payoutTotals.paid / payoutTotals.count : 0}
            />
          </View>
        ) : null}
        {confirmError ? (
          <Text
            style={{ color: colors.danger, fontSize: 12, marginBottom: 8 }}
            testID="shareout-confirm-error"
          >
            {confirmError}
          </Text>
        ) : null}
        {/* Normally unreachable — every admin has to approve before a single
            payout exists. It catches the treasurer appointed AFTER the vote
            carried, who would otherwise be handing out money on a plan they
            never signed. Say why the buttons are missing, or it reads as the
            screen being broken. */}
        {distributionStarted && payoutRole && !iApprovedShareOut ? (
          <View
            style={[styles.methodNote, { backgroundColor: colors.surfaceSecondary }]}
            testID="shareout-confirm-locked"
          >
            <Lock size={16} color={colors.textMuted} strokeWidth={2.2} />
            <Text style={{ flex: 1, color: colors.textMuted, fontSize: 12, lineHeight: 17 }}>
              Only the admins who approved this share-out can mark members paid, and
              your approval is not on this one.
            </Text>
          </View>
        ) : null}
        <Card padding={0}>
          {allocationRows.map((row, i) => {
            const p = row.payout;
            const busy = !!p && confirmingId === p.transactionId;
            return (
              <View
                key={row.key}
                style={[
                  styles.allocRow,
                  i < allocationRows.length - 1 && {
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                <Avatar name={row.name} size={36} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{ color: colors.textMain, fontWeight: "600", fontSize: 14 }}>
                    {row.name}
                  </Text>
                  {p ? <PayoutStatus p={p} colors={colors} /> : null}
                  {row.subtitle ? (
                    <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>
                      {row.subtitle}
                    </Text>
                  ) : null}
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ color: colors.textMain, fontWeight: "700" }}>
                    {formatZMW(row.amount)}
                  </Text>
                  {row.growthPct !== null ? (
                    <Text style={{ color: colors.success, fontSize: 11, fontWeight: "600", marginTop: 2 }}>
                      +{row.growthPct}%
                    </Text>
                  ) : null}
                  {p && p.awaitsConfirmation && canConfirmPayout ? (
                    <Pressable
                      onPress={() => handleMarkPaid(p)}
                      disabled={busy}
                      testID={`shareout-mark-paid-${row.key}`}
                      style={({ pressed }) => [
                        styles.markPaid,
                        { backgroundColor: colors.primary, opacity: pressed || busy ? 0.6 : 1 },
                      ]}
                    >
                      {busy ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <HandCoins size={13} color="#fff" strokeWidth={2.5} />
                          <Text style={styles.markPaidText}>Mark paid</Text>
                        </>
                      )}
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
        </Card>

        {/* Timeline */}
        <Text style={[styles.label, { color: colors.textMuted, marginTop: 24 }]}>
          DISTRIBUTION TIMELINE
        </Text>
        <Card padding={0}>
          {timeline.map((t, i) => (
            <View key={i} style={styles.timelineRow}>
              <View style={styles.timelineLeft}>
                <View
                  style={[
                    styles.timelineDot,
                    {
                      backgroundColor: t.done ? colors.primary : colors.surface,
                      borderColor: t.done ? colors.primary : colors.borderStrong,
                    },
                  ]}
                >
                  {t.done ? <Check size={12} color="#fff" strokeWidth={3} /> : null}
                </View>
                {i < timeline.length - 1 && (
                  <View style={[styles.timelineBar, { backgroundColor: colors.border }]} />
                )}
              </View>
              <View style={{ flex: 1, paddingBottom: 18 }}>
                <Text
                  style={{
                    color: t.done ? colors.textMain : colors.textBody,
                    fontWeight: "600",
                    fontSize: 14,
                  }}
                >
                  {t.title}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>{fmtDate(t.date)}</Text>
              </View>
            </View>
          ))}
        </Card>

        <View style={{ height: 24 }} />

        {/* How this distribution pays. Chosen once, before the vote, because it
            is half of what the admins are approving: paying members yourselves
            is a fortnight of work and a confirmation each, while mobile money
            is one tap and pawaPay does the rest. */}
        {showMethodPicker ? (
          <>
            <Text style={[styles.label, { color: colors.textMuted }]}>PAY MEMBERS BY</Text>
            <View style={styles.methodRow}>
              {([
                {
                  key: "manual" as const,
                  icon: HandCoins,
                  title: "Pay members yourselves",
                  blurb:
                    "Cash, your own mobile money, a bank transfer — however the group agreed. Mark each member paid here as you go.",
                },
                {
                  key: "mobile-money" as const,
                  icon: Smartphone,
                  title: "Pay through Chuma",
                  blurb:
                    "Every member's share goes to their mobile wallet automatically once approved.",
                },
              ]).map((opt) => {
                const selected = chosenMethod === opt.key;
                // Mobile money cannot pay anyone while the hold is on, so it is
                // offered but locked, with the reason underneath — hiding it
                // would just look like the feature does not exist.
                const locked = opt.key === "mobile-money" && mobileMoneyHold;
                const Icon = locked ? Lock : opt.icon;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => !locked && setChosenMethod(opt.key)}
                    disabled={locked}
                    testID={`shareout-method-${opt.key}`}
                    style={[
                      styles.methodCard,
                      {
                        borderColor: selected ? colors.primary : colors.border,
                        backgroundColor: selected ? colors.primary + "12" : colors.surface,
                        opacity: locked ? 0.55 : 1,
                      },
                    ]}
                  >
                    <Icon
                      size={18}
                      color={selected ? colors.primary : colors.textMuted}
                      strokeWidth={2.2}
                    />
                    <Text
                      style={{
                        color: selected ? colors.primary : colors.textMain,
                        fontWeight: "700",
                        fontSize: 14,
                        marginTop: 6,
                      }}
                    >
                      {opt.title}
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 3, lineHeight: 15 }}>
                      {opt.blurb}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {mobileMoneyHold ? (
              <Text
                style={{ color: colors.textMuted, fontSize: 11, marginBottom: 14, lineHeight: 16 }}
                testID="shareout-method-locked-note"
              >
                Automatic payouts are paused, so the group pays members directly this
                time. Nothing is deducted — members take their full share.
              </Text>
            ) : (
              <View style={{ height: 14 }} />
            )}
          </>
        ) : null}

        {/* Already proposed: the method is settled, and anyone voting needs to
            see which one they are voting for. */}
        {!showMethodPicker && !distributionStarted && shareOutApproval ? (
          <View
            style={[styles.methodNote, { backgroundColor: colors.surfaceSecondary }]}
            testID="shareout-method-note"
          >
            {payingManually ? (
              <HandCoins size={16} color={colors.textMuted} strokeWidth={2.2} />
            ) : (
              <Smartphone size={16} color={colors.textMuted} strokeWidth={2.2} />
            )}
            <Text style={{ color: colors.textBody, fontSize: 12, flex: 1, lineHeight: 17 }}>
              {payingManually
                ? "The group pays members directly. Once approved, the treasurer pays each one and marks them paid here — every member gets their receipt as it happens."
                : "Paid through Chuma. Once approved, every member's share goes to their mobile wallet automatically."}
            </Text>
          </View>
        ) : null}

        {approved ? (
          <Card
            padding={16}
            style={{ backgroundColor: colors.success + "15", flexDirection: "row", alignItems: "center", gap: 12 }}
            testID="shareout-approved"
          >
            <Check size={22} color={colors.success} strokeWidth={2.5} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.success, fontWeight: "700", fontSize: 15 }}>
                Distribution plan approved
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                {`${votesFor} of ${required} approvals · ${
                  payingManually ? "paid by the group" : "paid through Chuma"
                }`}
              </Text>
            </View>
          </Card>
        ) : !isAdmin ? (
          // A member never votes on this, so tell them that first. Sending them
          // through the awaiting-chairperson copy below would read as "your turn
          // is coming", which it never is.
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: colors.surfaceSecondary,
              padding: 16,
              borderRadius: 16,
              gap: 12,
            }}
            testID="shareout-locked"
          >
            <Lock size={18} color={colors.textMuted} />
            <Text style={{ flex: 1, color: colors.textMuted, fontSize: 13, lineHeight: 18 }}>
              Only the group&apos;s admins approve the distribution plan. Your current role
              is{" "}
              <Text style={{ fontWeight: "700", color: colors.textMain }}>
                {myRole ?? "Member"}
              </Text>
              .
            </Text>
          </View>
        ) : !shareOutApproval && !isChairperson ? (
          // The cycle has not started, and only the chairperson can start it.
          // The treasurer and secretary are waiting on them.
          <View
            style={[styles.methodNote, { backgroundColor: colors.surfaceSecondary, marginBottom: 0 }]}
            testID="shareout-awaiting-chair"
          >
            <Lock size={18} color={colors.textMuted} />
            <Text style={{ flex: 1, color: colors.textMuted, fontSize: 13, lineHeight: 18 }}>
              The chairperson starts the share-out. Once they do, every admin has to
              approve it before any money moves.
            </Text>
          </View>
        ) : (
          <>
            <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 6 }}>
              {shareOutApproval
                ? `${votesFor} of ${required} approvals · every admin must approve`
                : `Needs all ${required} admin${required === 1 ? "" : "s"} to approve`}
            </Text>
            <ProgressBar progress={required > 0 ? votesFor / required : 0} />
            <View style={{ height: 12 }} />
            {approvalError ? (
              <Text style={{ color: colors.danger, fontSize: 12, marginBottom: 8 }} testID="shareout-approve-error">
                {approvalError}
              </Text>
            ) : null}
            <Button
              label={
                voting
                  ? "Recording…"
                  : hasVoted
                    ? "Approval recorded"
                    : shareOutApproval
                      ? "Approve distribution plan"
                      : "Start share-out"
              }
              disabled={voting || hasVoted}
              onPress={handleApprove}
              testID="shareout-approve-btn"
            />
          </>
        )}
        <View style={{ height: 10 }} />
        <Button
          label="View detailed report"
          variant="outline"
          onPress={() => router.push(`/reports?groupId=${activeGroupId}` as never)}
          testID="shareout-report-btn"
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const NetRow = ({
  label,
  value,
  colors,
  last,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useTheme>["colors"];
  last?: boolean;
}) => (
  <View
    style={[
      { paddingVertical: 10, flexDirection: "row", justifyContent: "space-between" },
      !last && { borderBottomWidth: 1, borderBottomColor: colors.border },
    ]}
  >
    <Text style={{ color: colors.textMuted, fontSize: 13 }}>{label}</Text>
    <Text style={{ color: colors.textMain, fontSize: 14, fontWeight: "600" }}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 32 },
  netDivider: { height: 1, marginVertical: 12 },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2, marginVertical: 12 },
  heroStats: { flexDirection: "row", marginTop: 18 },
  heroStatLabel: { color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "500", letterSpacing: 0.3 },
  heroStatVal: { color: "#fff", fontSize: 15, fontWeight: "700", marginTop: 2 },
  heroDivider: { width: 1, height: 30, backgroundColor: "rgba(255,255,255,0.18)", marginHorizontal: 14 },
  allocRow: { flexDirection: "row", alignItems: "center", padding: 14 },
  markPaid: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    minHeight: 30,
  },
  markPaidText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  completeCheck: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  methodRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  methodCard: { flex: 1, borderWidth: 1.5, borderRadius: 14, padding: 14 },
  methodNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 14,
    marginBottom: 14,
  },
  timelineRow: { flexDirection: "row", paddingHorizontal: 16, paddingTop: 16 },
  timelineLeft: { alignItems: "center", marginRight: 12 },
  timelineDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  timelineBar: { width: 2, flex: 1, marginTop: 2 },
});
