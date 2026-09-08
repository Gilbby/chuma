import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { ScreenHeader } from "@/src/components/common/ScreenHeader";
import { ErrorState } from "@/src/components/common/ErrorState";
import { NoGroupState } from "@/src/components/common/NoGroupState";
import { Card } from "@/src/components/ui/Card";
import { StatusBadge } from "@/src/components/ui/StatusBadge";
import { useTheme } from "@/src/theme/ThemeContext";
import { getGroups } from "@/src/services/groups";
import { getCurrentUser } from "@/src/utils/currentUser";
import { formatZMW } from "@/src/utils/currency";
import { Group, Member, Role } from "@/src/types";
import { Crown, Shield, FileText, Vote } from "lucide-react-native";
import { useAsyncEffect } from "@/src/hooks/useAsyncEffect";

// `Plus`, `Edit3`, `Lock` and `X` go back in when proposals and rule editing
// return; see the hidden block at the foot of this file.

interface Row {
  label: string;
  value: string;
}

const ADMIN_ROLES: Role[] = ["Chairperson", "Treasurer", "Secretary"];

const ROLE_ICON: Record<string, { icon: typeof Crown; color: "primary" | "warning" | "info" }> = {
  Chairperson: { icon: Crown, color: "primary" },
  Treasurer: { icon: Shield, color: "warning" },
  Secretary: { icon: FileText, color: "info" },
};

const THRESHOLD_LABEL: Record<string, string> = {
  "2-of-3": "Any 2 of the 3 admins",
  majority: "Majority of admins",
  all: "All three admins",
};

const fmtDate = (iso?: string) => {
  if (!iso) return "Not set";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "Not set"
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

/** "K50 flat" / "2% per day" / "None", from a constitution penalty rule. */
const penaltyLabel = (rule?: {
  enabled: boolean;
  penaltyType: "flat" | "percent";
  penaltyRate?: number;
  penaltyAmount?: number;
}) => {
  if (!rule?.enabled) return "None";
  return rule.penaltyType === "flat"
    ? `${formatZMW(rule.penaltyAmount ?? 0)} flat`
    : `${rule.penaltyRate ?? 0}% per day`;
};

export default function Governance() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ groupId?: string }>();

  const [groups, setGroups] = useState<Group[]>([]);
  const [group, setGroup] = useState<Group | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const [fetched, me] = await Promise.all([
        getGroups(),
        getCurrentUser<{ id?: string; _id?: string }>(),
      ]);
      setGroups(fetched);
      setGroup(
        (params.groupId ? fetched.find((g) => g.id === params.groupId) : undefined) ??
          fetched[0] ??
          null
      );
      setMyUserId(me?.id ?? me?._id ?? null);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [params.groupId]);

  useAsyncEffect(load);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]} testID="governance-screen">
        <ScreenHeader title="Governance" subtitle="Group rules" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]} testID="governance-screen">
        <ScreenHeader title="Governance" subtitle="Group rules" />
        <ErrorState onRetry={load} />
      </SafeAreaView>
    );
  }

  if (!group) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]} testID="governance-screen">
        <ScreenHeader title="Governance" subtitle="Group rules" />
        <NoGroupState
          message="Rules belong to a group. Once you join one or start your own, its constitution shows up here."
          testID="governance-no-group"
        />
      </SafeAreaView>
    );
  }

  const c = group.constitution;
  const lends = c?.internalLendingEnabled !== false;

  // Only members who have actually joined hold office — a pending invite carries
  // the role but not the seat until it is accepted.
  const admins = (group.members ?? []).filter(
    (m: Member) => m.status !== "pending" && ADMIN_ROLES.includes(m.role)
  );

  const savingRules: Row[] = [
    {
      label: "Contribution",
      value: `${formatZMW(group.contributionAmount)} ${(group.contributionFrequency || "").toLowerCase()}`.trim(),
    },
    { label: "Late contribution", value: penaltyLabel(c?.penaltyRules?.lateContribution) },
    { label: "Grace period", value: c ? `${c.gracePeriodDays} days` : "Not set" },
    { label: "Share-out", value: fmtDate(group.shareOutDate) },
  ];

  const loanRules: Row[] = lends
    ? [
        { label: "Interest", value: `${c?.loanInterestRate ?? group.loanInterestRate}% per month` },
        {
          label: "Maximum loan",
          value: `${c?.loanMultiplier ?? group.loanMaxMultiplier}x your savings`,
        },
        {
          label: "Loan cut-off",
          value:
            (c?.loanFreeWindowMonths ?? 0) === 0
              ? "None"
              : `${c?.loanFreeWindowMonths} month(s) before share-out`,
        },
        { label: "Late repayment", value: penaltyLabel(c?.penaltyRules?.lateRepayment) },
      ]
    : [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]} testID="governance-screen">
      <ScreenHeader
        title="Governance"
        subtitle={groups.length > 1 ? group.name : "Group rules"}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Admin roles */}
        <Text style={[styles.label, { color: colors.textMuted }]}>ADMIN ROLES</Text>
        <Card padding={0}>
          {admins.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text style={{ color: colors.textMuted, fontSize: 13 }}>
                No admins assigned yet.
              </Text>
            </View>
          ) : (
            admins.map((m, i) => {
              const meta = ROLE_ICON[m.role] ?? { icon: Shield, color: "info" as const };
              const Icon = meta.icon;
              const isMe = !!myUserId && String(m.userId) === String(myUserId);
              return (
                <View
                  key={m.id ?? `${m.role}-${i}`}
                  style={[
                    styles.row,
                    i < admins.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                  ]}
                >
                  <View style={[styles.roleIcon, { backgroundColor: colors.primarySoft }]}>
                    <Icon size={16} color={colors.primary} />
                  </View>
                  <Text style={{ color: colors.textMain, flex: 1, fontWeight: "600", fontSize: 14 }}>
                    {m.name}
                    {isMe ? " (you)" : ""}
                  </Text>
                  <StatusBadge label={m.role} variant={meta.color} />
                </View>
              );
            })
          )}
        </Card>

        {/* Saving rules */}
        <Text style={[styles.label, { color: colors.textMuted, marginTop: 22 }]}>
          SAVING RULES
        </Text>
        <Card padding={0}>
          {savingRules.map((r, i) => (
            <RuleRow key={r.label} row={r} last={i === savingRules.length - 1} colors={colors} />
          ))}
        </Card>

        {/* Loan rules — absent entirely for savings-only groups */}
        {lends ? (
          <>
            <Text style={[styles.label, { color: colors.textMuted, marginTop: 22 }]}>
              LOAN RULES
            </Text>
            <Card padding={0}>
              {loanRules.map((r, i) => (
                <RuleRow key={r.label} row={r} last={i === loanRules.length - 1} colors={colors} />
              ))}
            </Card>
          </>
        ) : (
          <>
            <Text style={[styles.label, { color: colors.textMuted, marginTop: 22 }]}>
              LOANS
            </Text>
            <Card padding={16}>
              <Text style={{ color: colors.textMuted, fontSize: 13, lineHeight: 20 }}>
                This group saves together without lending. Everything members put in is paid back
                out at share-out.
              </Text>
            </Card>
          </>
        )}

        {/* Approvals */}
        <View style={styles.sectionHead}>
          <Vote size={16} color={colors.primary} />
          <Text style={[styles.label, { color: colors.textMuted, marginBottom: 0 }]}>
            APPROVALS
          </Text>
        </View>
        <Card padding={0}>
          <RuleRow
            row={{
              label: "Needed to approve",
              value: THRESHOLD_LABEL[c?.approvalThreshold ?? ""] ?? "Any 2 of the 3 admins",
            }}
            last
            colors={colors}
          />
        </Card>

        <Text style={[styles.footnote, { color: colors.textMuted }]}>
          These rules were agreed when the group was created. Changing them needs a vote, which is
          not available yet.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const RuleRow = ({
  row,
  last,
  colors,
}: {
  row: Row;
  last?: boolean;
  colors: ReturnType<typeof useTheme>["colors"];
}) => (
  <View
    style={[styles.row, !last && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
  >
    <Text style={{ color: colors.textMuted, flex: 1, fontSize: 14 }}>{row.label}</Text>
    <Text style={{ color: colors.textMain, fontWeight: "600", fontSize: 14 }}>{row.value}</Text>
  </View>
);

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2, marginBottom: 8 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 22, marginBottom: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  emptyRow: { paddingHorizontal: 16, paddingVertical: 18 },
  roleIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  footnote: { fontSize: 12, lineHeight: 18, marginTop: 22, textAlign: "center" },
});

/* PROPOSALS — hidden until there is a backend for them. The previous version
   listed hardcoded proposals, had no vote button despite promising a vote, and
   lost anything you created on unmount. Rule and threshold editing went with
   it: the API has no group-update endpoint, so an edit could only ever have
   been a toast. Restoring this needs, on the server, a proposal create/vote
   endpoint (the Approval model already carries a "rule-change" type and an
   atomic vote path) that writes the passed change into group.constitution;
   and on the client, the proposals list, a vote control, and a "Propose
   change" entry point in the rules section head. */
