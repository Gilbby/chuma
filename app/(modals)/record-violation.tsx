import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ScreenHeader } from "@/src/components/common/ScreenHeader";
import { Card } from "@/src/components/ui/Card";
import { Button } from "@/src/components/ui/Button";
import { useTheme } from "@/src/theme/ThemeContext";
import { recordViolation, computePenaltyAmount } from "@/src/services/penalties";
import { getGroupById } from "@/src/services/groups";
import { formatZMW } from "@/src/utils/currency";
import { Group, Penalty } from "@/src/types";
import { AlertTriangle, Check } from "lucide-react-native";
import { useAsyncEffect } from "@/src/hooks/useAsyncEffect";

type ViolationType = Penalty["violationType"];
type Step = "form" | "success";

const TYPE_OPTIONS: { type: ViolationType; label: string; defaultReason: string }[] = [
  { type: "missingMeeting", label: "Missed meeting", defaultReason: "Missing meeting" },
  { type: "lateContribution", label: "Late contribution", defaultReason: "Late contribution" },
  { type: "lateRepayment", label: "Late loan repayment", defaultReason: "Late loan repayment" },
  { type: "other", label: "Other", defaultReason: "" },
];

export default function RecordViolation() {
  const { colors } = useTheme();
  const router = useRouter();
  const { groupId, memberId, memberName, groupName } = useLocalSearchParams<{
    groupId?: string;
    memberId?: string;
    memberName?: string;
    groupName?: string;
  }>();

  const [group, setGroup] = useState<Group | null>(null);
  const [groupLoading, setGroupLoading] = useState(true);
  const [step, setStep] = useState<Step>("form");
  const [violationType, setViolationType] = useState<ViolationType | null>(null);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<Penalty | null>(null);

  const load = useCallback(async () => {
    if (!groupId) {
      setGroupLoading(false);
      return;
    }
    setGroupLoading(true);
    try {
      const g = await getGroupById(String(groupId));
      setGroup(g ?? null);
    } catch {
      // Suggestions are a nicety; the form still works without the group
      setGroup(null);
    } finally {
      setGroupLoading(false);
    }
  }, [groupId]);

  useAsyncEffect(load);

  const suggestedAmount = (type: ViolationType): number => {
    const c = group?.constitution;
    if (!c) return 0;
    if (type === "missingMeeting") {
      return computePenaltyAmount(c.penaltyRules.missingMeeting, 0, 1);
    }
    if (type === "lateContribution") {
      return computePenaltyAmount(
        c.penaltyRules.lateContribution,
        group?.contributionAmount ?? 0,
        1
      );
    }
    if (type === "lateRepayment" && c.penaltyRules.lateRepayment.penaltyType === "flat") {
      return computePenaltyAmount(c.penaltyRules.lateRepayment, 0, 1);
    }
    return 0;
  };

  const selectType = (opt: (typeof TYPE_OPTIONS)[number]) => {
    setViolationType(opt.type);
    setReason(opt.defaultReason);
    const suggested = suggestedAmount(opt.type);
    setAmount(suggested > 0 ? String(suggested) : "");
  };

  const num = parseFloat(amount.replace(/,/g, "")) || 0;
  const typeError = submitAttempted && !violationType ? "Select a violation type" : "";
  const reasonError = submitAttempted && !reason.trim() ? "Enter a reason" : "";
  const amountError = submitAttempted && num <= 0 ? "Enter a valid amount" : "";

  const missingParams = !groupId || !memberId || !memberName;

  if (missingParams) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
        <ScreenHeader title="Record violation" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 }}>
          <Text style={{ color: colors.textMain, fontSize: 16, fontWeight: "700" }}>
            Member not found
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 6, textAlign: "center" }}>
            Open a member from the group screen to record a violation.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (groupLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
        <ScreenHeader title="Record violation" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (step === "success" && issued) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: colors.background }}
        edges={["top"]}
        testID="record-violation-success"
      >
        <View style={styles.successWrap}>
          <View style={[styles.successCircle, { backgroundColor: colors.primary }]}>
            <Check size={56} color="#fff" strokeWidth={3} />
          </View>
          <Text style={{ color: colors.textMain, fontSize: 24, fontWeight: "700", letterSpacing: -0.4 }}>
            Penalty recorded
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
            A {formatZMW(issued.amount)} penalty for “{issued.reason}” has been issued to{" "}
            {memberName}. They&apos;ve been notified and can pay it from their penalties list.
          </Text>
          <View style={{ flex: 1 }} />
          <View style={{ width: "100%", paddingHorizontal: 24, paddingBottom: 20 }}>
            <Button
              label="Done"
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))}
              testID="record-violation-done-btn"
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
      testID="record-violation-screen"
    >
      <ScreenHeader title="Record violation" subtitle={groupName ? String(groupName) : undefined} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Member being penalised */}
          <Card padding={16}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={[styles.memberIcon, { backgroundColor: colors.warning + "20" }]}>
                <AlertTriangle size={20} color={colors.warning} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: colors.textMain, fontWeight: "700", fontSize: 15 }}>
                  {memberName}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                  The member will be notified and asked to pay
                </Text>
              </View>
            </View>
          </Card>

          {/* Violation type */}
          <Text style={[styles.label, { color: colors.textMuted }]}>VIOLATION TYPE</Text>
          <View style={styles.typeGrid}>
            {TYPE_OPTIONS.map((opt) => {
              const selected = violationType === opt.type;
              return (
                <Pressable
                  key={opt.type}
                  onPress={() => selectType(opt)}
                  style={[
                    styles.typeChip,
                    {
                      backgroundColor: selected ? colors.primarySoft : colors.surface,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                  testID={`record-violation-type-${opt.type}`}
                >
                  <Text
                    style={{
                      color: selected ? colors.primary : colors.textMain,
                      fontWeight: selected ? "700" : "600",
                      fontSize: 13,
                    }}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {typeError ? <Text style={[styles.errText, { color: colors.danger }]}>{typeError}</Text> : null}

          {/* Reason */}
          <Text style={[styles.label, { color: colors.textMuted }]}>REASON</Text>
          <TextInput
            style={[
              styles.reasonInput,
              {
                color: colors.textMain,
                backgroundColor: colors.surface,
                borderColor: reasonError ? colors.danger : colors.border,
              },
            ]}
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. Missed the March meeting without notice"
            placeholderTextColor={colors.textMuted}
            multiline
            testID="record-violation-reason-input"
          />
          {reasonError ? <Text style={[styles.errText, { color: colors.danger }]}>{reasonError}</Text> : null}

          {/* Amount */}
          <Text style={[styles.label, { color: colors.textMuted }]}>PENALTY AMOUNT</Text>
          <View
            style={[
              styles.amountWrap,
              { backgroundColor: colors.surface, borderColor: amountError ? colors.danger : colors.border },
            ]}
          >
            <Text style={[styles.currency, { color: colors.primary }]}>K</Text>
            <TextInput
              style={[styles.amountInput, { color: colors.textMain }]}
              value={amount}
              onChangeText={setAmount}
              keyboardType={Platform.OS === "ios" ? "decimal-pad" : "numeric"}
              placeholder="0"
              placeholderTextColor={colors.textMuted}
              testID="record-violation-amount-input"
            />
          </View>
          {amountError ? (
            <Text style={[styles.errText, { color: colors.danger }]}>{amountError}</Text>
          ) : violationType && suggestedAmount(violationType) > 0 ? (
            <Text style={[styles.helper, { color: colors.textMuted }]}>
              Suggested by group rules: {formatZMW(suggestedAmount(violationType))}
            </Text>
          ) : null}

          {error ? <Text style={[styles.errText, { color: colors.danger }]}>{error}</Text> : null}

          <View style={{ flex: 1, minHeight: 24 }} />
          <Button
            label="Issue penalty"
            loading={submitting}
            disabled={submitting}
            onPress={async () => {
              setSubmitAttempted(true);
              setError("");
              if (!violationType || !reason.trim() || num <= 0) return;
              setSubmitting(true);
              try {
                const penalty = await recordViolation({
                  groupId: String(groupId),
                  memberId: String(memberId),
                  violationType,
                  reason: reason.trim(),
                  amount: num,
                });
                setIssued(penalty);
                setStep("success");
              } catch (e: any) {
                setError(e?.message || "Could not record the violation. Please try again.");
              } finally {
                setSubmitting(false);
              }
            }}
            testID="record-violation-submit-btn"
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 20, paddingTop: 4 },
  memberIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginTop: 20,
    marginBottom: 10,
  },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  reasonInput: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    minHeight: 72,
    textAlignVertical: "top",
  },
  amountWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 56,
  },
  currency: { fontSize: 18, fontWeight: "700", marginRight: 8 },
  amountInput: { flex: 1, fontSize: 20, fontWeight: "700" },
  helper: { fontSize: 12, marginTop: 8 },
  errText: { fontSize: 12, marginTop: 8, fontWeight: "500" },
  successWrap: { flex: 1, alignItems: "center", paddingTop: 60 },
  successCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
});
