import React, { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useNavigation } from "expo-router";
import { useTheme } from "@/src/theme/ThemeContext";
import { ScreenHeader } from "@/src/components/common/ScreenHeader";
import { Card } from "@/src/components/ui/Card";
import { Button } from "@/src/components/ui/Button";
import { getGroupById, payGroupFee } from "@/src/services/groups";
import { getCurrentUser } from "@/src/utils/currentUser";
import { Group } from "@/src/types";
import { formatZMW } from "@/src/utils/currency";
import { getMonthsOwed, getAmountOwed } from "@/src/services/groupFees";
import { detectNetwork } from "@/src/services/mobileMoney";
import { Check, Clock, CalendarClock } from "lucide-react-native";
import { useAsyncEffect } from "@/src/hooks/useAsyncEffect";

type Receipt = {
  amount: number;
  months: number;
  network: string;
  networkColor: string;
  phone: string;
  groupName: string;
  paidThrough: string;
  date: string;
  receiptId?: string;
  pending?: boolean;
};

export default function GroupFeeScreen() {
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const navigation = useNavigation();

  const [group, setGroup] = useState<Group | null>(null);
  const [me, setMe] = useState<{ phone?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [payError, setPayError] = useState("");
  const [receiptRef] = useState(() => `CHF-${Math.floor(Math.random() * 90000) + 10000}`);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, user] = await Promise.all([
        groupId ? getGroupById(groupId) : Promise.resolve(undefined),
        getCurrentUser<{ phone?: string }>(),
      ]);
      setGroup(g ?? null);
      setMe(user);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useAsyncEffect(load);

  // Prevent back gesture once payment is complete
  useEffect(() => {
    if (paid) {
      navigation.setOptions({ gestureEnabled: false });
    }
  }, [paid, navigation]);

  const monthsOwed = group?.feeStatus?.monthsOwed ?? (group ? getMonthsOwed(group) : 0);
  const amountOwed = group?.feeStatus?.amountOwed ?? (group ? getAmountOwed(group) : 0);
  const account = detectNetwork(me?.phone ?? "");

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]} testID="group-fee-screen">
        <ScreenHeader title="Pay group fee" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!group) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
        <ScreenHeader title="Pay group fee" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
          <Text style={{ color: colors.textMain, fontSize: 16, fontWeight: "700" }}>Group not found</Text>
          <View style={{ marginTop: 24 }}>
            <Button label="Go back" onPress={() => router.back()} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Success screen — replaces the payment form after paying
  if (paid && receipt) {
    const [y, m, d] = receipt.paidThrough.split("-").map(Number);
    const paidUntilLabel = new Date(y, m - 1, d).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
        <ScreenHeader title="Receipt" hideBack />
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Success / processing check */}
          <View style={{ alignItems: "center", paddingTop: 16, paddingBottom: 8 }}>
            <View
              style={{
                width: 80,
                height: 80,
                borderRadius: 40,
                backgroundColor: (receipt.pending ? colors.warning : colors.success) + "20",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {receipt.pending ? (
                <Clock size={40} color={colors.warning} strokeWidth={2.5} />
              ) : (
                <Check size={40} color={colors.success} strokeWidth={2.5} />
              )}
            </View>
            <Text
              style={{
                color: colors.textMain,
                fontSize: 22,
                fontWeight: "800",
                textAlign: "center",
                marginTop: 16,
              }}
            >
              {receipt.pending ? "Payment processing" : "Payment successful"}
            </Text>
            <Text style={{ color: colors.textMuted, textAlign: "center", marginTop: 4 }}>
              {receipt.pending
                ? `Approve the payment on your phone. ${receipt.groupName} reactivates once it's confirmed`
                : `${receipt.groupName} reactivated`}
            </Text>
          </View>

          {/* Receipt card */}
          <Card padding={16} style={{ marginTop: 20 }}>
            <ReceiptRow label="Receipt no." value={receipt.receiptId ?? receiptRef} colors={colors} />
            <ReceiptRow label="Amount paid" value={formatZMW(receipt.amount)} colors={colors} />
            <ReceiptRow
              label="Months cleared"
              value={`${receipt.months} month${receipt.months === 1 ? "" : "s"}`}
              colors={colors}
            />
            <ReceiptRow
              label="Paid from"
              colors={colors}
              valueNode={
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <View
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      backgroundColor: receipt.networkColor,
                    }}
                  />
                  <Text style={{ color: colors.textMain, fontWeight: "600", fontSize: 14 }}>
                    {receipt.network}
                  </Text>
                </View>
              }
            />
            <ReceiptRow label="Number" value={receipt.phone} colors={colors} />
            <ReceiptRow
              label="Paid until"
              value={receipt.pending ? "Updates on confirmation" : paidUntilLabel}
              colors={colors}
            />
            <ReceiptRow label="Date" value={receipt.date} colors={colors} />
            <ReceiptRow
              label="Status"
              colors={colors}
              last
              valueNode={
                <View
                  style={{
                    backgroundColor: (receipt.pending ? colors.warning : colors.success) + "20",
                    borderRadius: 999,
                    paddingHorizontal: 10,
                    paddingVertical: 3,
                  }}
                >
                  <Text
                    style={{
                      color: receipt.pending ? colors.warning : colors.success,
                      fontSize: 12,
                      fontWeight: "700",
                    }}
                  >
                    {receipt.pending ? "Processing" : "Active"}
                  </Text>
                </View>
              }
            />
          </Card>
        </ScrollView>

        <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
          <Button
            label="Go to group"
            onPress={() => router.replace("/(tabs)/groups")}
            testID="fee-success-group-btn"
          />
        </View>
      </SafeAreaView>
    );
  }

  if (monthsOwed === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
        <ScreenHeader title="Pay group fee" subtitle={group.name} />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: colors.primarySoft,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <Check size={36} color={colors.primary} strokeWidth={2.5} />
          </View>
          <Text style={{ color: colors.textMain, fontSize: 17, fontWeight: "700", textAlign: "center" }}>
            This group&apos;s fee is fully paid.
          </Text>
          <View style={{ marginTop: 24, width: "100%" }}>
            <Button label="Go to groups" onPress={() => router.replace("/(tabs)/groups")} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const owedMonths = Array.from({ length: monthsOwed }, (_, i) => {
    const d = new Date(group.feePaidThrough!);
    d.setMonth(d.getMonth() + i + 1);
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  });

  const handlePay = async () => {
    setPaying(true);
    setPayError("");
    try {
      const res = await payGroupFee(group.id, me?.phone);
      const r = res?.receipt ?? {};
      // While the payment is processing, paidThrough hasn't advanced yet —
      // the settlement service extends it once PawaPay confirms.
      const pending = !r.paidThrough;
      const paidThrough =
        r.paidThrough ?? res?.group?.feePaidThrough ?? group.feePaidThrough ?? new Date().toISOString().split("T")[0];
      setReceipt({
        amount: r.amount ?? amountOwed,
        months: r.months ?? monthsOwed,
        network: account.network,
        networkColor: account.color,
        phone: me?.phone ?? "",
        groupName: group.name,
        paidThrough,
        date: new Date().toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
        receiptId: r.receiptId,
        pending,
      });
      setPaid(true);
    } catch (e: any) {
      setPayError(e?.message || "Fee payment failed. Please try again.");
    } finally {
      setPaying(false);
    }
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
      testID="group-fee-screen"
    >
      <ScreenHeader title="Pay group fee" subtitle={group.name} />
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Amount due */}
        <Card padding={20}>
          <Text style={[styles.overline, { color: colors.textMuted }]}>AMOUNT DUE</Text>
          <Text style={[styles.amount, { color: colors.textMain }]}>{formatZMW(amountOwed)}</Text>
          <Text style={{ color: colors.textMuted, fontSize: 14, marginTop: 4 }}>
            {monthsOwed} month{monthsOwed === 1 ? "" : "s"} × {formatZMW(group.monthlyFee ?? 100)}
          </Text>
        </Card>

        {/* Breakdown — only when more than one month is owed */}
        {monthsOwed > 1 && (
          <Card padding={16} style={{ marginTop: 14 }}>
            <Text style={[styles.overline, { color: colors.textMuted, marginBottom: 4 }]}>MONTHS OWED</Text>
            {owedMonths.map((month, idx) => (
              <View
                key={month}
                style={[
                  styles.monthRow,
                  {
                    borderBottomColor: colors.border,
                    borderBottomWidth: idx < owedMonths.length - 1 ? 1 : 0,
                  },
                ]}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <CalendarClock size={16} color={colors.textMuted} />
                  <Text style={{ color: colors.textMain, fontSize: 14, fontWeight: "500" }}>{month}</Text>
                </View>
                <Text style={{ color: colors.textMain, fontWeight: "600" }}>
                  {formatZMW(group.monthlyFee ?? 100)}
                </Text>
              </View>
            ))}
          </Card>
        )}

        {/* Paying from — auto-detected registered wallet */}
        <Text style={[styles.overline, { color: colors.textMuted, marginTop: 20, marginBottom: 8 }]}>
          PAYING FROM
        </Text>
        <Card padding={16}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: account.color,
                marginRight: 10,
              }}
            />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.textMain, fontWeight: "700", fontSize: 15 }}>
                {account.network === "Unknown" ? "Mobile money" : account.network}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                {me?.phone ?? ""}
              </Text>
            </View>
            {account.network !== "Unknown" && (
              <Check size={16} color={colors.success} strokeWidth={2.5} />
            )}
          </View>
        </Card>
        <Text style={[styles.caption, { color: colors.textMuted }]}>
          Payments are made from your registered mobile money account.
        </Text>

        <Text style={[styles.infoNote, { color: colors.textMuted }]}>
          Paying clears the outstanding balance and reactivates the group immediately for all members.
        </Text>
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
        {payError ? (
          <Text style={{ color: colors.danger, fontSize: 12, marginBottom: 10, fontWeight: "500" }}>
            {payError}
          </Text>
        ) : null}
        <Button
          label={paying ? "Processing…" : `Pay ${formatZMW(amountOwed)}`}
          onPress={handlePay}
          disabled={paying}
          loading={paying}
          testID="group-fee-pay-btn"
        />
      </View>
    </SafeAreaView>
  );
}

function ReceiptRow({
  label,
  value,
  valueNode,
  colors,
  last,
}: {
  label: string;
  value?: string;
  valueNode?: React.ReactNode;
  colors: ReturnType<typeof useTheme>["colors"];
  last?: boolean;
}) {
  return (
    <View
      style={[
        styles.receiptRow,
        !last && { borderBottomWidth: 1, borderBottomColor: colors.border },
      ]}
    >
      <Text style={{ color: colors.textMuted, fontSize: 13 }}>{label}</Text>
      {valueNode ?? (
        <Text style={{ color: colors.textMain, fontWeight: "600", fontSize: 14 }}>{value}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overline: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  amount: {
    fontSize: 34,
    fontWeight: "800",
    marginTop: 6,
    letterSpacing: -0.5,
  },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
  },
  caption: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 6,
  },
  infoNote: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 20,
    textAlign: "center",
    paddingHorizontal: 8,
  },
  receiptRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingBottom: 36,
    borderTopWidth: 1,
  },
});
