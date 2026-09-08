import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ScreenHeader } from "@/src/components/common/ScreenHeader";
import { Card } from "@/src/components/ui/Card";
import { Button } from "@/src/components/ui/Button";
import { useTheme } from "@/src/theme/ThemeContext";
import { payPenalty } from "@/src/services/penalties";
import { getCurrentUser } from "@/src/utils/currentUser";
import { detectNetwork } from "@/src/services/mobileMoney";
import { formatZMW } from "@/src/utils/currency";
import { Check, Clock, Receipt, Lock } from "lucide-react-native";
import {
  MOBILE_MONEY_ON_HOLD,
  MOBILE_MONEY_HOLD_NOTE,
} from "@/src/constants";
import { useAsyncEffect } from "@/src/hooks/useAsyncEffect";

type Step = "confirm" | "success";

export default function PenaltyPay() {
  const { colors } = useTheme();
  const router = useRouter();
  const { penaltyId, amount, reason, groupName } = useLocalSearchParams<{
    penaltyId?: string;
    amount?: string;
    reason?: string;
    groupName?: string;
  }>();

  const [step, setStep] = useState<Step>("confirm");
  const [payerPhone, setPayerPhone] = useState("");
  const [userLoading, setUserLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [resultTxn, setResultTxn] = useState<any>(null);
  const [receiptId] = useState(() => `CHM-${Math.floor(Math.random() * 90000) + 10000}`);

  const load = useCallback(async () => {
    setUserLoading(true);
    try {
      const user = await getCurrentUser<{ phone?: string }>();
      setPayerPhone(user?.phone ?? "");
    } finally {
      setUserLoading(false);
    }
  }, []);

  useAsyncEffect(load);

  const num = Number(amount) || 0;
  const wallet = detectNetwork(payerPhone);
  const missingParams = !penaltyId || !amount || !reason || !groupName;

  if (missingParams) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
        <ScreenHeader title="Pay penalty" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 }}>
          <Text style={{ color: colors.textMain, fontSize: 16, fontWeight: "700" }}>
            Penalty not found
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 6, textAlign: "center" }}>
            We couldn&apos;t find the details for this penalty.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (userLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
        <ScreenHeader title="Pay penalty" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (step === "success") {
    return (
      <SuccessScreen
        amount={num}
        group={groupName!}
        colors={colors}
        router={router}
        receiptId={resultTxn?.receiptId ?? receiptId}
        pending={resultTxn?.status === "pending"}
      />
    );
  }

  if (alreadyPaid) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: colors.background }}
        edges={["top"]}
        testID="penalty-pay-already-paid"
      >
        <ScreenHeader title="Pay penalty" />
        <View style={styles.content}>
          <Card padding={20}>
            <Text style={{ color: colors.textMain, fontSize: 16, fontWeight: "700" }}>
              Already paid
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 6, lineHeight: 19 }}>
              This penalty of {formatZMW(num)} has already been paid. Nothing more is owed.
            </Text>
          </Card>
          <View style={{ flex: 1 }} />
          <Button
            label="Back to penalties"
            onPress={() => router.replace("/penalties")}
            testID="penalty-pay-already-paid-btn"
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
      testID="penalty-pay-screen"
    >
      <ScreenHeader title="Pay penalty" />
      <ScrollView contentContainerStyle={styles.content}>
        <Card padding={20}>
          <Text style={[styles.confirmLabel, { color: colors.textMuted }]}>Amount</Text>
          <Text style={[styles.confirmAmount, { color: colors.textMain }]}>{formatZMW(num)}</Text>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <ConfirmRow label="Group" value={groupName!} colors={colors} />
          <ConfirmRow label="Reason" value={reason!} colors={colors} />
          <View style={[styles.confirmRow, { borderBottomWidth: 0 }]}>
            <Text style={{ color: colors.textMuted, fontSize: 13 }}>From</Text>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              {MOBILE_MONEY_ON_HOLD ? (
                <Lock size={13} color={colors.textMuted} style={{ marginRight: 6 }} />
              ) : (
                <View style={[styles.dot, { backgroundColor: wallet.color }]} />
              )}
              <Text style={{ color: colors.textMain, fontSize: 14, fontWeight: "600" }}>
                {MOBILE_MONEY_ON_HOLD ? "Cash" : wallet.network}
              </Text>
            </View>
          </View>
        </Card>

        <Text style={[styles.note, { color: colors.textMuted }]}>
          {MOBILE_MONEY_ON_HOLD
            ? `${MOBILE_MONEY_HOLD_NOTE} Hand the cash to your treasurer. The penalty clears once they confirm it.`
            : "Penalties are collected from your registered wallet."}
        </Text>

        {error ? <Text style={[styles.errText, { color: colors.danger }]}>{error}</Text> : null}

        <View style={{ flex: 1, minHeight: 24 }} />
        <Button
          label="Confirm & pay"
          loading={submitting}
          disabled={submitting}
          onPress={async () => {
            setSubmitting(true);
            setError("");
            try {
              const res = await payPenalty(
                String(penaltyId),
                undefined,
                // Cash is the only method the API accepts while the hold is on.
                MOBILE_MONEY_ON_HOLD ? "Cash" : undefined
              );
              setResultTxn(res?.transaction ?? null);
              setStep("success");
            } catch (e: any) {
              const msg = e?.message || "";
              if (/already.*paid/i.test(msg)) {
                setAlreadyPaid(true);
              } else {
                setError(msg || "Payment failed. Please try again.");
              }
            } finally {
              setSubmitting(false);
            }
          }}
          testID="penalty-pay-confirm-btn"
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const ConfirmRow = ({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useTheme>["colors"];
}) => (
  <View style={[styles.confirmRow, { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
    <Text style={{ color: colors.textMuted, fontSize: 13 }}>{label}</Text>
    <Text style={{ color: colors.textMain, fontSize: 14, fontWeight: "600" }} numberOfLines={1}>
      {value}
    </Text>
  </View>
);

const SuccessScreen = ({
  amount,
  group,
  colors,
  router,
  receiptId,
  pending,
}: {
  amount: number;
  group: string;
  colors: ReturnType<typeof useTheme>["colors"];
  router: ReturnType<typeof useRouter>;
  receiptId: string;
  pending: boolean;
}) => (
  <SafeAreaView
    style={{ flex: 1, backgroundColor: colors.background }}
    edges={["top"]}
    testID="penalty-pay-success"
  >
    <View style={styles.successWrap}>
      <View style={[styles.successCircle, { backgroundColor: pending ? colors.warning : colors.primary }]}>
        {pending ? (
          <Clock size={56} color="#fff" strokeWidth={2.5} />
        ) : (
          <Check size={56} color="#fff" strokeWidth={3} />
        )}
      </View>
      <Text style={{ color: colors.textMain, fontSize: 24, fontWeight: "700", letterSpacing: -0.4 }}>
        {pending
          ? MOBILE_MONEY_ON_HOLD
            ? "Payment recorded"
            : "Payment processing"
          : "Penalty paid"}
      </Text>
      <Text
        style={{
          color: colors.textMuted,
          fontSize: 14,
          marginTop: 8,
          textAlign: "center",
          paddingHorizontal: 40,
        }}
      >
        {pending
          ? MOBILE_MONEY_ON_HOLD
            ? `Your ${formatZMW(amount)} cash payment to ${group} is recorded. The penalty is marked paid once an admin confirms they have the money.`
            : `Approve the ${formatZMW(amount)} payment on your phone. The penalty will be marked paid as soon as the payment is confirmed.`
          : `Your penalty payment of ${formatZMW(amount)} to ${group} has been recorded.`}
      </Text>

      <View style={{ width: "100%", paddingHorizontal: 24, marginTop: 28 }}>
        <Card padding={16}>
          <View style={styles.rowBetween}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Receipt size={18} color={colors.primary} />
              <Text style={{ color: colors.textMain, fontWeight: "600", marginLeft: 8 }}>
                Receipt {receiptId}
              </Text>
            </View>
            <Text style={{ color: pending ? colors.warning : colors.primary, fontWeight: "700", fontSize: 13 }}>
              {pending ? "Pending" : "Saved"}
            </Text>
          </View>
        </Card>
      </View>

      <View style={{ flex: 1 }} />

      <View style={{ width: "100%", paddingHorizontal: 24 }}>
        <Button
          label="Done"
          onPress={() => router.replace("/penalties")}
          testID="penalty-pay-done-btn"
        />
      </View>
    </View>
  </SafeAreaView>
);

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 20, paddingTop: 4 },
  confirmLabel: { fontSize: 12, fontWeight: "600", letterSpacing: 0.3 },
  confirmAmount: { fontSize: 36, fontWeight: "700", letterSpacing: -0.6, marginTop: 4 },
  divider: { height: 1, marginVertical: 14 },
  confirmRow: { paddingVertical: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  note: { fontSize: 12, marginTop: 14, lineHeight: 18 },
  errText: { fontSize: 12, marginTop: 12, fontWeight: "500" },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  successWrap: { flex: 1, alignItems: "center", paddingTop: 60, paddingBottom: 20 },
  successCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
});
