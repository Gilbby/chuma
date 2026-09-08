import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "@/src/theme/ThemeContext";
import { ScreenHeader, ErrorState, ExportSheet } from "@/src/components/common";
import { Card } from "@/src/components/ui/Card";
import { Button } from "@/src/components/ui/Button";
import { SkeletonGroup } from "@/src/components/ui";
import { getGroups } from "@/src/services/groups";
import {
  getStatement,
  Statement,
  StatementActivity,
  StatementPurpose,
} from "@/src/services/statement";
import { exportStatementPdf, exportStatementCsv } from "@/src/utils/exports";
import { formatZMW } from "@/src/utils/currency";
import { movementLabel, statementCopy, statementFlavourFor } from "@/src/utils/statementCopy";
import { Group } from "@/src/types";
import { Download, Calendar, ChevronDown, ChevronRight, Check } from "lucide-react-native";
import { useAsyncEffect } from "@/src/hooks/useAsyncEffect";

// ─── Period presets ──────────────────────────────────────────────────────────
// A statement always covers a closed range. `to` is pushed to the last
// millisecond of its day so a transaction made this afternoon still lands
// inside "This month".

type PresetKey = "this-month" | "last-month" | "3months" | "year" | "custom";

const endOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

function presetRange(key: Exclude<PresetKey, "custom">): { from: Date; to: Date } {
  const now = new Date();
  switch (key) {
    case "this-month":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(now) };
    case "last-month":
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        to: endOfDay(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case "3months":
      return { from: new Date(now.getFullYear(), now.getMonth() - 2, 1), to: endOfDay(now) };
    case "year":
      return { from: new Date(now.getFullYear(), 0, 1), to: endOfDay(now) };
  }
}

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "3months", label: "Last 3 months" },
  { key: "year", label: "This year" },
  { key: "custom", label: "Custom" },
];

const fmtDay = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const fmtShort = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
const fmtMonth = (d: Date) =>
  d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

/** The trailing 24 calendar months, newest first — the custom-range choices. */
function recentMonths(count = 24): Date[] {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => new Date(now.getFullYear(), now.getMonth() - i, 1));
}

export default function StatementScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ groupId?: string }>();

  const [preset, setPreset] = useState<PresetKey>("this-month");
  const [range, setRange] = useState(() => presetRange("this-month"));
  const [groupId, setGroupId] = useState<string | null>(params.groupId ?? null);

  const [groups, setGroups] = useState<Group[]>([]);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [exportOpen, setExportOpen] = useState(false);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [periodPickerOpen, setPeriodPickerOpen] = useState(false);
  const [customStart, setCustomStart] = useState<Date | null>(null);

  useEffect(() => {
    getGroups()
      .then(setGroups)
      .catch(() => setGroups([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setStatement(await getStatement({ from: range.from, to: range.to, groupId }));
    } catch (e) {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [range, groupId]);

  useAsyncEffect(load);

  const scopedGroup = groupId ? groups.find((g) => g.id === groupId) : undefined;
  const groupLabel = groupId ? scopedGroup?.name ?? "Selected group" : "All groups";

  // A church group's money is given, not saved. Same figures, different words —
  // see statementCopy. Scoped to one group it follows that group; across all of
  // them only an all-project-fund member gets the giving wording.
  const flavour = statementFlavourFor(
    groupId
      ? [statement?.group?.groupType ?? scopedGroup?.groupType]
      : groups.map((g) => g.groupType)
  );
  const copy = statementCopy(flavour);
  // A giving statement is the totals card and then the movements, nothing else.
  const brief = copy.detail === "brief";
  const periodLabel = `${fmtDay(range.from)} – ${fmtDay(range.to)}`;

  const choosePreset = (key: PresetKey) => {
    if (key === "custom") {
      setCustomStart(null);
      setPeriodPickerOpen(true);
      return;
    }
    setPreset(key);
    setRange(presetRange(key));
  };

  // Two taps: first month = start, second = end (inclusive). Tapping the same
  // month twice gives that single month.
  const chooseMonth = (month: Date) => {
    if (!customStart) {
      setCustomStart(month);
      return;
    }
    const [a, b] = customStart <= month ? [customStart, month] : [month, customStart];
    const to = endOfDay(new Date(b.getFullYear(), b.getMonth() + 1, 0));
    const now = new Date();
    setRange({ from: a, to: to > now ? endOfDay(now) : to });
    setPreset("custom");
    setCustomStart(null);
    setPeriodPickerOpen(false);
  };

  const months = useMemo(() => recentMonths(), []);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
      testID="statement-screen"
    >
      <ScreenHeader
        title="Statement"
        subtitle={periodLabel}
        rightAction={
          <Pressable
            onPress={() => setExportOpen(true)}
            disabled={!statement}
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: "center",
              justifyContent: "center",
              opacity: statement ? 1 : 0.4,
            }}
            testID="statement-export-btn"
          >
            <Download size={18} color={colors.primary} />
          </Pressable>
        }
      />

      {/* Scope: which group, which period */}
      <View style={styles.scopeRow}>
        <Pressable
          onPress={() => setGroupPickerOpen(true)}
          style={[styles.scopeBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          testID="statement-group-btn"
        >
          <Text style={[styles.scopeText, { color: colors.textMain }]} numberOfLines={1}>
            {groupLabel}
          </Text>
          <ChevronDown size={16} color={colors.textMuted} />
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
        style={styles.chipScroll}
      >
        {PRESETS.map((item) => {
          const active = item.key === preset;
          return (
            <Pressable
              key={item.key}
              onPress={() => choosePreset(item.key)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? colors.primary : colors.surface,
                  borderColor: active ? colors.primary : colors.border,
                },
              ]}
              testID={`statement-preset-${item.key}`}
            >
              {item.key === "custom" ? (
                <Calendar size={13} color={active ? "#fff" : colors.textMuted} />
              ) : null}
              <Text
                numberOfLines={1}
                style={[styles.chipText, { color: active ? "#fff" : colors.textMain }]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={{ paddingHorizontal: 20, marginTop: 12 }}>
          <SkeletonGroup count={4} height={110} />
        </View>
      ) : error || !statement ? (
        <ErrorState onRetry={load} />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Balance summary */}
          <Card padding={18} testID="statement-summary">
            <Text style={[styles.eyebrow, { color: colors.textMuted }]}>
              {copy.balanceLabel.toUpperCase()}
            </Text>
            <Text style={[styles.balance, { color: colors.textMain }]}>
              {formatZMW(statement.closingBalance)}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>
              {statement.group ? statement.group.name : "Across all your groups"} · as at{" "}
              {fmtDay(statement.period.to)}
            </Text>

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            <SummaryRow
              k={copy.openingLabel}
              v={formatZMW(statement.openingBalance)}
              colors={colors}
            />
            <SummaryRow
              k={copy.inLabel}
              v={`+${formatZMW(statement.savingsIn)}`}
              tint={colors.success}
              colors={colors}
            />
            {copy.outLabel ? (
              <SummaryRow
                k={copy.outLabel}
                v={`−${formatZMW(statement.savingsOut)}`}
                tint={statement.savingsOut > 0 ? colors.danger : undefined}
                colors={colors}
              />
            ) : null}
            <SummaryRow
              k={copy.closingLabel}
              v={formatZMW(statement.closingBalance)}
              bold
              colors={colors}
            />
          </Card>

          {/* The running-balance account. A project fund has no balance to
              run — see StatementCopy.detail — so a brief statement skips it. */}
          {!brief && (
            <>
              <SectionTitle colors={colors}>{copy.ledgerTitle.toUpperCase()}</SectionTitle>
              <Card padding={0}>
                <LedgerRow
                  date={fmtShort(statement.period.from)}
                  title={copy.ledgerOpeningRow}
                  amount={null}
                  balance={statement.openingBalance}
                  colors={colors}
                  muted
                />
                {statement.lines.length === 0 ? (
                  <View style={{ padding: 16 }}>
                    <Text style={{ color: colors.textMuted, fontSize: 13 }}>
                      {copy.ledgerEmpty}
                    </Text>
                  </View>
                ) : (
                  statement.lines.map((l) => (
                    <LedgerRow
                      key={l.id}
                      date={fmtShort(l.date)}
                      title={l.description}
                      subtitle={statement.group ? l.note : l.groupName}
                      amount={l.delta}
                      balance={l.balance}
                      colors={colors}
                      onPress={
                        l.receiptId
                          ? () =>
                              router.push({
                                pathname: "/receipt",
                                params: {
                                  amount: String(Math.abs(l.delta)),
                                  type: l.type === "combined" ? "contribution" : l.type,
                                  group: l.groupName,
                                  date: fmtDay(l.date),
                                  note: l.note,
                                  status: l.status,
                                  direction: l.delta >= 0 ? "out" : "in",
                                  txnId: l.receiptId,
                                },
                              })
                          : undefined
                      }
                    />
                  ))
                )}
                <LedgerRow
                  date={fmtShort(statement.period.to)}
                  title={copy.ledgerClosingRow}
                  amount={null}
                  balance={statement.closingBalance}
                  colors={colors}
                  bold
                  last
                />
              </Card>
            </>
          )}

          {/* Every movement in the period. On a brief statement this IS the
              statement: what it was, when, and which way the money went.
              Anything more — reference, method, fees — is a tap away. */}
          <SectionTitle colors={colors}>{copy.activityTitle.toUpperCase()}</SectionTitle>
          <Card padding={0}>
            {statement.activity.length === 0 ? (
              <View style={{ padding: 16 }}>
                <Text style={{ color: colors.textMuted, fontSize: 13 }}>
                  No transactions in this period.
                </Text>
              </View>
            ) : (
              statement.activity.map((a, i) => (
                <ActivityRow
                  key={a.id}
                  item={a}
                  label={movementLabel(copy, a)}
                  showGroup={!statement.group}
                  colors={colors}
                  last={i === statement.activity.length - 1}
                  onPress={() =>
                    router.push({
                      pathname: "/receipt",
                      params: {
                        amount: String(a.amount),
                        type: a.type === "combined" ? "contribution" : a.type,
                        group: a.groupName,
                        date: fmtDay(a.date),
                        note: a.note,
                        status: a.status,
                        direction: a.direction,
                        // A settled movement has a real receipt number; one
                        // still pending has none, so the screen derives from id.
                        ...(a.receiptId ? { txnId: a.receiptId } : { id: a.id }),
                      },
                    })
                  }
                />
              ))
            )}
          </Card>

          {/* Cash totals, itemised by what the money was for. A brief
              statement drops them: the activity list is the whole account,
              and a giver has no stake to reconcile a breakdown against. */}
          {!brief && (
            <>
              <SectionTitle colors={colors}>WHERE YOUR MONEY WENT</SectionTitle>
              <Card padding={18}>
                <PurposeGroup
                  title="Money you received"
                  rows={statement.breakdown?.in ?? []}
                  total={statement.totals.moneyIn}
                  totalLabel="Total received"
                  sign="+"
                  tint={colors.success}
                  colors={colors}
                />
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <PurposeGroup
                  title="Money you paid"
                  rows={statement.breakdown?.out ?? []}
                  total={statement.totals.moneyOut}
                  totalLabel="Total paid"
                  sign="−"
                  colors={colors}
                />
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                {statement.totals.pending > 0 ? (
                  <>
                    <SummaryRow
                      k="Still pending"
                      v={formatZMW(statement.totals.pending)}
                      tint={colors.warning}
                      colors={colors}
                    />
                    <Text
                      style={{ color: colors.textMuted, fontSize: 11, marginTop: -4, marginBottom: 6 }}
                    >
                      Not counted below until it settles
                    </Text>
                  </>
                ) : null}
                <SummaryRow
                  k="Net movement"
                  v={`${statement.totals.net < 0 ? "−" : "+"}${formatZMW(Math.abs(statement.totals.net))}`}
                  bold
                  colors={colors}
                />
              </Card>
            </>
          )}

          <Text style={[styles.note, { color: colors.textMuted }]}>
            Statement no. {statement.statementId} · issued {fmtDay(statement.generatedAt)}.
            {"\n"}{copy.footnote}
          </Text>
        </ScrollView>
      )}

      <ExportSheet
        visible={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export statement"
        subtitle={periodLabel}
        pdfHint="Bank-style statement, ready to print or share"
        csvHint="Spreadsheet format, opens in Excel or Sheets"
        onPdf={() => statement && exportStatementPdf(statement, flavour)}
        onCsv={() => statement && exportStatementCsv(statement, flavour)}
      />

      {/* Group scope picker */}
      <Modal
        visible={groupPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setGroupPickerOpen(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }}
          onPress={() => setGroupPickerOpen(false)}
        />
        <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom, 24) }]}>
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <Text style={[styles.sheetTitle, { color: colors.textMain }]}>Statement for</Text>
          <Card padding={0}>
            <PickerRow
              label="All groups"
              selected={groupId === null}
              onPress={() => {
                setGroupId(null);
                setGroupPickerOpen(false);
              }}
              colors={colors}
              testID="statement-group-all"
            />
            {groups.map((g) => (
              <PickerRow
                key={g.id}
                label={g.name}
                selected={groupId === g.id}
                onPress={() => {
                  setGroupId(g.id);
                  setGroupPickerOpen(false);
                }}
                colors={colors}
                testID={`statement-group-${g.id}`}
              />
            ))}
          </Card>
          <Button
            label="Cancel"
            variant="ghost"
            style={{ marginTop: 16 }}
            onPress={() => setGroupPickerOpen(false)}
          />
        </View>
      </Modal>

      {/* Custom period picker — pick a start month, then an end month */}
      <Modal
        visible={periodPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPeriodPickerOpen(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }}
          onPress={() => setPeriodPickerOpen(false)}
        />
        <View style={[styles.sheet, { backgroundColor: colors.background, maxHeight: "70%", paddingBottom: Math.max(insets.bottom, 24) }]}>
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <Text style={[styles.sheetTitle, { color: colors.textMain }]}>
            {customStart ? "Pick the last month" : "Pick the first month"}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 13, marginBottom: 16 }}>
            {customStart
              ? `From ${fmtMonth(customStart)} to…`
              : "Choose the month your statement should start"}
          </Text>
          <ScrollView style={{ maxHeight: 320 }}>
            <Card padding={0}>
              {months.map((m) => (
                <PickerRow
                  key={m.toISOString()}
                  label={fmtMonth(m)}
                  selected={!!customStart && m.getTime() === customStart.getTime()}
                  onPress={() => chooseMonth(m)}
                  colors={colors}
                  testID={`statement-month-${m.getFullYear()}-${m.getMonth() + 1}`}
                />
              ))}
            </Card>
          </ScrollView>
          <Button
            label="Cancel"
            variant="ghost"
            style={{ marginTop: 16 }}
            onPress={() => {
              setCustomStart(null);
              setPeriodPickerOpen(false);
            }}
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

type Colors = ReturnType<typeof useTheme>["colors"];

const SectionTitle: React.FC<{ children: React.ReactNode; colors: Colors }> = ({
  children,
  colors,
}) => <Text style={[styles.section, { color: colors.textMuted }]}>{children}</Text>;

/**
 * One movement, the way a phone should show it: what it was, when, and a
 * colour that says which way the money went — green in, red out. Everything a
 * receipt carries (reference, method, fees, network charge) is a tap away
 * rather than crammed into a row read standing up on a bus.
 */
const ActivityRow: React.FC<{
  item: StatementActivity;
  label: string;
  showGroup: boolean;
  colors: Colors;
  last?: boolean;
  onPress: () => void;
}> = ({ item, label, showGroup, colors, last, onPress }) => {
  // Nothing has moved yet on a pending line, so it stays grey rather than
  // claiming a colour it has not earned.
  const settled = item.status === "completed";
  return (
    <Pressable
      onPress={onPress}
      testID={`statement-activity-${item.id}`}
      style={({ pressed }) => [
        styles.activityRow,
        !last && { borderBottomWidth: 1, borderBottomColor: colors.border },
        pressed && { opacity: 0.6 },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={{ color: colors.textMain, fontWeight: "600", fontSize: 13 }}
          numberOfLines={1}
        >
          {label}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>
          {fmtShort(item.date)}
          {showGroup && item.groupName ? ` · ${item.groupName}` : ""}
          {settled ? "" : ` · ${item.status}`}
        </Text>
      </View>
      <Text
        style={{
          color: !settled
            ? colors.textMuted
            : item.direction === "in"
              ? colors.success
              : colors.danger,
          fontWeight: "700",
          fontSize: 13,
          marginLeft: 12,
        }}
      >
        {item.direction === "in" ? "+" : "−"}
        {formatZMW(item.amount)}
      </Text>
      <ChevronRight size={16} color={colors.textMuted} style={{ marginLeft: 6 }} />
    </Pressable>
  );
};

const SummaryRow: React.FC<{
  k: string;
  v: string;
  colors: Colors;
  tint?: string;
  bold?: boolean;
}> = ({ k, v, colors, tint, bold }) => (
  <View style={styles.summaryRow}>
    <Text style={{ color: colors.textMuted, fontSize: 13, fontWeight: bold ? "700" : "400" }}>
      {k}
    </Text>
    <Text
      style={{
        color: tint ?? colors.textMain,
        fontSize: bold ? 15 : 13,
        fontWeight: bold ? "800" : "600",
      }}
    >
      {v}
    </Text>
  </View>
);

/**
 * One side of the cash summary, itemised.
 *
 * "Money out K15,000" is a number, not an account — it hides that K14,860 of it
 * became savings and K140 cleared a penalty. The rows are the payment's own
 * legs and always sum to the total printed beneath them, so the itemisation
 * reads as the explanation of that total rather than as a second opinion.
 *
 * With no rows (an older API, or a quiet period) the total still stands on its
 * own, so the card never depends on the breakdown being there.
 */
const PurposeGroup: React.FC<{
  title: string;
  rows: StatementPurpose[];
  total: number;
  totalLabel: string;
  sign: "+" | "−";
  colors: Colors;
  tint?: string;
}> = ({ title, rows, total, totalLabel, sign, colors, tint }) => (
  <View>
    <Text
      style={{
        color: colors.textMuted,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.4,
        marginBottom: 2,
      }}
    >
      {title.toUpperCase()}
    </Text>
    {rows.length > 0 ? (
      rows.map((r) => (
        <View key={r.key} style={styles.summaryRow}>
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>{r.label}</Text>
          <Text style={{ color: tint ?? colors.textMain, fontSize: 13, fontWeight: "600" }}>
            {sign}
            {formatZMW(r.amount)}
          </Text>
        </View>
      ))
    ) : total <= 0 ? (
      <Text style={{ color: colors.textMuted, fontSize: 13, paddingVertical: 6 }}>
        Nothing this period
      </Text>
    ) : null}
    <SummaryRow k={totalLabel} v={`${sign}${formatZMW(total)}`} bold colors={colors} />
  </View>
);

const LedgerRow: React.FC<{
  date: string;
  title: string;
  subtitle?: string;
  amount: number | null;
  balance: number;
  colors: Colors;
  muted?: boolean;
  bold?: boolean;
  last?: boolean;
  onPress?: () => void;
}> = ({ date, title, subtitle, amount, balance, colors, muted, bold, last, onPress }) => (
  <Pressable
    onPress={onPress}
    disabled={!onPress}
    style={[
      styles.ledgerRow,
      !last && { borderBottomWidth: 1, borderBottomColor: colors.border },
    ]}
  >
    <Text style={{ color: colors.textMuted, fontSize: 11, width: 52 }}>{date}</Text>
    <View style={{ flex: 1, paddingRight: 8 }}>
      <Text
        style={{
          color: muted ? colors.textMuted : colors.textMain,
          fontSize: 13,
          fontWeight: bold ? "800" : "600",
        }}
        numberOfLines={1}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </View>
    <View style={{ alignItems: "flex-end", minWidth: 92 }}>
      {amount === null ? (
        <Text style={{ color: colors.textMuted, fontSize: 12 }}>—</Text>
      ) : (
        <Text
          style={{
            color: amount < 0 ? colors.danger : colors.success,
            fontSize: 13,
            fontWeight: "700",
          }}
        >
          {amount < 0 ? "−" : "+"}
          {formatZMW(Math.abs(amount))}
        </Text>
      )}
      <Text
        style={{
          color: colors.textMain,
          fontSize: 12,
          fontWeight: bold ? "800" : "500",
          marginTop: 2,
        }}
      >
        {formatZMW(balance)}
      </Text>
    </View>
  </Pressable>
);

const PickerRow: React.FC<{
  label: string;
  selected: boolean;
  onPress: () => void;
  colors: Colors;
  testID?: string;
}> = ({ label, selected, onPress, colors, testID }) => (
  <Pressable
    onPress={onPress}
    testID={testID}
    style={{
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 14,
    }}
  >
    <Text
      style={{
        color: colors.textMain,
        fontSize: 14,
        fontWeight: selected ? "700" : "500",
      }}
    >
      {label}
    </Text>
    {selected ? <Check size={18} color={colors.primary} /> : null}
  </Pressable>
);

const styles = StyleSheet.create({
  scopeRow: { paddingHorizontal: 20, marginBottom: 10 },
  scopeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
  },
  scopeText: { fontSize: 14, fontWeight: "600", flex: 1 },
  chipScroll: { flexGrow: 0, height: 44, marginBottom: 8 },
  chipRow: { paddingHorizontal: 20, alignItems: "center" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginRight: 8,
    flexShrink: 0,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontWeight: "600" },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2 },
  balance: { fontSize: 30, fontWeight: "800", letterSpacing: -0.8, marginTop: 6 },
  divider: { height: 1, marginVertical: 14 },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  section: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginTop: 22,
    marginBottom: 8,
  },
  ledgerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  note: { fontSize: 11, lineHeight: 17, marginTop: 18, textAlign: "center" },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 20,
  },
  sheetTitle: { fontSize: 18, fontWeight: "700", marginBottom: 12 },
});
