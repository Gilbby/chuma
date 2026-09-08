import React, { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/src/components/common/ScreenHeader";
import { Card } from "@/src/components/ui/Card";
import { Button } from "@/src/components/ui/Button";
import { StatusBadge } from "@/src/components/ui/StatusBadge";
import { ProgressBar } from "@/src/components/ui/ProgressBar";
import { SkeletonGroup } from "@/src/components/ui";
import { ErrorState } from "@/src/components/common";
import { useTheme } from "@/src/theme/ThemeContext";
import { getApprovals, voteOnApproval, runApproval } from "@/src/services/approvals";
import { getCurrentUser } from "@/src/utils/currentUser";
import { Approval } from "@/src/types";
import { formatZMW } from "@/src/utils/currency";
import { formatDate } from "@/src/utils/date";
import { useRole } from "@/src/contexts/RoleContext";
import { Banknote, Wallet, Scale, ShieldCheck, Check, X, Info, Sparkles, UserMinus, Trash2, HandCoins } from "lucide-react-native";
import { useAsyncEffect } from "@/src/hooks/useAsyncEffect";

const TYPE_ICONS: Record<Approval["type"], typeof Banknote> = {
  loan: Banknote,
  withdrawal: Wallet,
  "rule-change": Scale,
  "admin-action": ShieldCheck,
  "member-removal": UserMinus,
  "group-deletion": Trash2,
  "share-out": Sparkles,
  "cash-receipt": HandCoins,
};

// How each status reads once the vote is over: "approved" means decided but
// not yet carried out, "executed" means the action actually ran.
const STATUS_LABEL: Record<Approval["status"], string> = {
  pending: "pending",
  approved: "approved",
  rejected: "rejected",
  executed: "completed",
};

const STATUS_VARIANT: Record<
  Approval["status"],
  "success" | "danger" | "warning" | "info"
> = {
  pending: "warning",
  approved: "info",
  rejected: "danger",
  executed: "success",
};

export default function Approvals() {
  const { colors } = useTheme();
  const { role, can } = useRole();
  const canVote = can("vote");
  const [items, setItems] = useState<Approval[]>([]);
  const [filter, setFilter] = useState<"pending" | "history">("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [voting, setVoting] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  // Needed to spot an approval about the viewer themselves — nobody votes on
  // their own removal, so the buttons must not be there to tap.
  const [myUserId, setMyUserId] = useState<string | null>(null);

  useEffect(() => {
    getCurrentUser<{ _id: string }>().then((u) =>
      setMyUserId(u?._id ? String(u._id) : null)
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      // Both tabs come off one fetch, so the pending count stays right while
      // the reader is looking at history.
      const res = await getApprovals({ status: "all" });
      setItems(res);
    } catch (e) {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useAsyncEffect(load);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const pendingCount = items.filter((i) => i.status === "pending").length;
  // History is everything a vote has already settled — approved, rejected, or
  // carried out.
  const data = items.filter((i) =>
    filter === "pending" ? i.status === "pending" : i.status !== "pending"
  );

  // An approved action whose execution was blocked at the time — a refund the
  // wallet couldn't cover yet. The votes stand; this just runs it again.
  const onRun = async (id: string) => {
    setRunning(id);
    try {
      await runApproval(id);
      await load();
    } catch (e: any) {
      Alert.alert("Could not complete", e?.message || "Please try again.");
    } finally {
      setRunning(null);
    }
  };

  const onVote = async (id: string, action: "approve" | "reject") => {
    setVoting(id);
    try {
      await voteOnApproval(id, action);
      await load();
    } catch (e: any) {
      Alert.alert("Vote failed", e?.message || "Please try again.");
    } finally {
      setVoting(null);
    }
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
      testID="approvals-screen"
    >
      <ScreenHeader
        title="Approval center"
        subtitle={`${pendingCount} pending`}
      />
      <View style={styles.filters}>
        {(["pending", "history"] as const).map((f) => {
          const active = filter === f;
          return (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              testID={`approvals-filter-${f}`}
              style={[
                styles.filterChip,
                {
                  backgroundColor: active ? colors.primary : colors.surface,
                  borderColor: active ? colors.primary : colors.border,
                },
              ]}
            >
              <Text style={{ color: active ? "#fff" : colors.textMain, fontWeight: "600" }}>
                {f === "pending"
                  ? `Pending${pendingCount ? ` (${pendingCount})` : ""}`
                  : "History"}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {loading ? (
          <SkeletonGroup count={3} height={160} />
        ) : error ? (
          <ErrorState onRetry={load} />
        ) : data.length === 0 ? (
          <Card padding={28} style={{ alignItems: "center" }}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
              <Check size={28} color={colors.primary} />
            </View>
            <Text style={{ color: colors.textMain, fontWeight: "700", fontSize: 16, marginTop: 12 }}>
              {filter === "pending" ? "All caught up" : "No decisions yet"}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 6, textAlign: "center" }}>
              {filter === "pending"
                ? "No approvals waiting. We'll notify you when new requests come in."
                : "Every request your group settles is kept here: who decided it, and when."}
            </Text>
          </Card>
        ) : (
          data.map((a) => {
          // Fallback guards against any future/unknown approval type crashing the list.
          const Icon = TYPE_ICONS[a.type] ?? ShieldCheck;
          const isOwnRemoval =
            a.type === "member-removal" &&
            !!myUserId &&
            String(a.targetUserId) === myUserId;
          // A receipt is not a group decision — one admin says whether the cash
          // reached them — so it drops the vote tally and asks the question in
          // the words of the thing: did you get the money?
          const isReceipt = a.type === "cash-receipt";
          const progress = a.totalVoters === 0 ? 0 : a.votesFor / a.totalVoters;
          const isPending = a.status === "pending";
          const statusVariant = STATUS_VARIANT[a.status] ?? "warning";
          return (
            <Card key={a.id} padding={18} style={{ marginBottom: 12 }}>
              <View style={styles.cardHead}>
                <View style={[styles.typeIcon, { backgroundColor: colors.primarySoft }]}>
                  <Icon size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{ color: colors.textMain, fontWeight: "700", fontSize: 15 }}>
                    {a.title}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                    {a.requestedBy} · {formatDate(a.timestamp) || a.timestamp}
                  </Text>
                </View>
                <StatusBadge label={STATUS_LABEL[a.status] ?? a.status} variant={statusVariant} />
              </View>

              <Text style={{ color: colors.textBody, fontSize: 13, marginTop: 10, lineHeight: 20 }}>
                {a.description}
              </Text>

              {a.amount ? (
                <View style={[styles.amountBox, { backgroundColor: colors.surfaceSecondary }]}>
                  <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: "600" }}>
                    {isReceipt ? "CASH HANDED OVER" : "REQUESTED AMOUNT"}
                  </Text>
                  <Text style={{ color: colors.textMain, fontWeight: "700", fontSize: 20, marginTop: 2 }}>
                    {formatZMW(a.amount)}
                  </Text>
                </View>
              ) : null}

              {isReceipt ? (
                <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 14, lineHeight: 16 }}>
                  One admin confirms this: whoever is holding the cash. Nothing
                  is credited to them until you do.
                </Text>
              ) : (
                <View style={{ marginTop: 14 }}>
                  <View style={styles.rowBetween}>
                    <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: "600" }}>
                      {a.votesFor} APPROVED · {a.votesAgainst} REJECTED
                    </Text>
                    <Text style={{ color: colors.textMain, fontSize: 12, fontWeight: "700" }}>
                      {a.votesFor} of {a.totalVoters} approvals
                    </Text>
                  </View>
                  <View style={{ marginTop: 6 }}>
                    <ProgressBar progress={progress} />
                  </View>
                </View>
              )}

              {!isPending && a.votes && a.votes.length > 0 ? (
                <View style={[styles.trail, { borderTopColor: colors.border }]}>
                  <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: "600" }}>
                    DECISION TRAIL
                  </Text>
                  {a.votes.map((v, i) => (
                    <View key={`${a.id}-vote-${i}`} style={styles.trailRow}>
                      {v.decision === "approve" ? (
                        <Check size={13} color={colors.success} />
                      ) : (
                        <X size={13} color={colors.danger} />
                      )}
                      <Text
                        style={{ flex: 1, color: colors.textBody, fontSize: 12 }}
                        numberOfLines={1}
                      >
                        {v.adminName}{" "}
                        {v.decision === "approve"
                          ? isReceipt
                            ? "confirmed the cash"
                            : "approved"
                          : isReceipt
                            ? "said it never arrived"
                            : "rejected"}
                      </Text>
                      <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                        {formatDate(v.at)}
                      </Text>
                    </View>
                  ))}
                  {a.resolvedAt ? (
                    <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 8 }}>
                      {a.status === "executed"
                        ? "Carried out"
                        : a.status === "rejected"
                          ? "Rejected"
                          : "Approved"}{" "}
                      {formatDate(a.resolvedAt)}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {a.type === "withdrawal" ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    marginTop: 10,
                    backgroundColor: colors.surfaceSecondary,
                    padding: 10,
                    borderRadius: 10,
                    gap: 8,
                  }}
                >
                  <Info size={14} color={colors.warning} />
                  <Text style={{ flex: 1, color: colors.textMuted, fontSize: 11, lineHeight: 16 }}>
                    Withdrawals require Treasurer co-signature in addition to member votes.
                    {role === "Treasurer" ? " You can co-sign this." : ""}
                  </Text>
                </View>
              ) : null}

              {isPending && isOwnRemoval ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    marginTop: 10,
                    backgroundColor: colors.surfaceSecondary,
                    padding: 10,
                    borderRadius: 10,
                    gap: 8,
                  }}
                >
                  <Info size={14} color={colors.warning} />
                  <Text style={{ flex: 1, color: colors.textMuted, fontSize: 11, lineHeight: 16 }}>
                    This is about you. The group&apos;s other admins decide it. You
                    have no vote on your own removal.
                  </Text>
                </View>
              ) : null}

              {a.status === "approved" ? (
                <View style={{ marginTop: 12 }}>
                  <Text style={{ color: colors.textMuted, fontSize: 11, lineHeight: 16, marginBottom: 8 }}>
                    Approved, but not carried out yet. Usually the group wallet
                    could not cover it at the time.
                  </Text>
                  <Button
                    label="Run again"
                    variant="outline"
                    size="md"
                    onPress={() => onRun(a.id)}
                    disabled={!canVote || running === a.id}
                    loading={running === a.id}
                    testID={`approval-run-${a.id}`}
                  />
                </View>
              ) : null}

              {isPending && !isOwnRemoval ? (
                <View style={styles.actions}>
                  <Button
                    label={isReceipt ? "Not received" : "Reject"}
                    variant="outline"
                    onPress={() => onVote(a.id, "reject")}
                    size="md"
                    fullWidth={false}
                    disabled={!canVote || voting === a.id}
                    loading={voting === a.id}
                    style={{ flex: 1, marginRight: 8 }}
                    icon={<X size={16} color={colors.primary} />}
                    testID={`approval-reject-${a.id}`}
                  />
                  <Button
                    label={isReceipt ? "Confirm received" : "Approve"}
                    onPress={() => onVote(a.id, "approve")}
                    size="md"
                    fullWidth={false}
                    disabled={!canVote || voting === a.id}
                    loading={voting === a.id}
                    style={{ flex: 1, marginLeft: 8 }}
                    icon={<Check size={16} color="#fff" />}
                    testID={`approval-approve-${a.id}`}
                  />
                </View>
              ) : null}
            </Card>
          );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: "row", paddingHorizontal: 20, gap: 8, paddingBottom: 12 },
  filterChip: {
    paddingHorizontal: 18,
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  content: { paddingHorizontal: 20, paddingBottom: 32 },
  cardHead: { flexDirection: "row", alignItems: "center" },
  typeIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  amountBox: { padding: 14, borderRadius: 14, marginTop: 12 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  actions: { flexDirection: "row", marginTop: 16 },
  trail: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, gap: 8 },
  trailRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
});
