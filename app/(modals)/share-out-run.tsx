/**
 * One past share-out, member by member.
 *
 * The history list used to unfold a run in place, which works for a group of
 * six and falls apart at thirty: the rows push every other run off the screen,
 * there is nowhere to search, and scrolling back to the list means scrolling
 * past everyone. A run gets its own screen instead — its own scroll, its own
 * search box, and a back button that returns to the list where it was.
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { ScreenHeader, ErrorState } from "@/src/components/common";
import { Card } from "@/src/components/ui/Card";
import { Avatar } from "@/src/components/ui/Avatar";
import { ProgressBar } from "@/src/components/ui/ProgressBar";
import { useTheme } from "@/src/theme/ThemeContext";
import {
  getShareOutRun,
  ShareOutPayout,
  ShareOutRunDetail,
} from "@/src/services/shareOut";
import { formatZMW } from "@/src/utils/currency";
import {
  Check,
  Clock,
  AlertTriangle,
  HandCoins,
  Smartphone,
  Search,
} from "lucide-react-native";
import { useAsyncEffect } from "@/src/hooks/useAsyncEffect";

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** What happened to one member's money, in the past tense. */
function PayoutOutcome({
  p,
  colors,
}: {
  p: ShareOutPayout;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const line = (Icon: any, color: string, text: string) => (
    <View style={{ flexDirection: "row", alignItems: "center", marginTop: 3 }}>
      <Icon size={11} color={color} strokeWidth={2.5} />
      <Text style={{ color, fontSize: 11, fontWeight: "600", marginLeft: 4 }} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );

  if (p.status === "failed") return line(AlertTriangle, colors.danger, "Payout failed");
  if (p.status === "pending") return line(Clock, colors.warning, "Not paid yet");
  // Their whole share went to their own loan, so there was never anything to
  // hand over — say that rather than claiming we paid them nothing.
  if (p.amount <= 0 && p.appliedToLoan > 0)
    return line(Check, colors.textMuted, "Cleared against their loan");
  return line(
    Check,
    colors.success,
    [p.paymentMethod || (p.viaMobileMoney ? "Mobile wallet" : "Paid"), p.confirmedByName]
      .filter(Boolean)
      .join(" · ")
  );
}

const SummaryCell = ({
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
  <View style={[{ flex: 1 }, !last && { borderRightWidth: 1, borderRightColor: colors.border }]}>
    <Text style={{ color: colors.textMuted, fontSize: 10, fontWeight: "600", letterSpacing: 0.3 }}>
      {label.toUpperCase()}
    </Text>
    <Text style={{ color: colors.textMain, fontSize: 14, fontWeight: "700", marginTop: 2 }}>
      {value}
    </Text>
  </View>
);

export default function ShareOutRunScreen() {
  const { colors } = useTheme();
  const { groupId, shareOutId } = useLocalSearchParams<{
    groupId?: string;
    shareOutId?: string;
  }>();

  const [run, setRun] = useState<ShareOutRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    if (!groupId || !shareOutId) {
      setFailed(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailed(false);
    try {
      setRun(await getShareOutRun(groupId, shareOutId));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [groupId, shareOutId]);

  useAsyncEffect(load);

  // Searching a long list by name is the whole reason a member opens an old
  // run: they are looking for one person, usually themselves.
  const shown = useMemo(() => {
    const rows = run?.payouts ?? [];
    const q = query.trim().toLowerCase();
    return q ? rows.filter((p) => (p.memberName || "").toLowerCase().includes(q)) : rows;
  }, [run, query]);

  const MethodIcon = run?.method === "manual" ? HandCoins : Smartphone;
  const dateLabel = run ? fmtDate(run.completedAt) || fmtDate(run.startedAt) : "";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScreenHeader
        title="Share-out"
        subtitle={run ? `${run.memberCount} member${run.memberCount === 1 ? "" : "s"}${dateLabel ? ` · ${dateLabel}` : ""}` : undefined}
        testID="shareout-run-header"
      />

      {loading ? (
        <View style={{ paddingVertical: 48, alignItems: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : failed || !run ? (
        <ErrorState message="Couldn't load this share-out. Please try again." onRetry={load} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(p) => p.transactionId}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          testID="shareout-run-members"
          ListHeaderComponent={
            <View>
              <Card padding={20}>
                <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "600", letterSpacing: 0.3 }}>
                  DISTRIBUTED
                </Text>
                <Text
                  style={{
                    color: colors.textMain,
                    fontSize: 30,
                    fontWeight: "700",
                    letterSpacing: -0.6,
                    marginTop: 4,
                  }}
                  testID="shareout-run-total"
                >
                  {formatZMW(run.totalPaid)}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
                  <MethodIcon size={12} color={colors.textMuted} strokeWidth={2.2} />
                  <Text style={{ color: colors.textMuted, fontSize: 12, marginLeft: 5 }}>
                    {`${run.method === "manual" ? "Paid by the group" : "Mobile money"} · ${
                      run.closed
                        ? `Closed${dateLabel ? ` ${dateLabel}` : ""}`
                        : `${run.totals.paid} of ${run.totals.count} paid — in progress`
                    }`}
                  </Text>
                </View>

                {!run.closed ? (
                  <View style={{ marginTop: 12 }}>
                    <ProgressBar
                      progress={run.totals.count > 0 ? run.totals.paid / run.totals.count : 0}
                    />
                  </View>
                ) : null}

                <View style={[styles.summary, { backgroundColor: colors.surfaceSecondary }]}>
                  <SummaryCell
                    label="Owed"
                    value={formatZMW(run.totalOwed, { compact: true })}
                    colors={colors}
                  />
                  {/* Loans netted out of shares never left the group, so the two
                      totals only reconcile once this is shown. */}
                  <SummaryCell
                    label="To loans"
                    value={formatZMW(run.totalAppliedToLoans, { compact: true })}
                    colors={colors}
                  />
                  <SummaryCell
                    label="Members"
                    value={String(run.memberCount)}
                    colors={colors}
                    last
                  />
                </View>
              </Card>

              {/* Only worth the space once scanning by eye stops working. */}
              {run.payouts.length > 8 ? (
                <View
                  style={[
                    styles.search,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                >
                  <Search size={16} color={colors.textMuted} strokeWidth={2.2} />
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search members"
                    placeholderTextColor={colors.textMuted}
                    autoCorrect={false}
                    style={{ flex: 1, marginLeft: 8, color: colors.textMain, fontSize: 14, paddingVertical: 0 }}
                    testID="shareout-run-search"
                  />
                </View>
              ) : null}

              <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: "600", letterSpacing: 0.3, marginTop: 18, marginBottom: 4 }}>
                {`WHO GOT WHAT${query ? ` · ${shown.length} of ${run.payouts.length}` : ""}`}
              </Text>
            </View>
          }
          ListEmptyComponent={
            <Text
              style={{ color: colors.textMuted, fontSize: 13, marginTop: 16 }}
              testID="shareout-run-no-match"
            >
              {`No member in this share-out matches "${query.trim()}".`}
            </Text>
          }
          renderItem={({ item: p }) => (
            <View style={[styles.memberRow, { borderBottomColor: colors.border }]}>
              <Avatar name={p.memberName} size={34} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={{ color: colors.textMain, fontWeight: "600", fontSize: 14 }}>
                  {p.memberName}
                </Text>
                <PayoutOutcome p={p} colors={colors} />
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ color: colors.textMain, fontWeight: "700", fontSize: 14 }}>
                  {formatZMW(p.amount)}
                </Text>
                {p.appliedToLoan > 0 ? (
                  <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 2 }}>
                    {`${formatZMW(p.appliedToLoan, { compact: true })} to loan`}
                  </Text>
                ) : null}
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  summary: {
    flexDirection: "row",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
    marginTop: 16,
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    marginTop: 16,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
});
