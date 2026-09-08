import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Platform,
  ActivityIndicator,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ScreenHeader } from "@/src/components/common/ScreenHeader";
import { NoGroupState } from "@/src/components/common/NoGroupState";
import { ErrorState } from "@/src/components/common/ErrorState";
import { Card } from "@/src/components/ui/Card";
import { Button } from "@/src/components/ui/Button";
import { ProgressBar } from "@/src/components/ui/ProgressBar";
import { useTheme } from "@/src/theme/ThemeContext";
import { getGroups } from "@/src/services/groups";
import { getLoans } from "@/src/services/loans";
import { getPenalties } from "@/src/services/penalties";
import { checkout } from "@/src/services/payments";
import { api } from "@/src/services/apiClient";
import { getCurrentUser } from "@/src/utils/currentUser";
import { detectNetwork } from "@/src/services/mobileMoney";
import { Group, Penalty, Loan, isProjectFundType } from "@/src/types";
import { formatZMW } from "@/src/utils/currency";
import {
  Check,
  ChevronDown,
  Receipt,
  Clock,
  Plus,
  PiggyBank,
  HandCoins,
  AlertTriangle,
  Lock,
} from "lucide-react-native";
import {
  MOBILE_MONEY_ON_HOLD,
  MOBILE_MONEY_HOLD_NOTE,
} from "@/src/constants";
import { useAsyncEffect } from "@/src/hooks/useAsyncEffect";

type Step = "entry" | "confirm" | "success";
type LoanMode = "installment" | "full" | "custom";

// This is the ONE payment screen for everything a member owes a group: the
// cycle savings, any active-loan repayments and any outstanding penalties, all
// settled in a SINGLE deposit (mobile money or cash). The obligations sum to
// the base amount; the member can raise the amount to add a top-up (extra
// savings) on top. See POST /payments/checkout + the "combined" settlement case.
export default function Contribute() {
  const { colors } = useTheme();
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();

  const [step, setStep] = useState<Step>("entry");
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsError, setGroupsError] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [showGroupPicker, setShowGroupPicker] = useState(false);

  // Project-fund groups (church): money is given TOWARD something, so the
  // payment names the project it belongs to. Nothing is owed and nothing is
  // scheduled — the member types whatever they are giving.
  const [projectId, setProjectId] = useState<string | null>(null);
  const [showProjectPicker, setShowProjectPicker] = useState(false);

  // Outstanding obligations for the SELECTED group. A member can owe in several
  // groups, but one deposit settles one group's dues.
  const [loans, setLoans] = useState<Loan[]>([]);
  const [penalties, setPenalties] = useState<Penalty[]>([]);
  // The group whose loans + penalties are currently held; drives the derived
  // loading flag below.
  const [obligationsFor, setObligationsFor] = useState<string | null>(null);
  // Per-loan chosen repayment: installment (default), full balance or custom.
  const [loanModes, setLoanModes] = useState<
    Record<string, { mode: LoanMode; custom: string }>
  >({});
  const [expandedLoanId, setExpandedLoanId] = useState<string | null>(null);

  // The grand total shown in the field = base (sum of obligations) + top-up.
  const [amount, setAmount] = useState("");
  const [payerPhone, setPayerPhone] = useState("");
  // Cash is the only way member money moves while mobile money is on hold, so
  // the toggle starts on and cannot be turned off — see MOBILE_MONEY_ON_HOLD.
  const [payCash, setPayCash] = useState(MOBILE_MONEY_ON_HOLD);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [serverTxn, setServerTxn] = useState<any>(null);

  // Server-computed fee breakdown for the confirm screen (mobile money only).
  const [pricing, setPricing] = useState<{
    base: number;
    platformFee: number;
    depositAmount: number;
    feesCovered: number;
    networkFee?: number;
  } | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [receiptId] = useState(() => `CHM-${Math.floor(Math.random() * 90000) + 10000}`);

  const load = useCallback(async () => {
    setGroupsLoading(true);
    setGroupsError(false);
    try {
      const [fetchedGroups, user] = await Promise.all([
        getGroups(),
        getCurrentUser<{ phone?: string }>(),
      ]);
      setGroups(fetchedGroups);
      const group =
        fetchedGroups.find((g) => g.id === groupId) ?? fetchedGroups[0] ?? null;
      setSelectedGroup(group);
      setPayerPhone(user?.phone ?? "");
    } catch {
      // Without this the empty list below would claim they have no groups when
      // the fetch is what actually failed.
      setGroupsError(true);
    } finally {
      setGroupsLoading(false);
    }
  }, [groupId]);

  useAsyncEffect(load);

  // Load the selected group's outstanding loans + penalties. Each loan starts on
  // its installment; each pending penalty is always included.
  useEffect(() => {
    const gid = selectedGroup?.id;
    if (!gid) return;
    let cancelled = false;
    Promise.all([
      getLoans({ mine: true, groupId: gid }).catch(() => [] as Loan[]),
      getPenalties({ mine: true, groupId: gid }).catch(() => [] as Penalty[]),
    ])
      .then(([fetchedLoans, fetchedPenalties]) => {
        if (cancelled) return;
        const repayable = fetchedLoans.filter(
          (l) =>
            ["active", "overdue"].includes(l.status as string) &&
            l.outstanding > 0
        );
        setLoans(repayable);
        setLoanModes(
          Object.fromEntries(
            repayable.map((l) => [l.id, { mode: "installment" as LoanMode, custom: "" }])
          )
        );
        setPenalties(fetchedPenalties.filter((p) => p.status === "pending"));
      })
      .finally(() => {
        if (!cancelled) setObligationsFor(gid);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedGroup?.id]);

  // Derived rather than stored, so the flag can never disagree with the data:
  // a group is picked and what we hold is not yet its obligations.
  const obligationsLoading =
    !!selectedGroup?.id && obligationsFor !== selectedGroup.id;

  // ── Project-fund groups ─────────────────────────────────────────────────────
  const isProjectFund = isProjectFundType(selectedGroup?.groupType);
  const openProjects = (selectedGroup?.projects ?? []).filter(
    (p) => p.status === "active"
  );
  // Derived, not stored: a selection left over from the group they switched
  // away from matches nothing here, and a lone open project needs no choosing.
  const selectedProject =
    openProjects.find((p) => p.id === projectId) ??
    (openProjects.length === 1 ? openProjects[0] : null);

  // ── Amounts ─────────────────────────────────────────────────────────────────
  // A project-fund group has no cycle amount: whatever they type IS the gift.
  const savingsAmount = isProjectFund ? 0 : selectedGroup?.contributionAmount ?? 0;

  const loanChosen = (l: Loan): number => {
    const m = loanModes[l.id] ?? { mode: "installment" as LoanMode, custom: "" };
    if (m.mode === "full") return l.outstanding;
    if (m.mode === "custom")
      return Math.min(Math.max(0, parseFloat(m.custom) || 0), l.outstanding);
    return Math.min(l.installmentAmount || 0, l.outstanding);
  };
  const loanModeLabel = (l: Loan): string => {
    const m = loanModes[l.id]?.mode ?? "installment";
    return m === "full" ? "Full balance" : m === "custom" ? "Custom amount" : "Installment";
  };

  const loanTotal = loans.reduce((sum, l) => sum + loanChosen(l), 0);
  const penaltyTotal = penalties.reduce((sum, p) => sum + p.amount, 0);
  const base = savingsAmount + loanTotal + penaltyTotal;

  const num = parseFloat(amount.replace(/,/g, "")) || 0;
  const topup = Math.max(0, num - base);

  // Keep the field in sync with the base as obligations change (loan mode,
  // penalties loading, group switch), PRESERVING any top-up the member added.
  const prevBaseRef = useRef(0);
  useEffect(() => {
    const prevBase = prevBaseRef.current;
    const cur = parseFloat(amount.replace(/,/g, "")) || 0;
    const preservedTopup = Math.max(0, cur - prevBase);
    const next = base + preservedTopup;
    setAmount(next > 0 ? String(next) : "");
    prevBaseRef.current = base;
    // Deliberately keyed on `base` only — typing changes `amount` without base.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const setLoanMode = (loanId: string, mode: LoanMode) =>
    setLoanModes((prev) => ({
      ...prev,
      [loanId]: { mode, custom: prev[loanId]?.custom ?? "" },
    }));
  const setLoanCustom = (loanId: string, custom: string) => {
    const cleaned = custom.replace(/[^0-9.]/g, "");
    setLoanModes((prev) => ({
      ...prev,
      [loanId]: { mode: "custom", custom: cleaned },
    }));
  };

  const detectedNetwork = detectNetwork(payerPhone).network;
  const paymentMethodLabel = payCash ? "Cash" : detectedNetwork;
  const networkUnknown = !payCash && detectedNetwork === "Unknown";

  const handleAmountChange = (text: string) => {
    const cleaned = text.replace(/[^0-9.]/g, "");
    const parts = cleaned.split(".");
    if (parts.length > 2) return;
    if (parts[1] !== undefined && parts[1].length > 2) return;
    setAmount(cleaned);
    if (submitAttempted && parseFloat(cleaned) >= base) setSubmitAttempted(false);
    if (pricingError) setPricingError(null);
  };

  // A loan in custom mode with no/zero amount would be an invalid obligation.
  const invalidLoan = loans.some((l) => loanChosen(l) <= 0);
  const belowBase = base > 0 && num > 0 && num < base;
  // Nothing is given into an untagged pool: the API refuses a project-fund
  // payment with no project, so the screen refuses it first.
  const missingProject = isProjectFund && !selectedProject;
  const displayError =
    submitAttempted && num <= 0
      ? "Enter an amount to pay"
      : belowBase
        ? `Minimum ${formatZMW(base)}: this covers your dues`
        : invalidLoan
          ? "Enter an amount for each loan"
          : submitAttempted && missingProject
            ? "Choose what you're giving toward"
            : "";

  // The savings leg the API is sent. A project-fund gift is the whole amount as
  // a contribution — there is no cycle due for it to be a "top-up" above.
  const savingsLeg = isProjectFund
    ? { contribution: num, topup: 0 }
    : { contribution: savingsAmount, topup };

  const repaymentsPayload = () =>
    loans
      .map((l) => ({ loanId: l.id, amount: loanChosen(l) }))
      .filter((r) => r.amount > 0);

  // Review → Confirm. Cash is collected at face value (no gross-up), so there
  // is no fee preview to fetch — mirror how the treasurer-confirmed cash path
  // priced nothing. Mobile money fetches the real server breakdown first.
  const goToConfirm = async () => {
    if (num <= 0 || belowBase || invalidLoan || missingProject) {
      setSubmitAttempted(true);
      return;
    }
    if (payCash) {
      setPricing(null);
      setStep("confirm");
      return;
    }
    setPricingLoading(true);
    setPricingError(null);
    try {
      const res = await api<{
        base: number;
        platformFee: number;
        depositAmount: number;
        feesCovered: number;
        networkFee?: number;
      }>("/pricing/preview", {
        method: "POST",
        body: { kind: "contribution", amount: num },
      });
      setPricing(res);
      setStep("confirm");
    } catch (e: any) {
      setPricingError(e?.message || "Couldn't load fees. Please try again.");
    } finally {
      setPricingLoading(false);
    }
  };

  if (groupsLoading || !selectedGroup) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
        <ScreenHeader title="Make Payment" />
        {groupsLoading ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : groupsError ? (
          <ErrorState onRetry={load} />
        ) : (
          <NoGroupState
            message="Savings go into a group's fund, so there is nowhere to send this yet. Join a group or start your own, then come back."
            testID="contribute-no-group"
          />
        )}
      </SafeAreaView>
    );
  }

  if (step === "success") {
    return (
      <SuccessScreen
        amount={num}
        group={selectedGroup.name}
        colors={colors}
        router={router}
        receiptId={serverTxn?.receiptId ?? receiptId}
        status={serverTxn?.status ?? "completed"}
        isCash={payCash}
      />
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
      testID="contribute-screen"
    >
      <ScreenHeader
        title={step === "entry" ? "Make Payment" : "Confirm payment"}
        onBack={step === "confirm" ? () => setStep("entry") : undefined}
      />
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView contentContainerStyle={styles.content}>
            {step === "entry" ? (
              <>
                <Text style={[styles.label, { color: colors.textMuted }]}>Amount</Text>
                <View
                  style={[
                    styles.amountWrap,
                    {
                      backgroundColor: colors.surface,
                      borderColor: displayError ? colors.danger : colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.currency, { color: colors.primary }]}>K</Text>
                  <TextInput
                    style={[styles.amountInput, { color: colors.textMain }]}
                    value={amount}
                    onChangeText={handleAmountChange}
                    keyboardType={Platform.OS === "ios" ? "decimal-pad" : "numeric"}
                    placeholder="0"
                    placeholderTextColor={colors.textMuted}
                    editable={!submitting}
                    testID="contribute-amount-input"
                  />
                </View>
                {isProjectFund ? (
                  <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 6 }}>
                    Give whatever you choose — there is no set amount in {selectedGroup.name}.
                  </Text>
                ) : base > 0 ? (
                  <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 6 }}>
                    Dues total {formatZMW(base)}
                    {topup > 0 ? ` · +${formatZMW(topup)} top-up` : " · raise to add a top-up"}
                  </Text>
                ) : null}
                {displayError ? (
                  <Text style={[styles.errText, { color: colors.danger }]}>{displayError}</Text>
                ) : null}

                {/* Giving toward — project-fund groups pick a project instead
                    of settling a list of dues. */}
                {isProjectFund && (
                  <>
                    <Text style={[styles.label, { color: colors.textMuted, marginTop: 22 }]}>
                      Giving toward
                    </Text>
                    {openProjects.length === 0 ? (
                      <Card padding={16}>
                        <Text style={{ color: colors.textMuted, fontSize: 13, lineHeight: 20 }}>
                          {selectedGroup.name} has no open projects right now. The Chairperson
                          adds them from the group screen.
                        </Text>
                      </Card>
                    ) : (
                      <>
                        <Picker
                          label="Project"
                          value={selectedProject?.name ?? "Choose a project"}
                          onPress={() => setShowProjectPicker((s) => !s)}
                          colors={colors}
                          testID="contribute-project-picker"
                        />
                        {showProjectPicker && (
                          <Card padding={4} style={{ marginTop: 8 }}>
                            {openProjects.map((p) => (
                              <Pressable
                                key={p.id}
                                onPress={() => {
                                  setProjectId(p.id);
                                  setShowProjectPicker(false);
                                  setSubmitAttempted(false);
                                }}
                                style={({ pressed }) => [
                                  styles.option,
                                  { backgroundColor: pressed ? colors.surfaceSecondary : "transparent" },
                                ]}
                                testID={`contribute-project-${p.id}`}
                              >
                                <View style={{ flex: 1 }}>
                                  <Text style={{ color: colors.textMain, fontWeight: "500" }}>
                                    {p.name}
                                  </Text>
                                  <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                                    {formatZMW(p.collected)} raised
                                    {p.targetAmount ? ` of ${formatZMW(p.targetAmount)}` : ""}
                                  </Text>
                                </View>
                                {p.id === selectedProject?.id && (
                                  <Check size={18} color={colors.primary} />
                                )}
                              </Pressable>
                            ))}
                          </Card>
                        )}
                        {selectedProject?.targetAmount ? (
                          <View style={{ marginTop: 12 }}>
                            <ProgressBar
                              progress={Math.min(
                                1,
                                selectedProject.collected / selectedProject.targetAmount
                              )}
                            />
                            <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 8 }}>
                              {formatZMW(selectedProject.collected)} of{" "}
                              {formatZMW(selectedProject.targetAmount)} raised
                            </Text>
                          </View>
                        ) : null}
                      </>
                    )}
                  </>
                )}

                {/* What you're paying */}
                {!isProjectFund && (
                <Text style={[styles.label, { color: colors.textMuted, marginTop: 22 }]}>
                  What you&apos;re paying
                </Text>
                )}
                {isProjectFund ? null : obligationsLoading ? (
                  <Card padding={16}>
                    <ActivityIndicator color={colors.primary} />
                  </Card>
                ) : (
                  <Card padding={4} testID="contribute-obligations">
                    {/* Group saving (cycle) */}
                    {savingsAmount > 0 && (
                      <ObligationRow
                        icon={<PiggyBank size={18} color={colors.primary} />}
                        title="Group saving"
                        sub="This cycle"
                        value={formatZMW(savingsAmount)}
                        colors={colors}
                      />
                    )}

                    {/* Loan repayments — tap to adjust installment / full / custom */}
                    {loans.map((l) => {
                      const expanded = expandedLoanId === l.id;
                      const mode = loanModes[l.id]?.mode ?? "installment";
                      return (
                        <View key={l.id}>
                          <Pressable
                            onPress={() => setExpandedLoanId(expanded ? null : l.id)}
                            testID={`contribute-loan-${l.id}`}
                            style={({ pressed }) => [
                              styles.obRow,
                              { backgroundColor: pressed ? colors.surfaceSecondary : "transparent" },
                            ]}
                          >
                            <View style={[styles.obIcon, { backgroundColor: colors.primarySoft }]}>
                              <HandCoins size={18} color={colors.primary} />
                            </View>
                            <View style={{ flex: 1, marginLeft: 12 }}>
                              <Text style={{ color: colors.textMain, fontWeight: "600", fontSize: 14 }}>
                                Loan repayment
                              </Text>
                              <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                                {loanModeLabel(l)} · {formatZMW(l.outstanding)} left
                              </Text>
                            </View>
                            <Text style={{ color: colors.textMain, fontWeight: "700", fontSize: 14, marginRight: 6 }}>
                              {formatZMW(loanChosen(l))}
                            </Text>
                            <ChevronDown
                              size={18}
                              color={colors.textMuted}
                              style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
                            />
                          </Pressable>
                          {expanded && (
                            <View style={{ paddingHorizontal: 8, paddingBottom: 8 }}>
                              <LoanModeOption
                                label="Installment"
                                sub={formatZMW(Math.min(l.installmentAmount || 0, l.outstanding))}
                                active={mode === "installment"}
                                onPress={() => setLoanMode(l.id, "installment")}
                                colors={colors}
                                testID={`contribute-loan-${l.id}-installment`}
                              />
                              <LoanModeOption
                                label="Full balance"
                                sub={formatZMW(l.outstanding)}
                                active={mode === "full"}
                                onPress={() => setLoanMode(l.id, "full")}
                                colors={colors}
                                testID={`contribute-loan-${l.id}-full`}
                              />
                              <LoanModeOption
                                label="Custom amount"
                                active={mode === "custom"}
                                onPress={() => setLoanMode(l.id, "custom")}
                                colors={colors}
                                testID={`contribute-loan-${l.id}-custom`}
                                right={
                                  <View
                                    style={[
                                      styles.customInputWrap,
                                      { borderColor: colors.border, backgroundColor: colors.surface },
                                    ]}
                                  >
                                    <Text style={{ color: colors.primary, fontWeight: "700" }}>K</Text>
                                    <TextInput
                                      style={{ minWidth: 56, color: colors.textMain, fontWeight: "700", padding: 0, marginLeft: 4 }}
                                      value={loanModes[l.id]?.custom ?? ""}
                                      onChangeText={(t) => setLoanCustom(l.id, t)}
                                      onFocus={() => setLoanMode(l.id, "custom")}
                                      keyboardType={Platform.OS === "ios" ? "decimal-pad" : "numeric"}
                                      placeholder="0"
                                      placeholderTextColor={colors.textMuted}
                                      testID={`contribute-loan-${l.id}-custom-input`}
                                    />
                                  </View>
                                }
                              />
                            </View>
                          )}
                        </View>
                      );
                    })}

                    {/* Penalties — every pending one is included */}
                    {penalties.map((p) => (
                      <ObligationRow
                        key={p.id}
                        testID={`contribute-penalty-${p.id}`}
                        icon={<AlertTriangle size={18} color={colors.warning} />}
                        iconBg={colors.warning + "22"}
                        title={p.reason}
                        sub={new Date(p.createdAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                        value={formatZMW(p.amount)}
                        colors={colors}
                      />
                    ))}

                    {/* Top-up appears once the member raises the amount */}
                    {topup > 0 && (
                      <ObligationRow
                        icon={<Plus size={18} color={colors.primary} />}
                        title="Top-up"
                        sub="Extra savings"
                        value={formatZMW(topup)}
                        colors={colors}
                      />
                    )}

                    {base === 0 && penalties.length === 0 && loans.length === 0 && (
                      <View style={{ padding: 14 }}>
                        <Text style={{ color: colors.textMuted, fontSize: 13, textAlign: "center" }}>
                          No outstanding dues in {selectedGroup.name}. You can still add extra
                          savings above.
                        </Text>
                      </View>
                    )}

                    <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
                      <Text style={{ color: colors.textMuted, fontSize: 13, fontWeight: "600" }}>
                        Total
                      </Text>
                      <Text style={{ color: colors.textMain, fontWeight: "800", fontSize: 16 }}>
                        {formatZMW(num)}
                      </Text>
                    </View>
                  </Card>
                )}

                {/* Group picker */}
                <Picker
                  label="Group"
                  value={selectedGroup.name}
                  onPress={() => setShowGroupPicker((s) => !s)}
                  colors={colors}
                  testID="contribute-group-picker"
                />
                {showGroupPicker && (
                  <Card padding={4} style={{ marginTop: 8 }}>
                    {groups.map((g) => (
                      <Pressable
                        key={g.id}
                        onPress={() => {
                          setSelectedGroup(g);
                          // Obligations belong to a group — a switch invalidates
                          // them; reset and let them reload + reprice the base.
                          setLoans([]);
                          setPenalties([]);
                          setLoanModes({});
                          setExpandedLoanId(null);
                          setAmount("");
                          setSubmitAttempted(false);
                          setShowGroupPicker(false);
                          setShowProjectPicker(false);
                          setProjectId(null);
                        }}
                        style={({ pressed }) => [
                          styles.option,
                          { backgroundColor: pressed ? colors.surfaceSecondary : "transparent" },
                        ]}
                      >
                        <Text style={{ color: colors.textMain, fontWeight: "500" }}>{g.name}</Text>
                        {g.id === selectedGroup.id && <Check size={18} color={colors.primary} />}
                      </Pressable>
                    ))}
                  </Card>
                )}

                {/* Payment method (auto-detected) */}
                <View
                  style={[
                    styles.picker,
                    { backgroundColor: colors.surfaceSecondary, borderColor: networkUnknown ? colors.danger : colors.border },
                  ]}
                  testID="contribute-payment-detected"
                >
                  <View>
                    <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: "600", letterSpacing: 0.3 }}>
                      FROM
                    </Text>
                    <Text style={{ color: networkUnknown ? colors.danger : colors.textMain, fontSize: 15, fontWeight: "600", marginTop: 4 }}>
                      {payCash ? "Cash" : detectedNetwork}
                    </Text>
                  </View>
                </View>
                {networkUnknown && (
                  <Text style={[styles.errText, { color: colors.danger }]}>
                    We couldn&apos;t detect a mobile money network from your phone number. Update
                    your profile number to an MTN, Airtel or Zamtel line, or pay with cash.
                  </Text>
                )}

                {/* Cash toggle — applies to the whole payment. Locked on while
                    mobile money is held: there is no other way to pay. */}
                <View style={[styles.picker, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ color: colors.textMain, fontSize: 15, fontWeight: "600" }}>Pay with cash</Text>
                      {MOBILE_MONEY_ON_HOLD ? <Lock size={13} color={colors.textMuted} /> : null}
                    </View>
                    <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                      {MOBILE_MONEY_ON_HOLD
                        ? MOBILE_MONEY_HOLD_NOTE
                        : "Recorded by an admin, no mobile money charge"}
                    </Text>
                  </View>
                  <Switch
                    value={payCash}
                    onValueChange={setPayCash}
                    disabled={MOBILE_MONEY_ON_HOLD}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    testID="contribute-cash-toggle"
                  />
                </View>

                {/* Cycle progress — a project-fund group has no cycle to be
                    partway through; its progress is per project, shown above. */}
                {!isProjectFund && (
                <View style={{ marginTop: 20 }}>
                  <Card padding={16}>
                    <View style={styles.rowBetween}>
                      <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: "600", letterSpacing: 0.4 }}>
                        THIS CYCLE
                      </Text>
                      <Text style={{ color: colors.textMain, fontWeight: "700", fontSize: 13 }}>
                        {Math.round(selectedGroup.cycleProgress * 100)}%
                      </Text>
                    </View>
                    <View style={{ marginTop: 10 }}>
                      <ProgressBar progress={selectedGroup.cycleProgress} />
                    </View>
                    <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 8 }}>
                      {formatZMW(selectedGroup.totalSavings)} saved of cycle goal
                    </Text>
                  </Card>
                </View>
                )}

                <View style={{ flex: 1, minHeight: 24 }} />
                {pricingError ? (
                  <Text style={[styles.errText, { color: colors.danger, marginBottom: 10 }]}>
                    {pricingError}
                  </Text>
                ) : null}
                <Button
                  label="Review"
                  loading={pricingLoading}
                  disabled={
                    num <= 0 ||
                    belowBase ||
                    invalidLoan ||
                    missingProject ||
                    networkUnknown ||
                    pricingLoading ||
                    obligationsLoading
                  }
                  onPress={goToConfirm}
                  testID="contribute-review-btn"
                />
              </>
            ) : (
              <>
                <Card padding={20}>
                  <Text style={[styles.confirmLabel, { color: colors.textMuted }]}>Total</Text>
                  <Text style={[styles.confirmAmount, { color: colors.textMain }]}>
                    {formatZMW(payCash ? num : pricing?.depositAmount ?? num)}
                  </Text>
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />

                  {isProjectFund && selectedProject && (
                    <ConfirmRow
                      label={`Giving toward ${selectedProject.name}`}
                      value={formatZMW(num)}
                      colors={colors}
                    />
                  )}
                  {savingsAmount > 0 && (
                    <ConfirmRow label="Group saving" value={formatZMW(savingsAmount)} colors={colors} />
                  )}
                  {loans.map((l) => (
                    <ConfirmRow
                      key={l.id}
                      label={`Loan repayment (${loanModeLabel(l).toLowerCase()})`}
                      value={formatZMW(loanChosen(l))}
                      colors={colors}
                    />
                  ))}
                  {penalties.map((p) => (
                    <ConfirmRow key={p.id} label={p.reason} value={formatZMW(p.amount)} colors={colors} />
                  ))}
                  {!isProjectFund && topup > 0 && (
                    <ConfirmRow label="Top-up (extra savings)" value={formatZMW(topup)} colors={colors} />
                  )}
                  {!payCash && (
                    <ConfirmRow
                      label="Transaction fees"
                      value={formatZMW((pricing?.feesCovered ?? 0) + (pricing?.platformFee ?? 0))}
                      colors={colors}
                    />
                  )}
                  {!payCash && (pricing?.networkFee ?? 0) > 0 && (
                    <ConfirmRow
                      label="Your network fee"
                      value={formatZMW(pricing?.networkFee ?? 0)}
                      colors={colors}
                    />
                  )}
                  <ConfirmRow label="Group" value={selectedGroup.name} colors={colors} />
                  <ConfirmRow label="From" value={paymentMethodLabel} colors={colors} last />
                </Card>

                {!payCash && (pricing?.networkFee ?? 0) > 0 ? (
                  <Text style={[styles.confirmLabel, { color: colors.textMuted, marginTop: 8 }]}>
                    Your mobile network charges an extra {formatZMW(pricing?.networkFee ?? 0)} to send
                    this, deducted from your wallet separately. It doesn&apos;t go to the group or Chuma.
                  </Text>
                ) : null}

                {submitError ? (
                  <Text style={[styles.errText, { color: colors.danger, marginTop: 12 }]}>{submitError}</Text>
                ) : null}

                <View style={{ flex: 1, minHeight: 24 }} />
                <Button
                  label="Confirm & pay"
                  loading={submitting}
                  disabled={submitting}
                  onPress={async () => {
                    if (networkUnknown) {
                      setSubmitError(
                        "No mobile money network detected for your number. Update your profile or pay with cash."
                      );
                      return;
                    }
                    setSubmitting(true);
                    setSubmitError("");
                    try {
                      const res = await checkout({
                        groupId: selectedGroup.id,
                        contribution: savingsLeg.contribution,
                        topup: savingsLeg.topup,
                        repayments: repaymentsPayload(),
                        penaltyIds: penalties.map((p) => p.id),
                        projectId: selectedProject?.id,
                        paymentMethod: paymentMethodLabel,
                        payerPhone,
                      });
                      setServerTxn(res.transaction);
                      setStep("success");
                    } catch (e: any) {
                      setSubmitError(e?.message || "Payment failed. Please try again.");
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                  testID="contribute-confirm-btn"
                />
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

const ObligationRow = ({
  icon,
  iconBg,
  title,
  sub,
  value,
  colors,
  testID,
}: {
  icon: React.ReactNode;
  iconBg?: string;
  title: string;
  sub?: string;
  value: string;
  colors: ReturnType<typeof useTheme>["colors"];
  testID?: string;
}) => (
  <View style={styles.obRow} testID={testID}>
    <View style={[styles.obIcon, { backgroundColor: iconBg ?? colors.primarySoft }]}>{icon}</View>
    <View style={{ flex: 1, marginLeft: 12 }}>
      <Text style={{ color: colors.textMain, fontWeight: "600", fontSize: 14 }}>{title}</Text>
      {sub ? (
        <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>{sub}</Text>
      ) : null}
    </View>
    <Text style={{ color: colors.textMain, fontWeight: "700", fontSize: 14 }}>{value}</Text>
  </View>
);

const LoanModeOption = ({
  label,
  sub,
  active,
  onPress,
  colors,
  right,
  testID,
}: {
  label: string;
  sub?: string;
  active: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>["colors"];
  right?: React.ReactNode;
  testID?: string;
}) => (
  <Pressable
    onPress={onPress}
    testID={testID}
    style={({ pressed }) => [
      styles.modeRow,
      { backgroundColor: active ? colors.primarySoft : "transparent", opacity: pressed ? 0.85 : 1 },
    ]}
  >
    <View
      style={[
        styles.radio,
        { borderColor: active ? colors.primary : colors.borderStrong, backgroundColor: active ? colors.primary : "transparent" },
      ]}
    >
      {active && <View style={styles.radioDot} />}
    </View>
    <View style={{ flex: 1, marginLeft: 12 }}>
      <Text style={{ color: colors.textMain, fontWeight: "600", fontSize: 14 }}>{label}</Text>
      {sub ? <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>{sub}</Text> : null}
    </View>
    {right}
  </Pressable>
);

const Picker = ({
  label,
  value,
  onPress,
  colors,
  testID,
}: {
  label: string;
  value: string;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>["colors"];
  testID?: string;
}) => (
  <Pressable
    onPress={onPress}
    testID={testID}
    style={({ pressed }) => [
      styles.picker,
      { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
    ]}
  >
    <View>
      <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: "600", letterSpacing: 0.3 }}>
        {label.toUpperCase()}
      </Text>
      <Text style={{ color: colors.textMain, fontSize: 15, fontWeight: "600", marginTop: 4 }}>
        {value}
      </Text>
    </View>
    <ChevronDown size={20} color={colors.textMuted} />
  </Pressable>
);

const ConfirmRow = ({
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
    style={[styles.confirmRow, !last && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
  >
    <Text style={{ color: colors.textMuted, fontSize: 13, flex: 1, paddingRight: 12 }}>{label}</Text>
    <Text style={{ color: colors.textMain, fontSize: 14, fontWeight: "600" }}>{value}</Text>
  </View>
);

const SuccessScreen = ({
  amount,
  group,
  colors,
  router,
  receiptId,
  status,
  isCash,
}: {
  amount: number;
  group: string;
  colors: ReturnType<typeof useTheme>["colors"];
  router: ReturnType<typeof useRouter>;
  receiptId: string;
  status: "completed" | "pending" | string;
  isCash: boolean;
}) => {
  const pending = status === "pending";
  const title = !pending
    ? "Payment received"
    : isCash
      ? "Awaiting treasurer confirmation"
      : "Payment processing";
  const message = !pending
    ? `Your payment of ${formatZMW(amount)} to ${group} has been recorded and your account updated.`
    : isCash
      ? `Your ${formatZMW(amount)} cash payment to ${group} has been recorded. It will be applied once the treasurer confirms receiving the cash.`
      : `Approve the ${formatZMW(amount)} payment on your phone. Your dues in ${group} will be settled as soon as it's confirmed, usually within seconds.`;
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
      testID="contribute-success"
    >
      <View style={styles.successWrap}>
        <View style={[styles.successCircle, { backgroundColor: pending ? colors.warning : colors.primary }]}>
          {pending ? (
            <Clock size={56} color="#fff" strokeWidth={2.5} />
          ) : (
            <Check size={56} color="#fff" strokeWidth={3} />
          )}
        </View>
        <Text
          style={{
            color: colors.textMain,
            fontSize: 24,
            fontWeight: "700",
            letterSpacing: -0.4,
            textAlign: "center",
            paddingHorizontal: 24,
          }}
        >
          {title}
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
          {message}
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
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>Total paid</Text>
            <Text style={{ color: colors.textMain, fontSize: 20, fontWeight: "700", marginTop: 4 }}>
              {formatZMW(amount)}
            </Text>
          </Card>
        </View>

        <View style={{ flex: 1 }} />

        <View style={{ width: "100%", paddingHorizontal: 24 }}>
          <Button
            label="View & share receipt"
            onPress={() =>
              router.replace({
                pathname: "/receipt",
                params: {
                  amount: String(amount),
                  type: "contribution",
                  group,
                  date: new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }),
                  note: "Combined payment",
                  status,
                  direction: "out",
                  txnId: receiptId,
                },
              })
            }
            testID="contribute-receipt-btn"
          />
          <View style={{ height: 10 }} />
          <Button label="Done" variant="ghost" onPress={() => router.replace("/(tabs)")} testID="contribute-done-btn" />
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 20 },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2, marginBottom: 8 },
  amountWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 24,
    paddingHorizontal: 24,
    gap: 12,
  },
  currency: { fontSize: 28, fontWeight: "700" },
  amountInput: { flex: 1, fontSize: 44, fontWeight: "700", letterSpacing: -1, padding: 0 },
  errText: { fontSize: 12, marginTop: 8, fontWeight: "500" },
  obRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 12,
  },
  obIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    marginHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 6,
    marginTop: 2,
  },
  modeRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    marginVertical: 2,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  customInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  picker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 14,
    marginTop: 18,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 12,
  },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  confirmLabel: { fontSize: 12, fontWeight: "600", letterSpacing: 0.3 },
  confirmAmount: { fontSize: 36, fontWeight: "700", letterSpacing: -0.6, marginTop: 4 },
  divider: { height: 1, marginVertical: 14 },
  confirmRow: { paddingVertical: 12, flexDirection: "row", justifyContent: "space-between" },
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
