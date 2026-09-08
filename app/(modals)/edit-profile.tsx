import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Alert,
  Platform,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { ScreenHeader } from "@/src/components/common/ScreenHeader";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { useTheme } from "@/src/theme/ThemeContext";
import { getCurrentUser } from "@/src/utils/currentUser";
import { updateProfile } from "@/src/services/auth";
import { Camera, Check, ChevronDown } from "lucide-react-native";
import { useRouter } from "expo-router";

const PAYMENT_METHODS = [
  "MTN MoMo",
  "Airtel Money",
  "Zamtel Kwacha",
  "Bank Transfer",
  "Cash",
] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const WALLET_METHODS: PaymentMethod[] = ["MTN MoMo", "Airtel Money", "Zamtel Kwacha"];

export default function EditProfile() {
  const { colors } = useTheme();
  const router = useRouter();
  const [me, setMe] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [preferredMethod, setPreferredMethod] = useState<PaymentMethod>("Airtel Money");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [nameError, setNameError] = useState("");
  // A KYC-verified name comes from the identity document (chairpersons), so
  // the server rejects edits to it — mirror that here instead of failing on save.
  const nameLocked = me?.kyc?.status === "verified";
  const [accountNameError, setAccountNameError] = useState("");
  const [accountNumberError, setAccountNumberError] = useState("");

  // Load the current user on mount and seed the form from it in the same pass.
  // Seeding in a separate effect keyed on [me] would render twice per fetch.
  useEffect(() => {
    let active = true;
    (async () => {
      const user: any = await getCurrentUser();
      if (!active) return;
      setMe(user);
      setName(user?.name ?? "");
      setAvatar(user?.avatar ?? "");
      setAccountName(user?.preferredPayment?.accountName ?? user?.name ?? "");
      setAccountNumber(user?.preferredPayment?.accountNumber ?? user?.phone ?? "");
      const method = user?.preferredPayment?.method;
      if (method && (PAYMENT_METHODS as readonly string[]).includes(method)) {
        setPreferredMethod(method as PaymentMethod);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const isWallet = (WALLET_METHODS as PaymentMethod[]).includes(preferredMethod);
  const isCash = preferredMethod === "Cash";

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) {
      setAvatar(result.assets[0].uri);
    }
  };

  const handleSelectMethod = (m: PaymentMethod) => {
    setPreferredMethod(m);
    setPickerOpen(false);
    if (m === "Bank Transfer" && accountNumber === me?.phone) {
      setAccountNumber("");
    } else if ((WALLET_METHODS as PaymentMethod[]).includes(m) && accountNumber === "") {
      setAccountNumber(me?.phone ?? "");
    }
  };

  const handleSave = async () => {
    let valid = true;
    if (!name.trim()) {
      setNameError("Name is required");
      valid = false;
    } else {
      setNameError("");
    }
    if (!isCash) {
      if (!accountName.trim()) {
        setAccountNameError("Account holder name is required");
        valid = false;
      } else {
        setAccountNameError("");
      }
      if (!accountNumber.trim()) {
        setAccountNumberError(
          isWallet ? "Wallet number is required" : "Account number is required"
        );
        valid = false;
      } else {
        setAccountNumberError("");
      }
    }
    if (!valid) return;
    setSaving(true);
    try {
      await updateProfile({
        name: name.trim(),
        avatar,
        preferredPayment: { method: preferredMethod, accountName, accountNumber },
      });
      Alert.alert("Profile updated", "Your changes have been saved.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert("Update failed", e?.message || "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !me) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: colors.background }}
        edges={["top"]}
        testID="edit-profile-screen"
      >
        <ScreenHeader title="Edit profile" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
      testID="edit-profile-screen"
    >
      <ScreenHeader title="Edit profile" />
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Section 1 — Photo */}
            <View style={styles.avatarSection}>
              <Pressable onPress={pickImage} testID="edit-profile-avatar-btn">
                <View style={{ position: "relative" }}>
                  <Image source={{ uri: avatar }} style={styles.avatar} />
                  <View style={[styles.cameraBadge, { backgroundColor: colors.primary }]}>
                    <Camera size={14} color="#fff" />
                  </View>
                </View>
              </Pressable>
              <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 8 }}>
                Tap to change photo
              </Text>
            </View>

            {/* Section 2 — Name */}
            <Text style={[styles.label, { color: colors.textMuted }]}>FULL NAME{nameLocked ? " (VERIFIED)" : ""}</Text>
            <TextInput
              style={[
                styles.inputField,
                {
                  color: colors.textMain,
                  backgroundColor: colors.surface,
                  borderColor: nameError ? colors.danger : colors.border,
                },
              ]}
              value={name}
              onChangeText={(t) => { setName(t); if (nameError) setNameError(""); }}
              placeholder="Your full name"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
              editable={!nameLocked}
              testID="edit-profile-name-input"
            />
            {nameError ? (
              <Text style={[styles.errText, { color: colors.danger }]}>{nameError}</Text>
            ) : null}
            {nameLocked ? (
              <Text style={[styles.errText, { color: colors.textMuted }]}>
                Taken from your verified ID. This one can&apos;t be changed.
              </Text>
            ) : null}

            {/* Phone — login identity, not editable */}
            <Text style={[styles.label, { color: colors.textMuted, marginTop: 20 }]}>
              PHONE NUMBER
            </Text>
            <View
              style={[
                styles.inputField,
                {
                  backgroundColor: colors.surfaceSecondary,
                  borderColor: colors.border,
                  justifyContent: "center",
                },
              ]}
            >
              <Text style={{ color: colors.textMuted, fontSize: 15, fontWeight: "500" }}>
                {me.phone}
              </Text>
            </View>
            <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 6, lineHeight: 16 }}>
              Your login number can&apos;t be changed here.
            </Text>

            {/* Section 3 — Preferred payment method */}
            <Text style={[styles.label, { color: colors.textMuted, marginTop: 20 }]}>
              PREFERRED PAYMENT METHOD
            </Text>
            <Pressable
              onPress={() => setPickerOpen((s) => !s)}
              testID="edit-profile-payment-picker"
              style={({ pressed }) => [
                styles.pickerRow,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={{ color: colors.textMain, fontSize: 15, fontWeight: "500" }}>
                {preferredMethod}
              </Text>
              <ChevronDown size={20} color={colors.textMuted} />
            </Pressable>
            {pickerOpen && (
              <Card padding={4} style={{ marginTop: 8 }}>
                {PAYMENT_METHODS.map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => handleSelectMethod(m)}
                    style={({ pressed }) => [
                      styles.option,
                      { backgroundColor: pressed ? colors.surfaceSecondary : "transparent" },
                    ]}
                  >
                    <Text style={{ color: colors.textMain, fontWeight: "500", flex: 1 }}>{m}</Text>
                    {m === preferredMethod && <Check size={18} color={colors.primary} />}
                  </Pressable>
                ))}
              </Card>
            )}

            {isCash ? (
              <Text
                style={{
                  color: colors.textMuted,
                  fontSize: 12,
                  fontStyle: "italic",
                  marginTop: 14,
                  lineHeight: 18,
                }}
              >
                Cash is recorded manually by your group admin, no account details needed.
              </Text>
            ) : (
              <>
                {/* Account holder name */}
                <Text style={[styles.label, { color: colors.textMuted, marginTop: 20 }]}>
                  ACCOUNT HOLDER NAME
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 11, marginBottom: 8, lineHeight: 16 }}>
                  Must match the name on your NRC and the registered wallet or bank account
                </Text>
                <TextInput
                  style={[
                    styles.inputField,
                    {
                      color: colors.textMain,
                      backgroundColor: colors.surface,
                      borderColor: accountNameError ? colors.danger : colors.border,
                    },
                  ]}
                  value={accountName}
                  onChangeText={(t) => { setAccountName(t); if (accountNameError) setAccountNameError(""); }}
                  placeholder="Full legal name"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="words"
                  testID="edit-profile-account-name-input"
                />
                {accountNameError ? (
                  <Text style={[styles.errText, { color: colors.danger }]}>{accountNameError}</Text>
                ) : null}

                {/* Account number / wallet number */}
                <Text style={[styles.label, { color: colors.textMuted, marginTop: 20 }]}>
                  {isWallet ? "WALLET NUMBER" : "ACCOUNT NUMBER"}
                </Text>
                <TextInput
                  style={[
                    styles.inputField,
                    {
                      color: colors.textMain,
                      backgroundColor: isWallet ? colors.surfaceSecondary : colors.surface,
                      borderColor: accountNumberError ? colors.danger : colors.border,
                    },
                  ]}
                  value={accountNumber}
                  onChangeText={(t) => { setAccountNumber(t); if (accountNumberError) setAccountNumberError(""); }}
                  placeholder={isWallet ? "+260 9XX XXX XXX" : "Enter account number"}
                  placeholderTextColor={colors.textMuted}
                  keyboardType={isWallet ? "phone-pad" : "numeric"}
                  editable={!isWallet}
                  testID="edit-profile-account-number-input"
                />
                {accountNumberError ? (
                  <Text style={[styles.errText, { color: colors.danger }]}>{accountNumberError}</Text>
                ) : null}
                {isWallet && (
                  <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 6, lineHeight: 16 }}>
                    Defaults to your registered number. Edit if your wallet uses a different number.
                  </Text>
                )}

                {/* Validation info card */}
                <View style={[styles.infoCard, { backgroundColor: colors.primarySoft }]}>
                  <Text style={{ color: colors.primary, fontSize: 12, lineHeight: 18 }}>
                    This account must be registered in your name for contributions and payouts to be verified.
                  </Text>
                </View>
              </>
            )}

            <View style={{ height: 32 }} />
            <Button
              label="Save changes"
              onPress={handleSave}
              loading={saving}
              disabled={saving}
              testID="edit-profile-save-btn"
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 32 },
  avatarSection: { alignItems: "center", paddingVertical: 24 },
  avatar: { width: 96, height: 96, borderRadius: 48 },
  cameraBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2, marginBottom: 8 },
  inputField: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    fontWeight: "500",
  },
  errText: { fontSize: 12, marginTop: 6, fontWeight: "500" },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderRadius: 14,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 12,
  },
  infoCard: {
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
  },
});
