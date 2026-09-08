import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Platform,
  Image,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Contacts from "expo-contacts";
import { ScreenHeader } from "@/src/components/common/ScreenHeader";
import { Card } from "@/src/components/ui/Card";
import { Button } from "@/src/components/ui/Button";
import { useTheme } from "@/src/theme/ThemeContext";
import { createGroup, inviteMember } from "@/src/services/groups";
import { defaultTiersForCycle, tierBandLabel } from "@/src/services/loans";
import { getCurrentUser } from "@/src/utils/currentUser";
import { detectNetwork } from "@/src/services/mobileMoney";
import { formatZMW } from "@/src/utils/currency";
import { Check, Camera, X, CreditCard, Contact } from "lucide-react-native";
import Slider from "@react-native-community/slider";
import type { GroupType, GroupConstitution, LoanRepaymentTier } from "@/src/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 7;

const STEP_TITLES = [
  "Group basics",
  "Contribution setup",
  "Loan rules",
  "Governance",
  "Review & confirm",
  "Payment",
];

const GROUP_TYPES: { label: string; value: GroupType }[] = [
  { label: "Savings Group", value: "savings-group" },
  { label: "Cooperative", value: "cooperative" },
  { label: "Women's Group", value: "womens-group" },
  { label: "Church Group", value: "church-group" },
  { label: "Investment Group", value: "investment-group" },
];

// Types that pool contributions without lending them back out. The loan-rules
// step is skipped for these and the constitution is saved with lending off, so
// the API refuses loan requests against the group (loan.routes.js).
const SAVINGS_ONLY_TYPES: GroupType[] = ["church-group"];

const lendsToMembers = (t: GroupType | "") => !!t && !SAVINGS_ONLY_TYPES.includes(t);

const CONTRIB_FREQS = ["Weekly", "Bi-weekly", "Monthly"];
const CYCLE_DURATIONS = ["3 months", "6 months", "12 months"];
const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const LOAN_MULTIPLIERS = [
  { label: "1×", value: "1" },
  { label: "2×", value: "2" },
  { label: "3×", value: "3" },
  { label: "5×", value: "5" },
];

const APPROVAL_THRESHOLDS: { label: string; value: GroupConstitution["approvalThreshold"] }[] = [
  { label: "2 of 3 admins", value: "2-of-3" },
  { label: "Majority", value: "majority" },
  { label: "All admins", value: "all" },
];

const PERMISSION_ITEMS: { key: keyof Permissions; label: string }[] = [
  { key: "loanApprovals", label: "Loan approvals" },
  { key: "withdrawals", label: "Withdrawals" },
  { key: "ruleChanges", label: "Rule changes" },
  { key: "memberRemovals", label: "Member removals" },
  { key: "shareOutApprovals", label: "Share-out approvals" },
];

interface Permissions {
  loanApprovals: boolean;
  withdrawals: boolean;
  ruleChanges: boolean;
  memberRemovals: boolean;
  shareOutApprovals: boolean;
}

interface Invite {
  id: string;
  contact: string;
  status: "Pending" | "Accepted";
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CreateGroup() {
  const { colors } = useTheme();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const scrollRef = useRef<ScrollView>(null);

  // Step 1 — Group Basics
  const [groupName, setGroupName] = useState("");
  const [groupType, setGroupType] = useState<GroupType | "">("");
  const [groupDesc, setGroupDesc] = useState("");
  const [groupAvatar, setGroupAvatar] = useState<string | null>(null);

  // Step 2 — Contribution Setup
  const [contribFreq, setContribFreq] = useState("Monthly");
  const [contribAmount, setContribAmount] = useState("");
  const [cycleDuration, setCycleDuration] = useState("6 months");
  const [deadlineDay, setDeadlineDay] = useState("1");
  const [deadlineDow, setDeadlineDow] = useState("Mon");
  const [lateContribEnabled, setLateContribEnabled] = useState(false);
  const [lateContributionPenaltyRate, setLateContributionPenaltyRate] = useState("1");

  // Step 3 — Loan Rules
  const [internalLending, setInternalLending] = useState(true);
  const [loanMultiplier, setLoanMultiplier] = useState("2");
  const [loanInterest, setLoanInterest] = useState("5");
  // Size-based repayment tiers: bigger loans get longer terms. Amount bands are
  // fixed; the group tunes the max term per band.
  const [repaymentTiers, setRepaymentTiers] = useState<LoanRepaymentTier[]>(
    () => defaultTiersForCycle(6)
  );
  // Stop issuing new loans within this many months of share-out so every loan
  // clears before the cycle closes (VSLA norm is 1–2 months).
  const [loanFreeWindow, setLoanFreeWindow] = useState(1);
  const [gracePeriod, setGracePeriod] = useState("0");
  const [lateRepayEnabled, setLateRepayEnabled] = useState(false);
  const [lateRepaymentPenaltyRate, setLateRepaymentPenaltyRate] = useState("1");

  const [lateContribPenaltyType, setLateContribPenaltyType] = useState<"flat" | "percent">("percent");
  const [lateContribFlatAmount, setLateContribFlatAmount] = useState("20");
  const [lateRepayPenaltyType, setLateRepayPenaltyType] = useState<"flat" | "percent">("percent");
  const [lateRepayFlatAmount, setLateRepayFlatAmount] = useState("100");

  // Step 4 — Governance
  const [treasurerPhone, setTreasurerPhone] = useState("");
  const [secretaryPhone, setSecretaryPhone] = useState("");
  const [approvalThreshold, setApprovalThreshold] = useState<GroupConstitution["approvalThreshold"]>("majority");
  const [permissions, setPermissions] = useState<Permissions>({
    loanApprovals: true,
    withdrawals: true,
    ruleChanges: true,
    memberRemovals: true,
    shareOutApprovals: true,
  });

  // Post-creation invite state (used on invite screen after success)
  const [phoneInput, setPhoneInput] = useState("");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");

  // Step 5 — Review
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Step 6 — Payment
  const [payerPhone, setPayerPhone] = useState("");
  const [paying, setPaying] = useState(false);

  // new group id after creation
  const [newGroupId, setNewGroupId] = useState("");

  //  Helpers 

  const toNum = (s: string) => parseFloat(s) || 0;
  const parseMonths = (s: string) => parseInt(s.split(" ")[0]) || 6;

  // Re-baseline loan repayment tiers whenever the cycle length changes, so the
  // defaults always fit the cycle (a longer cycle allows longer loans). Skips
  // the first render so it doesn't overwrite a user's edits on mount.
  const cycleMonths = parseMonths(cycleDuration);
  const didMountCycleRef = useRef(false);
  useEffect(() => {
    if (!didMountCycleRef.current) {
      didMountCycleRef.current = true;
      return;
    }
    setRepaymentTiers(defaultTiersForCycle(cycleMonths));
  }, [cycleMonths]);

  // Guards direct navigation (deep link) into a 6-step wizard that would only
  // 403 at the payment step — the Groups + button already checks this first.
  useEffect(() => {
    (async () => {
      const user = await getCurrentUser<{ kyc?: { status?: string }; phone?: string }>();
      if (user?.kyc?.status !== "verified") {
        router.replace("/kyc?return=create-group" as never);
        return;
      }
      // The fee is always charged to the registered number, so the payment step
      // shows that wallet instead of asking them to pick one.
      setPayerPhone(user?.phone ?? "");
    })();
  }, [router]);

  // The wizard reuses a single ScrollView across all steps, so advancing while
  // scrolled down (e.g. the long loan-rules step) would carry that offset into
  // the next step and open it pre-scrolled. Reset to the top on every step change.
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [step]);

  const handleNumericInput = (text: string, setter: (v: string) => void) => {
    const cleaned = text.replace(/[^0-9.]/g, "");
    const parts = cleaned.split(".");
    if (parts.length > 2) return;
    if (parts[1] !== undefined && parts[1].length > 2) return;
    setter(cleaned);
  };

  const handleIntInput = (text: string, setter: (v: string) => void, max?: number) => {
    const cleaned = text.replace(/[^0-9]/g, "");
    if (max !== undefined && cleaned !== "" && parseInt(cleaned) > max) return;
    setter(cleaned);
  };


  const isValidZambianPhone = (s: string) => /^\d{9}$/.test(s.replace(/\s/g, ""));

  const handlePhoneInput = (text: string, setter: (v: string) => void) =>
    setter(text.replace(/\D/g, "").slice(0, 9));

  // Strip a contact's number down to the 9-digit local part the inputs expect,
  // dropping any +260 country code / leading 0 the contact may carry.
  const toLocalZambian = (raw: string): string => {
    let d = raw.replace(/\D/g, "");
    if (d.startsWith("00")) d = d.slice(2);
    if (d.startsWith("260")) d = d.slice(3);
    else if (d.startsWith("0")) d = d.slice(1);
    return d.slice(0, 9);
  };

  // Pick the best number off a contact: prefer one that normalises to a valid
  // 9-digit Zambian number, else fall back to the first one listed.
  const bestLocalNumber = (nums?: Contacts.PhoneNumber[]): string | null => {
    if (!nums || nums.length === 0) return null;
    const candidates = nums.map((n) => toLocalZambian(n.number || n.digits || ""));
    return candidates.find(isValidZambianPhone) || candidates[0] || null;
  };

  // Open the OS contact picker and fill a phone field from the chosen contact.
  // (Not available on web — the button is hidden there.) On Android the module
  // re-queries the picked contact via ContactsContract, which needs READ_CONTACTS,
  // so the picker crashes on selection without it; request first. iOS's system
  // picker hands the contact back directly and needs no permission.
  const pickContact = async (setter: (v: string) => void, errKey: string) => {
    try {
      if (Platform.OS === "android") {
        const { status } = await Contacts.requestPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(
            "Contacts access needed",
            "Allow Chuma to read your contacts to pick a number, or type it in manually."
          );
          return;
        }
      }
      const contact = await Contacts.presentContactPickerAsync();
      if (!contact) return; // user cancelled
      const local = bestLocalNumber(contact.phoneNumbers);
      if (!local) {
        Alert.alert("No phone number", `${contact.name || "That contact"} has no phone number saved.`);
        return;
      }
      setter(local);
      if (isValidZambianPhone(local)) {
        clearErr(errKey);
      } else {
        setErrors((prev) => ({ ...prev, [errKey]: "That contact isn't a valid Zambian number. Check it" }));
      }
    } catch (e: any) {
      Alert.alert("Couldn't open contacts", e?.message || "Please try again.");
    }
  };

  const clearErr = (key: string) =>
    setErrors((prev) => { const next = { ...prev }; delete next[key]; return next; });

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (step === 1) {
      if (!groupName.trim()) e.groupName = "Group name is required";
      if (!groupType) e.groupType = "Select a group type";
    }
    if (step === 2) {
      if (toNum(contribAmount) <= 0) e.contribAmount = "Enter a valid contribution amount";
      if (contribFreq === "Monthly") {
        const d = parseInt(deadlineDay) || 0;
        if (d < 1 || d > 28) e.deadlineDay = "Enter a day between 1 and 28";
      }
      if (lateContribEnabled && lateContribPenaltyType === "flat" && toNum(lateContribFlatAmount) < 1) {
        e.lateContribFlatAmount = "Flat fee should be more than 0";
      }
    }
    if (step === 3) {
      if (lateRepayEnabled && lateRepayPenaltyType === "flat" && toNum(lateRepayFlatAmount) < 1) {
        e.lateRepayFlatAmount = "Flat fee should be more than 0";
      }
    }
    if (step === 4) {
      if (treasurerPhone.trim() && !isValidZambianPhone(treasurerPhone.trim())) e.treasurerPhone = "Enter a valid Zambian phone number";
      if (secretaryPhone.trim() && !isValidZambianPhone(secretaryPhone.trim())) e.secretaryPhone = "Enter a valid Zambian phone number";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) setGroupAvatar(result.assets[0].uri);
  };

  const addPhoneInvite = async () => {
    if (!phoneInput) return;
    if (!newGroupId) { setInviteError("Group not ready yet, please wait a moment."); return; }
    if (phoneInput.length < 9) { setInviteError("Enter a 9-digit number after +260"); return; }
    const full = `+260${phoneInput}`;
    setInviting(true); setInviteError("");
    try {
      await inviteMember(newGroupId, full);
      setInvites((prev) => [...prev, { id: `${Date.now()}`, contact: full, status: "Pending" }]);
      setPhoneInput("");
    } catch (e: any) {
      setInviteError(e?.message || "Could not send invite. Please try again.");
    } finally {
      setInviting(false);
    }
  };

  const removeInvite = (id: string) => setInvites((prev) => prev.filter((i) => i.id !== id));

  const goToStep = (n: number) => { setStep(n); setErrors({}); };

  // Step 3 is Loan rules. A savings-only type has none, so the wizard steps over
  // it in both directions and the counter below reports one step fewer.
  const lendingAvailable = lendsToMembers(groupType);
  const payerAccount = detectNetwork(payerPhone);
  const networkKnown = payerAccount.network !== "Unknown";
  const nextStep = (s: number) => (s === 2 && !lendingAvailable ? 4 : s + 1);
  const prevStep = (s: number) => (s === 4 && !lendingAvailable ? 2 : s - 1);
  const totalSteps = lendingAvailable ? TOTAL_STEPS : TOTAL_STEPS - 1;
  const displayStep = lendingAvailable || step < 3 ? step : step - 1;

  // Keep the saved constitution honest about the type: switching to a
  // savings-only type clears lending, switching back restores the default.
  // Adjusted during render rather than in an effect so the reset lands in the
  // same pass as the type change instead of causing a second one.
  const [prevLendingAvailable, setPrevLendingAvailable] = useState(lendingAvailable);
  if (prevLendingAvailable !== lendingAvailable) {
    setPrevLendingAvailable(lendingAvailable);
    setInternalLending(lendingAvailable);
  }

  // Set a repayment band's max term, keeping the ladder valid: every term stays
  // within 1…cycle, and larger loans never get a shorter term than smaller ones.
  const setTierMonths = (index: number, months: number) => {
    const v = Math.max(1, Math.min(cycleMonths, months));
    setRepaymentTiers((prev) =>
      prev.map((t, j) => {
        if (j === index) return { ...t, maxMonths: v };
        if (j < index && t.maxMonths > v) return { ...t, maxMonths: v }; // smaller bands ≤ this
        if (j > index && t.maxMonths < v) return { ...t, maxMonths: v }; // larger bands ≥ this
        return t;
      })
    );
  };

  const handleNext = () => {
    if (!validate()) return;
    setStep(nextStep);
    setErrors({});
  };

  const handlePayAndCreate = async () => {
    if (paying) return;
    setPaying(true);
    try {
      const cycleMonths = parseMonths(cycleDuration);
      const d = new Date();
      d.setMonth(d.getMonth() + cycleMonths);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const shareOutDate = `${yyyy}-${mm}-${dd}`;

      const constitution: GroupConstitution = {
        penaltyRules: {
          lateContribution: {
            enabled: lateContribEnabled,
            penaltyType: lateContribPenaltyType,
            penaltyRate: lateContribPenaltyType === "percent" ? toNum(lateContributionPenaltyRate) || 1 : undefined,
            penaltyAmount: lateContribPenaltyType === "flat" ? toNum(lateContribFlatAmount) || 20 : undefined,
          },
          missingMeeting: { enabled: false, amount: 0 },
          lateRepayment: {
            // Nothing to repay without lending, so this rule could never fire.
            enabled: lendingAvailable && lateRepayEnabled,
            penaltyType: lateRepayPenaltyType,
            penaltyRate: lateRepayPenaltyType === "percent" ? toNum(lateRepaymentPenaltyRate) || 1 : undefined,
            penaltyAmount: lateRepayPenaltyType === "flat" ? toNum(lateRepayFlatAmount) || 100 : undefined,
          },
        },
        gracePeriodDays: parseInt(gracePeriod) || 0,
        loanMultiplier: parseInt(loanMultiplier) || 2,
        loanInterestRate: toNum(loanInterest) || 5,
        // Legacy single cap kept for back-compat = the longest tier term.
        loanRepaymentMonths: Math.max(...repaymentTiers.map((t) => t.maxMonths)),
        loanRepaymentTiers: repaymentTiers,
        loanFreeWindowMonths: loanFreeWindow,
        internalLendingEnabled: internalLending,
        approvalThreshold,
      };

      const user = await getCurrentUser<{ phone?: string }>();

      const payload = {
        name: groupName.trim(),
        description: groupDesc.trim(),
        groupType,
        avatar: groupAvatar || undefined,
        contributionAmount: toNum(contribAmount),
        contributionFrequency: contribFreq,
        shareOutDate,
        loanInterestRate: toNum(loanInterest) || 5,
        loanMaxMultiplier: parseInt(loanMultiplier) || 2,
        constitution,
        treasurerPhone: treasurerPhone ? `+260${treasurerPhone}` : undefined,
        secretaryPhone: secretaryPhone ? `+260${secretaryPhone}` : undefined,
        payerPhone: user?.phone,
      };

      const res = await createGroup(payload);
      const newId = String(res.group._id);
      setNewGroupId(newId);
      setStep(7);
    } catch (e: any) {
      Alert.alert("Could not create group", e?.message || "Please try again.");
    } finally {
      setPaying(false);
    }
  };

  // ─── Post-creation invite screen ────────────────────────────────────────────

  if (showInvite) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]} testID="create-group-invite-screen">
        <ScreenHeader title="Invite members" onBack={() => setShowInvite(false)} />
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={{ color: colors.textMuted, fontSize: 14, lineHeight: 22, marginBottom: 24 }}>
                Invite people to {groupName} by phone number. They&apos;ll get an SMS and see the invite in their app.
              </Text>

              <FL text="Invite by phone" colors={colors} />
              <View style={styles.inputActionRow}>
                <View style={[styles.inputRow, { flex: 1, backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={{ color: colors.textMuted, fontSize: 15, fontWeight: "600" }}>+260</Text>
                  <TextInput
                    style={[styles.inlineInput, { color: colors.textMain, flex: 1 }]}
                    value={phoneInput}
                    onChangeText={(t) => setPhoneInput(t.replace(/\D/g, "").slice(0, 9))}
                    placeholder="97X XXX XXX"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="phone-pad"
                    maxLength={9}
                    testID="invite-phone-input"
                  />
                </View>
                <Pressable
                  onPress={addPhoneInvite}
                  disabled={inviting}
                  style={[styles.actionBtn, { backgroundColor: colors.primary, opacity: inviting ? 0.6 : 1 }]}
                  testID="invite-phone-send"
                >
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>{inviting ? "Sending…" : "Send"}</Text>
                </Pressable>
              </View>
              {inviteError ? <Text style={[styles.errText, { color: colors.danger }]}>{inviteError}</Text> : null}

              {invites.length > 0 && (
                <>
                  <FL text="Pending invitations" colors={colors} style={{ marginTop: 20 }} />
                  <Card padding={4}>
                    {invites.map((inv, i) => (
                      <View
                        key={inv.id}
                        style={[
                          styles.optionRow,
                          i < invites.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                        ]}
                      >
                        <Text style={{ color: colors.textMain, fontWeight: "500", flex: 1 }}>{inv.contact}</Text>
                        <View style={[styles.statusPill, { backgroundColor: colors.primarySoft }]}>
                          <Text style={{ color: colors.primary, fontSize: 11, fontWeight: "700" }}>{inv.status}</Text>
                        </View>
                        <Pressable onPress={() => removeInvite(inv.id)} style={{ marginLeft: 10 }} testID={`remove-invite-${inv.id}`}>
                          <X size={16} color={colors.textMuted} />
                        </Pressable>
                      </View>
                    ))}
                  </Card>
                </>
              )}

              <View style={[styles.infoNote, { backgroundColor: colors.primarySoft }]}>
                <Text style={{ color: colors.primary, fontSize: 13, lineHeight: 20 }}>
                  Members will receive an SMS invite to join Chuma and this group.
                </Text>
              </View>

              <View style={{ flex: 1, minHeight: 24 }} />
              <Button
                label="Done, go to dashboard"
                onPress={() => router.replace(`/group/${newGroupId}`)}
                testID="invite-done-btn"
              />
              <View style={{ height: 10 }} />
              <Button
                label="Skip for now"
                variant="ghost"
                onPress={() => router.replace(`/group/${newGroupId}`)}
                testID="invite-skip-btn"
              />
            </ScrollView>
          </KeyboardAvoidingView>
        </TouchableWithoutFeedback>
      </SafeAreaView>
    );
  }

  // ─── Step 7 — Success ───────────────────────────────────────────────────────

  if (step === 7) {
    const typeLabel = GROUP_TYPES.find((t) => t.value === groupType)?.label ?? "";
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]} testID="create-group-success">
        <View style={styles.successWrap}>
          <View style={[styles.successCircle, { backgroundColor: colors.primary }]}>
            <Check size={56} color="#fff" strokeWidth={3} />
          </View>
          <Text style={[styles.successTitle, { color: colors.textMain }]}>Group created</Text>
          <Text style={[styles.successSub, { color: colors.textMuted }]}>{groupName}</Text>

          <View style={{ width: "100%", paddingHorizontal: 24, marginTop: 28 }}>
            <Card padding={18}>
              <RRow label="Name" value={groupName} colors={colors} />
              <RRow label="Type" value={typeLabel} colors={colors} />
              <RRow label="Cycle" value={cycleDuration} colors={colors} />
              <RRow
                label="Registration fee"
                value={`K100.00 paid · ${networkKnown ? payerAccount.network : "Mobile money"}`}
                colors={colors}
                last
              />
            </Card>
          </View>

          <View style={{ flex: 1 }} />
          <View style={{ width: "100%", paddingHorizontal: 24 }}>
            <Button
              label="Invite members"
              onPress={() => setShowInvite(true)}
              testID="create-group-invite-btn"
            />
            <View style={{ height: 10 }} />
            <Button
              label="Go to group dashboard"
              variant="ghost"
              onPress={() => router.replace(`/group/${newGroupId}`)}
              testID="create-group-open-btn"
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Derived display values ──────────────────────────────────────────────────

  const groupTypeLabel = GROUP_TYPES.find((t) => t.value === groupType)?.label ?? "";
  const thresholdLabel = APPROVAL_THRESHOLDS.find((t) => t.value === approvalThreshold)?.label ?? "";
  const activePermCount = Object.values(permissions).filter(Boolean).length;

  // ─── Main render ─────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]} testID="create-group-screen">
      <ScreenHeader
        title={STEP_TITLES[step - 1]}
        onBack={step > 1 ? () => goToStep(prevStep(step)) : undefined}
      />

      {/* Step progress bar */}
      <View style={styles.progressWrap}>
        <Text style={[styles.stepLabel, { color: colors.textMuted }]}>Step {displayStep} of {totalSteps}</Text>
        <View style={[styles.progressBg, { backgroundColor: colors.border }]}>
          <View style={{ flex: displayStep, height: 4, backgroundColor: colors.primary, borderRadius: 99 }} />
          <View style={{ flex: totalSteps - displayStep }} />
        </View>
      </View>

      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <ScrollView ref={scrollRef} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {/* ─── STEP 1 — Group Basics ──────────────────────────────────────── */}
            {step === 1 && (
              <>
                <FL text="Group name" colors={colors} />
                <TextInput
                  style={[styles.inputField, { color: colors.textMain, backgroundColor: colors.surface, borderColor: errors.groupName ? colors.danger : colors.border }]}
                  value={groupName}
                  onChangeText={(t) => { setGroupName(t); clearErr("groupName"); }}
                  placeholder="e.g. Lusaka Market Sisters"
                  placeholderTextColor={colors.textMuted}
                  testID="create-group-name-input"
                />
                {errors.groupName ? <Text style={[styles.errText, { color: colors.danger }]}>{errors.groupName}</Text> : null}

                <FL text="Group type" colors={colors} style={{ marginTop: 20 }} />
                <View style={styles.chipsRow}>
                  {GROUP_TYPES.map((t) => {
                    const active = groupType === t.value;
                    return (
                      <Pressable
                        key={t.value}
                        onPress={() => { setGroupType(t.value); clearErr("groupType"); }}
                        style={[styles.chip, { backgroundColor: active ? colors.primary : colors.surface, borderColor: active ? colors.primary : colors.border }]}
                        testID={`group-type-${t.value}`}
                      >
                        <Text style={{ color: active ? "#fff" : colors.textMain, fontWeight: "600", fontSize: 13 }}>{t.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {errors.groupType ? <Text style={[styles.errText, { color: colors.danger }]}>{errors.groupType}</Text> : null}
                {groupType && !lendingAvailable ? (
                  <Text style={[styles.fieldHint, { color: colors.textMuted, marginTop: 8 }]}>
                    This type saves together without lending, so there are no loan rules to set.
                    Members contribute and share out at the end of the cycle.
                  </Text>
                ) : null}

                <FL text="Description (optional)" colors={colors} style={{ marginTop: 20 }} />
                <TextInput
                  style={[styles.inputField, styles.textArea, { color: colors.textMain, backgroundColor: colors.surface, borderColor: colors.border }]}
                  value={groupDesc}
                  onChangeText={setGroupDesc}
                  onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250)}
                  placeholder="What is this group for?"
                  placeholderTextColor={colors.textMuted}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  testID="create-group-desc-input"
                />

                <FL text="Group avatar (optional)" colors={colors} style={{ marginTop: 20 }} />
                <Pressable onPress={pickImage} style={styles.avatarWrap} testID="create-group-avatar-btn">
                  {groupAvatar ? (
                    <Image source={{ uri: groupAvatar }} style={styles.avatarImg} />
                  ) : (
                    <View style={[styles.avatarPlaceholder, { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}>
                      <Camera size={26} color={colors.primary} />
                      <Text style={{ color: colors.primary, fontSize: 12, marginTop: 6, fontWeight: "600" }}>Choose photo</Text>
                    </View>
                  )}
                </Pressable>
              </>
            )}

            {/* ─── STEP 2 — Contribution Setup ────────────────────────────────── */}
            {step === 2 && (
              <>
                <FL text="Contribution frequency" colors={colors} />
                <View style={styles.chipsRow}>
                  {CONTRIB_FREQS.map((f) => {
                    const active = contribFreq === f;
                    return (
                      <Pressable
                        key={f}
                        onPress={() => setContribFreq(f)}
                        style={[styles.chip, { backgroundColor: active ? colors.primary : colors.surface, borderColor: active ? colors.primary : colors.border }]}
                        testID={`contrib-freq-${f}`}
                      >
                        <Text style={{ color: active ? "#fff" : colors.textMain, fontWeight: "600", fontSize: 13 }}>{f}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <FL text="Contribution amount" colors={colors} style={{ marginTop: 20 }} />
                <View style={[styles.amountWrap, { backgroundColor: colors.surface, borderColor: errors.contribAmount ? colors.danger : colors.border }]}>
                  <Text style={[styles.currency, { color: colors.primary }]}>K</Text>
                  <TextInput
                    style={[styles.amountInput, { color: colors.textMain }]}
                    value={contribAmount}
                    onChangeText={(t) => { handleNumericInput(t, setContribAmount); clearErr("contribAmount"); }}
                    keyboardType={Platform.OS === "ios" ? "decimal-pad" : "numeric"}
                    placeholder="0"
                    placeholderTextColor={colors.textMuted}
                    testID="create-group-contrib-amount"
                  />
                </View>
                {errors.contribAmount ? <Text style={[styles.errText, { color: colors.danger }]}>{errors.contribAmount}</Text> : null}

                <FL text="Savings cycle duration" colors={colors} style={{ marginTop: 20 }} />
                <View style={styles.chipsRow}>
                  {CYCLE_DURATIONS.map((d) => {
                    const active = cycleDuration === d;
                    return (
                      <Pressable
                        key={d}
                        onPress={() => setCycleDuration(d)}
                        style={[styles.chip, { backgroundColor: active ? colors.primary : colors.surface, borderColor: active ? colors.primary : colors.border }]}
                      >
                        <Text style={{ color: active ? "#fff" : colors.textMain, fontWeight: "600", fontSize: 13 }}>{d}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <FL
                  text={contribFreq === "Monthly" ? "Day of month deadline" : "Day of week deadline"}
                  colors={colors}
                  style={{ marginTop: 20 }}
                />
                {contribFreq === "Monthly" ? (
                  <>
                    <TextInput
                      style={[styles.inputField, { color: colors.textMain, backgroundColor: colors.surface, borderColor: errors.deadlineDay ? colors.danger : colors.border }]}
                      value={deadlineDay}
                      onChangeText={(t) => { handleIntInput(t, setDeadlineDay, 28); clearErr("deadlineDay"); }}
                      keyboardType="number-pad"
                      placeholder="1"
                      placeholderTextColor={colors.textMuted}
                      testID="create-group-deadline-day"
                    />
                    {errors.deadlineDay ? <Text style={[styles.errText, { color: colors.danger }]}>{errors.deadlineDay}</Text> : null}
                  </>
                ) : (
                  <View style={styles.chipsRow}>
                    {DAYS_OF_WEEK.map((d) => {
                      const active = deadlineDow === d;
                      return (
                        <Pressable
                          key={d}
                          onPress={() => setDeadlineDow(d)}
                          style={[styles.chip, { backgroundColor: active ? colors.primary : colors.surface, borderColor: active ? colors.primary : colors.border }]}
                        >
                          <Text style={{ color: active ? "#fff" : colors.textMain, fontWeight: "600", fontSize: 13 }}>{d}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}

                <TR label="Late contribution penalty" value={lateContribEnabled} onToggle={setLateContribEnabled} colors={colors} style={{ marginTop: 20 }} />
                {lateContribEnabled && (
                  <>
                    <View style={[styles.chipsRow, { marginTop: 10, marginBottom: 12 }]}>
                      {(["Flat fee", "% per day"] as const).map((opt) => {
                        const t = opt === "Flat fee" ? "flat" : "percent";
                        const active = lateContribPenaltyType === t;
                        return (
                          <Pressable
                            key={opt}
                            onPress={() => setLateContribPenaltyType(t)}
                            style={[styles.chip, { backgroundColor: active ? colors.primary : colors.surface, borderColor: active ? colors.primary : colors.border }]}
                          >
                            <Text style={{ color: active ? "#fff" : colors.textMain, fontWeight: "600", fontSize: 13 }}>{opt}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {lateContribPenaltyType === "flat" ? (
                      <>
                        <FL text="Penalty amount" colors={colors} />
                        <View style={[styles.inputRow, { backgroundColor: colors.surface, borderColor: errors.lateContribFlatAmount ? colors.danger : colors.border }]}>
                          <Text style={[styles.currency, { color: colors.primary }]}>K</Text>
                          <TextInput
                            style={[styles.inlineInput, { color: colors.textMain, flex: 1, textAlign: "left" }]}
                            value={lateContribFlatAmount}
                            onChangeText={(t) => { setLateContribFlatAmount(t.replace(/[^0-9]/g, "").slice(0, 5)); clearErr("lateContribFlatAmount"); }}
                            keyboardType="number-pad"
                            testID="create-group-late-contrib-flat"
                          />
                        </View>
                        {errors.lateContribFlatAmount ? (
                          <Text style={[styles.errText, { color: colors.danger }]}>{errors.lateContribFlatAmount}</Text>
                        ) : (
                          <Text style={[styles.fieldHint, { color: colors.textMuted, marginTop: 6 }]}>
                            Members will be charged a fixed K{lateContribFlatAmount} per violation
                          </Text>
                        )}
                      </>
                    ) : (
                      <>
                        <FL text={`Penalty rate: ${lateContributionPenaltyRate}% per day`} colors={colors} />
                        <Slider
                          minimumValue={0.5}
                          maximumValue={30}
                          step={0.5}
                          value={parseFloat(lateContributionPenaltyRate) || 1}
                          onValueChange={(v) => setLateContributionPenaltyRate(v.toFixed(1))}
                          minimumTrackTintColor={colors.primary}
                          maximumTrackTintColor={colors.border}
                          thumbTintColor={colors.primary}
                          style={{ marginVertical: 8 }}
                        />
                        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                          <Text style={{ color: colors.textMuted, fontSize: 11 }}>0.5%</Text>
                          <Text style={{ color: colors.textMuted, fontSize: 11 }}>30% max</Text>
                        </View>
                        {toNum(contribAmount) > 0 && (
                          <Text style={[styles.fieldHint, { color: colors.textMuted, marginTop: 6 }]}>
                            e.g. {formatZMW(toNum(contribAmount))} × {lateContributionPenaltyRate}% × 7 days = {formatZMW(toNum(contribAmount) * (toNum(lateContributionPenaltyRate) / 100) * 7)}
                          </Text>
                        )}
                      </>
                    )}
                  </>
                )}
              </>
            )}

            {/* ─── STEP 3 — Loan Rules ────────────────────────────────────────── */}
            {step === 3 && (
              <>
                <TR label="Enable internal lending" value={internalLending} onToggle={setInternalLending} colors={colors} />

                {internalLending && (
                  <>
                    <FL
                      text={`Loan multiplier: up to ${loanMultiplier}× member savings`}
                      colors={colors}
                      style={{ marginTop: 20 }}
                    />
                    <View style={styles.chipsRow}>
                      {LOAN_MULTIPLIERS.map((m) => {
                        const active = loanMultiplier === m.value;
                        return (
                          <Pressable
                            key={m.value}
                            onPress={() => setLoanMultiplier(m.value)}
                            style={[styles.chip, { backgroundColor: active ? colors.primary : colors.surface, borderColor: active ? colors.primary : colors.border }]}
                            testID={`loan-multiplier-${m.value}`}
                          >
                            <Text style={{ color: active ? "#fff" : colors.textMain, fontWeight: "600", fontSize: 13 }}>{m.label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    <FL text={`Interest rate: ${loanInterest}% per month`} colors={colors} style={{ marginTop: 20 }} />
                    <Slider
                      minimumValue={1}
                      maximumValue={30}
                      step={0.5}
                      value={parseFloat(loanInterest) || 5}
                      onValueChange={(v) => setLoanInterest(v.toFixed(1))}
                      minimumTrackTintColor={colors.primary}
                      maximumTrackTintColor={colors.border}
                      thumbTintColor={colors.primary}
                      style={{ marginVertical: 8 }}
                      testID="create-group-loan-interest"
                    />
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ color: colors.textMuted, fontSize: 11 }}>1%</Text>
                      <Text style={{ color: colors.textMuted, fontSize: 11 }}>30% max</Text>
                    </View>

                    <FL text="Repayment terms by loan size" colors={colors} style={{ marginTop: 20 }} />
                    <Text style={[styles.fieldHint, { color: colors.textMuted, marginBottom: 4 }]}>
                      Tuned to your {cycleDuration} cycle: bigger loans get longer to repay, but always clear before share-out so the fund keeps circulating.
                    </Text>
                    <Card padding={4} style={{ marginTop: 4 }}>
                      {repaymentTiers.map((tier, i) => {
                        const prevMax = i === 0 ? null : repaymentTiers[i - 1].maxAmount;
                        return (
                          <View
                            key={i}
                            style={[
                              styles.tierRow,
                              i < repaymentTiers.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                            ]}
                          >
                            <Text style={{ color: colors.textMain, fontWeight: "600", fontSize: 13, flex: 1 }}>
                              {tierBandLabel(tier, prevMax, formatZMW)}
                            </Text>
                            <View style={styles.tierStepper}>
                              <Pressable
                                onPress={() => setTierMonths(i, tier.maxMonths - 1)}
                                disabled={tier.maxMonths <= 1}
                                hitSlop={8}
                                style={[styles.stepBtn, { borderColor: colors.border, opacity: tier.maxMonths <= 1 ? 0.4 : 1 }]}
                                testID={`repay-tier-${i}-dec`}
                              >
                                <Text style={[styles.stepBtnText, { color: colors.textMain }]}>−</Text>
                              </Pressable>
                              <Text style={[styles.tierMonthsValue, { color: colors.textMain }]}>
                                {tier.maxMonths} mo
                              </Text>
                              <Pressable
                                onPress={() => setTierMonths(i, tier.maxMonths + 1)}
                                disabled={tier.maxMonths >= cycleMonths}
                                hitSlop={8}
                                style={[styles.stepBtn, { borderColor: colors.border, opacity: tier.maxMonths >= cycleMonths ? 0.4 : 1 }]}
                                testID={`repay-tier-${i}-inc`}
                              >
                                <Text style={[styles.stepBtnText, { color: colors.textMain }]}>+</Text>
                              </Pressable>
                            </View>
                          </View>
                        );
                      })}
                    </Card>

                    <FL text="Stop new loans before share-out" colors={colors} style={{ marginTop: 20 }} />
                    <Text style={[styles.fieldHint, { color: colors.textMuted, marginBottom: 4 }]}>
                      No new loans are issued this close to the cycle end, so every loan is repaid before share-out.
                    </Text>
                    <View style={styles.chipsRow}>
                      {[0, 1, 2].map((m) => {
                        const active = loanFreeWindow === m;
                        return (
                          <Pressable
                            key={m}
                            onPress={() => setLoanFreeWindow(m)}
                            style={[styles.chip, { backgroundColor: active ? colors.primary : colors.surface, borderColor: active ? colors.primary : colors.border }]}
                            testID={`loan-free-window-${m}`}
                          >
                            <Text style={{ color: active ? "#fff" : colors.textMain, fontWeight: "600", fontSize: 13 }}>
                              {m === 0 ? "No cut-off" : `${m} month${m > 1 ? "s" : ""} before`}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    <FL text="Grace period: days before repayment begins" colors={colors} style={{ marginTop: 20 }} />
                    <View style={[styles.inputRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <TextInput
                        style={[styles.inlineInput, { color: colors.textMain, flex: 1, textAlign: "left" }]}
                        value={gracePeriod}
                        onChangeText={(t) => handleIntInput(t, setGracePeriod, 14)}
                        keyboardType="number-pad"
                        placeholder="0"
                        placeholderTextColor={colors.textMuted}
                        testID="create-group-grace-period"
                      />
                      <Text style={{ color: colors.textMuted, fontSize: 14 }}>days</Text>
                    </View>

                    <TR label="Late repayment penalty" value={lateRepayEnabled} onToggle={setLateRepayEnabled} colors={colors} style={{ marginTop: 20 }} />
                    {lateRepayEnabled && (
                      <>
                        <View style={[styles.chipsRow, { marginTop: 10, marginBottom: 12 }]}>
                          {(["Flat fee", "% per day"] as const).map((opt) => {
                            const t = opt === "Flat fee" ? "flat" : "percent";
                            const active = lateRepayPenaltyType === t;
                            return (
                              <Pressable
                                key={opt}
                                onPress={() => setLateRepayPenaltyType(t)}
                                style={[styles.chip, { backgroundColor: active ? colors.primary : colors.surface, borderColor: active ? colors.primary : colors.border }]}
                              >
                                <Text style={{ color: active ? "#fff" : colors.textMain, fontWeight: "600", fontSize: 13 }}>{opt}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        {lateRepayPenaltyType === "flat" ? (
                          <>
                            <FL text="Penalty amount" colors={colors} />
                            <View style={[styles.inputRow, { backgroundColor: colors.surface, borderColor: errors.lateRepayFlatAmount ? colors.danger : colors.border }]}>
                              <Text style={[styles.currency, { color: colors.primary }]}>K</Text>
                              <TextInput
                                style={[styles.inlineInput, { color: colors.textMain, flex: 1, textAlign: "left" }]}
                                value={lateRepayFlatAmount}
                                onChangeText={(t) => { setLateRepayFlatAmount(t.replace(/[^0-9]/g, "").slice(0, 5)); clearErr("lateRepayFlatAmount"); }}
                                keyboardType="number-pad"
                                testID="create-group-late-repay-flat"
                              />
                            </View>
                            {errors.lateRepayFlatAmount ? (
                              <Text style={[styles.errText, { color: colors.danger }]}>{errors.lateRepayFlatAmount}</Text>
                            ) : (
                              <Text style={[styles.fieldHint, { color: colors.textMuted, marginTop: 6 }]}>
                                Members will be charged a fixed K{lateRepayFlatAmount} per violation
                              </Text>
                            )}
                          </>
                        ) : (
                          <>
                            <FL text={`Penalty rate: ${lateRepaymentPenaltyRate}% per day`} colors={colors} />
                            <Slider
                              minimumValue={0.5}
                              maximumValue={30}
                              step={0.5}
                              value={parseFloat(lateRepaymentPenaltyRate) || 1}
                              onValueChange={(v) => setLateRepaymentPenaltyRate(v.toFixed(1))}
                              minimumTrackTintColor={colors.primary}
                              maximumTrackTintColor={colors.border}
                              thumbTintColor={colors.primary}
                              style={{ marginVertical: 8 }}
                            />
                            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                              <Text style={{ color: colors.textMuted, fontSize: 11 }}>0.5%</Text>
                              <Text style={{ color: colors.textMuted, fontSize: 11 }}>30% max</Text>
                            </View>
                            {toNum(contribAmount) > 0 && (
                              <Text style={[styles.fieldHint, { color: colors.textMuted, marginTop: 6 }]}>
                                e.g. {formatZMW(toNum(contribAmount) * (parseInt(loanMultiplier) || 2))} × {lateRepaymentPenaltyRate}% × 7 days = {formatZMW(toNum(contribAmount) * (parseInt(loanMultiplier) || 2) * (toNum(lateRepaymentPenaltyRate) / 100) * 7)}
                              </Text>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </>
                )}
              </>
            )}

            {/* ─── STEP 4 — Governance ────────────────────────────────────────── */}
            {step === 4 && (
              <>
                <View style={[styles.infoNote, { backgroundColor: colors.primarySoft, marginBottom: 20 }]}>
                  <Text style={{ color: colors.primary, fontSize: 13, lineHeight: 20 }}>
                    You will be automatically assigned as Chairperson as the group founder.
                  </Text>
                </View>

                <FL text="Treasurer (optional)" colors={colors} />
                <View style={[styles.inputRow, { backgroundColor: colors.surface, borderColor: errors.treasurerPhone ? colors.danger : colors.border }]}>
                  <Text style={{ color: colors.textMuted, fontSize: 15, fontWeight: "600" }}>+260</Text>
                  <TextInput
                    style={[styles.inlineInput, { color: colors.textMain, flex: 1 }]}
                    value={treasurerPhone}
                    onChangeText={(t) => { handlePhoneInput(t, setTreasurerPhone); clearErr("treasurerPhone"); }}
                    placeholder="9XX XXX XXX"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="phone-pad"
                    maxLength={9}
                    testID="create-group-treasurer"
                  />
                  {Platform.OS !== "web" && (
                    <Pressable
                      onPress={() => pickContact(setTreasurerPhone, "treasurerPhone")}
                      hitSlop={8}
                      style={[styles.contactBtn, { borderLeftColor: colors.border }]}
                      testID="create-group-treasurer-contact"
                    >
                      <Contact size={20} color={colors.primary} />
                    </Pressable>
                  )}
                </View>
                {errors.treasurerPhone ? <Text style={[styles.errText, { color: colors.danger }]}>{errors.treasurerPhone}</Text> : null}

                <FL text="Secretary (optional)" colors={colors} style={{ marginTop: 20 }} />
                <View style={[styles.inputRow, { backgroundColor: colors.surface, borderColor: errors.secretaryPhone ? colors.danger : colors.border }]}>
                  <Text style={{ color: colors.textMuted, fontSize: 15, fontWeight: "600" }}>+260</Text>
                  <TextInput
                    style={[styles.inlineInput, { color: colors.textMain, flex: 1 }]}
                    value={secretaryPhone}
                    onChangeText={(t) => { handlePhoneInput(t, setSecretaryPhone); clearErr("secretaryPhone"); }}
                    placeholder="9XX XXX XXX"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="phone-pad"
                    maxLength={9}
                    testID="create-group-secretary"
                  />
                  {Platform.OS !== "web" && (
                    <Pressable
                      onPress={() => pickContact(setSecretaryPhone, "secretaryPhone")}
                      hitSlop={8}
                      style={[styles.contactBtn, { borderLeftColor: colors.border }]}
                      testID="create-group-secretary-contact"
                    >
                      <Contact size={20} color={colors.primary} />
                    </Pressable>
                  )}
                </View>
                {errors.secretaryPhone ? <Text style={[styles.errText, { color: colors.danger }]}>{errors.secretaryPhone}</Text> : null}

                <FL text="Approval threshold" colors={colors} style={{ marginTop: 20 }} />
                <View style={styles.chipsRow}>
                  {APPROVAL_THRESHOLDS.map((t) => {
                    const active = approvalThreshold === t.value;
                    return (
                      <Pressable
                        key={t.value}
                        onPress={() => setApprovalThreshold(t.value)}
                        style={[styles.chip, { backgroundColor: active ? colors.primary : colors.surface, borderColor: active ? colors.primary : colors.border }]}
                        testID={`approval-threshold-${t.value}`}
                      >
                        <Text style={{ color: active ? "#fff" : colors.textMain, fontWeight: "600", fontSize: 13 }}>{t.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <FL text="Governance permissions" colors={colors} style={{ marginTop: 20 }} />
                <Card padding={4} style={{ marginTop: 4 }}>
                  {PERMISSION_ITEMS.map((p, i) => (
                    <Pressable
                      key={p.key}
                      onPress={() => setPermissions((prev) => ({ ...prev, [p.key]: !prev[p.key] }))}
                      style={[
                        styles.optionRow,
                        i < PERMISSION_ITEMS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                      ]}
                      testID={`permission-${p.key}`}
                    >
                      <Text style={{ color: colors.textMain, fontWeight: "500", flex: 1 }}>{p.label}</Text>
                      <View style={[styles.checkbox, { borderColor: permissions[p.key] ? colors.primary : colors.borderStrong, backgroundColor: permissions[p.key] ? colors.primary : "transparent" }]}>
                        {permissions[p.key] && <Check size={12} color="#fff" strokeWidth={3} />}
                      </View>
                    </Pressable>
                  ))}
                </Card>
              </>
            )}

            {/* ─── STEP 5 — Review & Confirm ──────────────────────────────────── */}
            {step === 5 && (
              <>
                <RC title="Group" onEdit={() => goToStep(1)} colors={colors}>
                  <RRow label="Name" value={groupName} colors={colors} />
                  <RRow label="Type" value={groupTypeLabel} colors={colors} />
                  {groupDesc ? <RRow label="Description" value={groupDesc} colors={colors} /> : null}
                  <RRow label="Avatar" value={groupAvatar ? "Photo selected" : "None"} colors={colors} last />
                </RC>

                <RC title="Contributions" onEdit={() => goToStep(2)} colors={colors} style={{ marginTop: 14 }}>
                  <RRow label="Frequency" value={contribFreq} colors={colors} />
                  <RRow label="Amount" value={`K ${contribAmount || "0"}`} colors={colors} />
                  <RRow label="Cycle" value={cycleDuration} colors={colors} />
                  <RRow
                    label="Deadline"
                    value={contribFreq === "Monthly" ? `Day ${deadlineDay} of each month` : deadlineDow}
                    colors={colors}
                  />
                  <RRow label="Late penalty" value={lateContribEnabled ? lateContribPenaltyType === "flat" ? `K${lateContribFlatAmount} flat fee` : `${lateContributionPenaltyRate}% per day (max 30%)` : "None"} colors={colors} last />
                </RC>

                <RC
                  title="Loans"
                  onEdit={() => goToStep(lendingAvailable ? 3 : 1)}
                  colors={colors}
                  style={{ marginTop: 14 }}
                >
                  <RRow
                    label="Internal lending"
                    value={
                      lendingAvailable
                        ? internalLending
                          ? "Enabled"
                          : "Disabled"
                        : `Not offered by ${groupTypeLabel.toLowerCase()}s`
                    }
                    colors={colors}
                    last={!internalLending}
                  />
                  {internalLending && (
                    <>
                      <RRow label="Multiplier" value={`${loanMultiplier}× savings`} colors={colors} />
                      <RRow label="Interest" value={`${loanInterest}% / month`} colors={colors} />
                      {repaymentTiers.map((tier, i) => (
                        <RRow
                          key={i}
                          label={i === 0 ? "Repayment terms" : ""}
                          value={`${tierBandLabel(tier, i === 0 ? null : repaymentTiers[i - 1].maxAmount, formatZMW)} → up to ${tier.maxMonths}mo`}
                          colors={colors}
                        />
                      ))}
                      <RRow label="Loan cut-off" value={loanFreeWindow === 0 ? "None" : `${loanFreeWindow} mo before share-out`} colors={colors} />
                      <RRow label="Grace period" value={`${gracePeriod} days`} colors={colors} />
                      <RRow label="Late penalty" value={lateRepayEnabled ? lateRepayPenaltyType === "flat" ? `K${lateRepayFlatAmount} flat fee` : `${lateRepaymentPenaltyRate}% per day (max 30%)` : "None"} colors={colors} last />
                    </>
                  )}
                </RC>

                <RC title="Governance" onEdit={() => goToStep(4)} colors={colors} style={{ marginTop: 14 }}>
                  <RRow label="Chairperson" value="You (group founder)" colors={colors} />
                  <RRow label="Treasurer" value={treasurerPhone ? `+260 ${treasurerPhone}` : "Not assigned"} colors={colors} />
                  <RRow label="Secretary" value={secretaryPhone ? `+260 ${secretaryPhone}` : "Not assigned"} colors={colors} />
                  <RRow label="Threshold" value={thresholdLabel} colors={colors} />
                  <RRow label="Permissions" value={`${activePermCount} active`} colors={colors} last />
                </RC>

                <Pressable
                  onPress={() => setTermsAccepted((v) => !v)}
                  style={[styles.termsRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
                  testID="create-group-terms"
                >
                  <View style={[styles.checkbox, { borderColor: termsAccepted ? colors.primary : colors.borderStrong, backgroundColor: termsAccepted ? colors.primary : "transparent" }]}>
                    {termsAccepted && <Check size={12} color="#fff" strokeWidth={3} />}
                  </View>
                  <Text style={{ color: colors.textMain, fontSize: 13, lineHeight: 20, flex: 1, marginLeft: 12 }}>
                    I accept the Chuma platform terms and group creation policy.
                  </Text>
                </Pressable>

                <View style={{ flex: 1, minHeight: 24 }} />
                <Button
                  label="Continue to payment"
                  disabled={!termsAccepted}
                  onPress={() => goToStep(6)}
                  testID="create-group-step5-continue"
                />
              </>
            )}

            {/* ─── STEP 6 — Payment ───────────────────────────────────────── */}
            {step === 6 && (
              <>
                {/* Fee summary */}
                <Card padding={18} style={{ marginBottom: 16 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <CreditCard size={18} color={colors.primary} />
                    <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 1.2 }}>
                      REGISTRATION FEE
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ color: colors.textMain, fontSize: 15, fontWeight: "600" }}>Group registration</Text>
                    <Text style={{ color: colors.textMain, fontSize: 22, fontWeight: "700" }}>K100.00</Text>
                  </View>
                  <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 6 }}>
                    One-time fee charged to you as Chairperson
                  </Text>
                </Card>

                {/* Coverage info */}
                <Card padding={16} style={{ marginBottom: 20 }}>
                  <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 1.2, marginBottom: 12 }}>
                    WHAT THIS COVERS
                  </Text>
                  {[
                    "Group wallet setup and verification",
                    "Member onboarding for up to 50 members",
                    "SMS invite delivery for all pending invites",
                    "Chuma platform access for 12 months",
                  ].map((item, i) => (
                    <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: i < 3 ? 10 : 0, gap: 10 }}>
                      <View style={{ width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 1, backgroundColor: colors.primarySoft }}>
                        <Check size={12} color={colors.primary} strokeWidth={3} />
                      </View>
                      <Text style={{ color: colors.textMain, fontSize: 13, flex: 1, lineHeight: 20 }}>{item}</Text>
                    </View>
                  ))}
                </Card>

                {/* Paying from — auto-detected from the registered number */}
                <FL text="Paying from" colors={colors} />
                <Card padding={16} style={{ marginTop: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <View
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 6,
                        backgroundColor: payerAccount.color,
                        marginRight: 10,
                      }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.textMain, fontWeight: "700", fontSize: 15 }}>
                        {networkKnown ? payerAccount.network : "No mobile money network"}
                      </Text>
                      <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                        {payerPhone || "Loading your number..."}
                      </Text>
                    </View>
                    {networkKnown && <Check size={16} color={colors.success} strokeWidth={2.5} />}
                  </View>
                </Card>

                <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 14, lineHeight: 18, marginBottom: 24 }}>
                  {networkKnown
                    ? "The fee is charged to your registered mobile money account. You will get a prompt on your phone to confirm the K100.00 payment."
                    : "We could not match your registered number to MTN, Airtel or Zamtel. Update it in your profile, then come back to finish."}
                </Text>

                <Button
                  label={paying ? "Processing…" : "Pay K100 & Create Group"}
                  disabled={paying || !networkKnown}
                  onPress={handlePayAndCreate}
                  testID="create-group-pay-btn"
                />
              </>
            )}

            {/* Continue button for steps 1–4 */}
            {step >= 1 && step <= 4 && (
              <>
                <View style={{ flex: 1, minHeight: 24 }} />
                <Button
                  label="Continue"
                  onPress={handleNext}
                  testID={`create-group-step${step}-continue`}
                />
              </>
            )}

          </ScrollView>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

// ─── Local sub-components ─────────────────────────────────────────────────────

/** Field label — uppercase overline style */
const FL = ({
  text,
  colors,
  style,
}: {
  text: string;
  colors: ReturnType<typeof useTheme>["colors"];
  style?: object;
}) => (
  <Text style={[{ fontSize: 11, fontWeight: "700", letterSpacing: 1.2, color: colors.textMuted, marginBottom: 8 }, style]}>
    {text.toUpperCase()}
  </Text>
);

/** Toggle row */
const TR = ({
  label,
  value,
  onToggle,
  colors,
  style,
}: {
  label: string;
  value: boolean;
  onToggle: (v: boolean) => void;
  colors: ReturnType<typeof useTheme>["colors"];
  style?: object;
}) => (
  <View style={[styles.toggleRow, { borderColor: colors.border, backgroundColor: colors.surface }, style]}>
    <Text style={{ color: colors.textMain, fontWeight: "600", fontSize: 15, flex: 1 }}>{label}</Text>
    <Switch
      value={value}
      onValueChange={onToggle}
      trackColor={{ false: colors.border, true: colors.primary }}
      thumbColor="#fff"
    />
  </View>
);

/** Review card wrapper with section title + Edit button */
const RC = ({
  title,
  onEdit,
  colors,
  children,
  style,
}: {
  title: string;
  onEdit: () => void;
  colors: ReturnType<typeof useTheme>["colors"];
  children: React.ReactNode;
  style?: object;
}) => (
  <Card padding={16} style={style}>
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
      <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 1.2 }}>
        {title.toUpperCase()}
      </Text>
      <Pressable onPress={onEdit} hitSlop={8}>
        <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13 }}>Edit</Text>
      </Pressable>
    </View>
    {children}
  </Card>
);

/** Review row — label/value pair */
const RRow = ({
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
  <View style={[{ paddingVertical: 9, flexDirection: "row", justifyContent: "space-between" }, !last && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
    <Text style={{ color: colors.textMuted, fontSize: 13 }}>{label}</Text>
    <Text style={{ color: colors.textMain, fontSize: 13, fontWeight: "600", flex: 1, textAlign: "right", marginLeft: 16 }} numberOfLines={1}>
      {value}
    </Text>
  </View>
);

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 28 },
  progressWrap: { paddingHorizontal: 20, paddingBottom: 14 },
  stepLabel: { fontSize: 12, fontWeight: "600", marginBottom: 8 },
  progressBg: {
    height: 4,
    borderRadius: 99,
    overflow: "hidden",
    flexDirection: "row",
  },
  inputField: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    fontWeight: "500",
  },
  textArea: { minHeight: 84, paddingTop: 14 },
  fieldHint: { fontSize: 12, marginBottom: 2 },
  errText: { fontSize: 12, marginTop: 6, fontWeight: "500" },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  tierRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 8,
    gap: 8,
  },
  tierStepper: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: { fontSize: 18, fontWeight: "700", lineHeight: 20 },
  tierMonthsValue: { fontSize: 14, fontWeight: "700", minWidth: 46, textAlign: "center" },
  amountWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 18,
    paddingHorizontal: 20,
    gap: 10,
  },
  currency: { fontSize: 24, fontWeight: "700" },
  amountInput: { flex: 1, fontSize: 36, fontWeight: "700", letterSpacing: -0.8, padding: 0 },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  inlineInput: { fontSize: 15, fontWeight: "500", padding: 0, minWidth: 32 },
  contactBtn: {
    alignSelf: "stretch",
    justifyContent: "center",
    paddingLeft: 12,
    borderLeftWidth: 1,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  inputActionRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  actionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  statusPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  infoNote: { marginTop: 20, padding: 14, borderRadius: 14 },
  avatarWrap: { alignSelf: "flex-start" },
  avatarImg: { width: 88, height: 88, borderRadius: 44 },
  avatarPlaceholder: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  termsRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 20,
  },
  successWrap: { flex: 1, alignItems: "center", paddingTop: 60, paddingBottom: 24 },
  successCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  successTitle: { fontSize: 24, fontWeight: "700", letterSpacing: -0.4 },
  successSub: { fontSize: 15, marginTop: 6 },
});
