import React, { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Dimensions, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { Card } from "@/src/components/ui/Card";
import { SkeletonGroup } from "@/src/components/ui";
import { ScreenHeader, ErrorState, ExportSheet, ShareOutHistory } from "@/src/components/common";
import { LineChart, BarChart } from "@/src/components/charts/Charts";
import { useTheme } from "@/src/theme/ThemeContext";
import { getGroups } from "@/src/services/groups";
import { getLoans } from "@/src/services/loans";
import { getTransactions } from "@/src/services/transactions";
import { getSavingsTrend, getGroupReport, GroupReport } from "@/src/services/reports";
import { getRepaymentRate, getSavingsGrowth } from "@/src/services/groupStats";
import { formatZMW } from "@/src/utils/currency";
import { Group, Loan, TxnItem, isProjectFundType } from "@/src/types";
import { exportTransactionsPdf, exportTransactionsCsv } from "@/src/utils/exports";
import { TrendingUp, TrendingDown, Users, Banknote, Download } from "lucide-react-native";
import { useAsyncEffect } from "@/src/hooks/useAsyncEffect";

const { width } = Dimensions.get("window");

export default function Reports() {
  const { colors } = useTheme();
  const chartW = width - 40 - 32;
  const [exportOpen, setExportOpen] = useState(false);
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();

  const [groups, setGroups] = useState<Group[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [transactions, setTransactions] = useState<TxnItem[]>([]);
  const [fetchedTrend, setFetchedTrend] = useState<{ label: string; value: number }[]>([]);
  const [fetchedReport, setFetchedReport] = useState<GroupReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [g, l, t] = await Promise.all([getGroups(), getLoans(), getTransactions()]);
      setGroups(g);
      setLoans(l);
      setTransactions(t);
    } catch (e) {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useAsyncEffect(load);

  const data = transactions;

  const primaryGroup = groupId
    ? groups.find((g) => g.id === groupId) ?? groups[0]
    : groups[0];

  useEffect(() => {
    const gid = primaryGroup?.id;
    if (!gid) return;
    let cancelled = false;
    getSavingsTrend(gid)
      .then((d) => {
        if (!cancelled) setFetchedTrend(d);
      })
      .catch(() => {
        if (!cancelled) setFetchedTrend([]);
      });
    getGroupReport(gid)
      .then((d) => {
        if (!cancelled) setFetchedReport(d);
      })
      .catch(() => {
        if (!cancelled) setFetchedReport(null);
      });
    return () => {
      cancelled = true;
    };
  }, [primaryGroup?.id]);

  // With no group there is nothing to report on. Masking here rather than
  // clearing in the effect keeps the effect off the synchronous setState path,
  // and stops a previous group’s numbers showing while the next ones load.
  const trendData = primaryGroup?.id ? fetchedTrend : [];
  const report = primaryGroup?.id ? fetchedReport : null;

  const groupRepayment = primaryGroup ? getRepaymentRate(primaryGroup, loans) : 0;

  // A project-fund group (church) has no loans and no share-out, so the loan
  // charts and the share-out record are replaced by what it does have: projects.
  const projectFund = isProjectFundType(primaryGroup?.groupType);
  const projectRows = primaryGroup?.projects ?? [];

  const savingsGrowthPct = getSavingsGrowth(primaryGroup);

  const avgRetention = groups.length
    ? Math.round(
        groups.reduce((s, g) => s + (g.memberRetention ?? 0), 0) / groups.length
      )
    : 0;

  // Disbursements binned into the trailing 4 calendar quarters (oldest → current)
  const loanAnalytics = (() => {
    const now = new Date();
    const curQ = Math.floor(now.getMonth() / 3); // 0-3
    const curY = now.getFullYear();
    return Array.from({ length: 4 }, (_, idx) => {
      const i = 3 - idx; // quarters back from current: 3,2,1,0
      let q = curQ - i;
      let y = curY;
      while (q < 0) {
        q += 4;
        y -= 1;
      }
      const start = new Date(y, q * 3, 1);
      const end = new Date(y, q * 3 + 3, 1); // exclusive upper bound
      const total = loans.reduce((sum, loan) => {
        return (
          sum +
          loan.history.reduce((s, h) => {
            if (h.type !== "disbursement") return s;
            const d = new Date(h.date);
            return d >= start && d < end ? s + h.amount : s;
          }, 0)
        );
      }, 0);
      return { label: `Q${q + 1}`, value: Math.round(total / 1000) };
    });
  })();

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]} testID="reports-screen">
        <ScreenHeader title="Reports" subtitle="Group performance analytics" />
        <View style={{ paddingHorizontal: 20, marginTop: 12 }}>
          <SkeletonGroup count={4} height={120} />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]} testID="reports-screen">
        <ScreenHeader title="Reports" subtitle="Group performance analytics" />
        <ErrorState onRetry={load} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
      testID="reports-screen"
    >
      <ScreenHeader
        title="Reports"
        subtitle="Group performance analytics"
        rightAction={
          <Pressable
            onPress={() => setExportOpen(true)}
            style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }}
            testID="reports-export-btn"
          >
            <Download size={18} color={colors.primary} />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.sectionLabel, { color: colors.textMuted, marginTop: 4 }]}>
          ANALYTICS
        </Text>

        {/* KPI cards */}
        <View style={[styles.kpiRow, { marginTop: 8 }]}>
          <KpiCard
            icon={<TrendingUp size={18} color={colors.success} />}
            label="Savings growth"
            value={`${savingsGrowthPct >= 0 ? "+" : ""}${savingsGrowthPct}%`}
            sub="vs last month"
            colors={colors}
          />
          <View style={{ width: 12 }} />
          {/* A project-fund group never lends, so "loans issued" and "default
              rate" would only ever report zero. Retention takes the slot. */}
          {projectFund ? (
            <KpiCard
              icon={<Users size={18} color={colors.info} />}
              label="Member retention"
              value={`${avgRetention}%`}
              sub="last 12 months"
              colors={colors}
            />
          ) : (
            <KpiCard
              icon={<Banknote size={18} color={colors.primary} />}
              label="Loans issued"
              value={formatZMW(report?.loansIssuedThisQuarter ?? 0, { compact: true })}
              sub="this quarter"
              colors={colors}
            />
          )}
        </View>
        {!projectFund && (
        <View style={[styles.kpiRow, { marginTop: 12 }]}>
          <KpiCard
            icon={<TrendingDown size={18} color={colors.danger} />}
            label="Default rate"
            value={`${report?.defaultRate ?? 0}%`}
            sub="≤ 5% target"
            colors={colors}
          />
          <View style={{ width: 12 }} />
          {/* Retention per group; backend will compute from real join/leave events */}
          <KpiCard
            icon={<Users size={18} color={colors.info} />}
            label="Member retention"
            value={`${avgRetention}%`}
            sub="last 12 months"
            colors={colors}
          />
        </View>
        )}

        {/* The group's own record, ahead of the charts and outside them. The
            share-out screen clears itself for the next cycle the moment the last
            member is paid, so this list is the permanent answer to who got what —
            a roll call of people and amounts, not a statistic. */}
        {!projectFund && (
          <View style={{ marginTop: 22 }}>
            <ShareOutHistory groupId={primaryGroup?.id} />
          </View>
        )}

        {/* What the money is being raised for — the equivalent question in a
            project-fund group, and the one members actually bring here. */}
        {projectFund && projectRows.length > 0 && (
          <Card padding={20} style={{ marginTop: 18 }}>
            <Text style={[styles.cardTitle, { color: colors.textMain }]}>Projects</Text>
            <Text style={[styles.cardSub, { color: colors.textMuted }]}>
              Raised so far · {primaryGroup?.name ?? ""}
            </Text>
            <View style={{ marginTop: 14 }}>
              {projectRows.map((p) => (
                <View key={p.id} style={[styles.rowBetween, { marginTop: 10 }]}>
                  <Text style={{ color: colors.textMain, fontWeight: "600", flex: 1 }}>
                    {p.name}
                  </Text>
                  <Text style={{ color: colors.textMain, fontWeight: "700" }}>
                    {formatZMW(p.collected)}
                    {p.targetAmount ? ` / ${formatZMW(p.targetAmount)}` : ""}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        )}

        {/* Savings trend chart */}
        <Card padding={20} style={{ marginTop: 18 }}>
          <Text style={[styles.cardTitle, { color: colors.textMain }]}>Savings trend</Text>
          <Text style={[styles.cardSub, { color: colors.textMuted }]}>
            {`Monthly savings · ${primaryGroup?.name ?? ""} (K'000)`}
          </Text>
          <View style={{ marginTop: 14 }}>
            <LineChart data={trendData} width={chartW} height={170} />
          </View>
        </Card>

        {/* Loan analytics — nothing to chart in a group that never lends. */}
        {!projectFund && (
        <Card padding={20} style={{ marginTop: 14 }}>
          <Text style={[styles.cardTitle, { color: colors.textMain }]}>Loans issued</Text>
          <Text style={[styles.cardSub, { color: colors.textMuted }]}>By quarter (K thousands)</Text>
          <View style={{ marginTop: 14 }}>
            <BarChart data={loanAnalytics} width={chartW} height={170} />
          </View>
        </Card>
        )}

        {/* Repayment rate for this group */}
        {!projectFund && (
        <Card padding={20} style={{ marginTop: 14, marginBottom: 24 }}>
          <Text style={[styles.cardTitle, { color: colors.textMain }]}>Repayment rate</Text>
          <Text style={[styles.cardSub, { color: colors.textMuted }]}>
            % of loan principal repaid
          </Text>
          <View style={{ marginTop: 18 }}>
            <View style={styles.rowBetween}>
              <Text style={{ color: colors.textMain, fontWeight: "600" }}>
                {primaryGroup?.name ?? "This group"}
              </Text>
              <Text style={{ color: colors.textMain, fontWeight: "700" }}>{groupRepayment}%</Text>
            </View>
            <View style={{ marginTop: 6, height: 8, borderRadius: 999, backgroundColor: colors.surfaceSecondary, overflow: "hidden" }}>
              <View
                style={{
                  height: 8,
                  width: `${groupRepayment}%`,
                  backgroundColor:
                    groupRepayment > 90
                      ? colors.success
                      : groupRepayment > 80
                        ? colors.warning
                        : colors.danger,
                  borderRadius: 999,
                }}
              />
            </View>
          </View>
        </Card>
        )}
      </ScrollView>
      <ExportSheet
        visible={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export transactions"
        subtitle="Download your transaction history as a file"
        onPdf={() => exportTransactionsPdf(data)}
        onCsv={() => exportTransactionsCsv(data)}
      />
    </SafeAreaView>
  );
}

const KpiCard = ({
  icon,
  label,
  value,
  sub,
  colors,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  colors: ReturnType<typeof useTheme>["colors"];
}) => (
  <Card padding={16} style={{ flex: 1 }}>
    <View style={[styles.kpiIcon, { backgroundColor: colors.primarySoft }]}>{icon}</View>
    <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: "600", marginTop: 10, letterSpacing: 0.3 }}>
      {label.toUpperCase()}
    </Text>
    <Text style={{ color: colors.textMain, fontSize: 22, fontWeight: "700", marginTop: 4, letterSpacing: -0.4 }}>
      {value}
    </Text>
    <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>{sub}</Text>
  </Card>
);

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 24 },
  sectionLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, marginTop: 22 },
  kpiRow: { flexDirection: "row" },
  kpiIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 16, fontWeight: "700", letterSpacing: -0.2 },
  cardSub: { fontSize: 12, marginTop: 4 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
