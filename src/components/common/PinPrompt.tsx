import React, { useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Delete, X } from "lucide-react-native";
import { useTheme } from "@/src/theme/ThemeContext";
import { verifyPin } from "@/src/services/auth";
import type { ApiError } from "@/src/services/apiClient";

const LEN = 4;

type Props = {
  visible: boolean;
  title?: string;
  subtitle?: string;
  /** Correct PIN entered. */
  onSuccess: () => void;
  onCancel: () => void;
  /**
   * The account has no PIN to check against (they skipped that step). The
   * caller decides what that means — locking someone out of their own screen
   * over a PIN they were never asked to set would be worse than letting them
   * through.
   */
  onNoPin?: () => void;
  testID?: string;
};

/**
 * Asks for the app PIN and verifies it server-side. Used wherever a screen
 * needs proof of identity without sending the user off to another route.
 */
export function PinPrompt({
  visible,
  title = "Enter your PIN",
  subtitle = "Confirm it's you to continue.",
  onSuccess,
  onCancel,
  onNoPin,
  testID = "pin-prompt",
}: Props) {
  const { colors } = useTheme();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Never reopen holding the last attempt's digits or error. Adjusted during
  // render on the transition into visible, so the reset is part of the opening
  // render instead of a second one right after it.
  const [prevVisible, setPrevVisible] = useState(visible);
  if (prevVisible !== visible) {
    setPrevVisible(visible);
    if (visible) {
      setPin("");
      setError("");
      setLoading(false);
    }
  }

  const submit = async (code: string) => {
    setLoading(true);
    setError("");
    try {
      if (await verifyPin(code)) {
        onSuccess();
        return;
      }
      setError("Incorrect PIN");
      setPin("");
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "no_pin") {
        if (onNoPin) onNoPin();
        else onSuccess();
        return;
      }
      setError(
        err.status === 404
          ? // The endpoint ships with chuma-api; an older deployment 404s here.
            "PIN check needs the latest server update."
          : err.message || "Could not check your PIN. Try again.",
      );
      setPin("");
    } finally {
      setLoading(false);
    }
  };

  const onKey = (k: string) => {
    if (loading) return;
    setError("");
    if (k === "del") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (pin.length >= LEN) return;
    const next = pin + k;
    setPin(next);
    if (next.length === LEN) setTimeout(() => submit(next), 120);
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.background }]} testID={testID}>
          <View style={styles.sheetHeader}>
            <Text style={[styles.title, { color: colors.textMain }]}>{title}</Text>
            <Pressable onPress={onCancel} hitSlop={12} testID={`${testID}-cancel`}>
              <X size={22} color={colors.textMuted} />
            </Pressable>
          </View>
          <Text style={[styles.sub, { color: colors.textMuted }]}>{subtitle}</Text>

          <View style={styles.dots}>
            {Array.from({ length: LEN }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  {
                    backgroundColor: i < pin.length ? colors.primary : "transparent",
                    borderColor: i < pin.length ? colors.primary : colors.borderStrong,
                  },
                ]}
              />
            ))}
          </View>

          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 12, height: 18 }} />
          ) : error ? (
            <Text style={[styles.error, { color: colors.danger }]} testID={`${testID}-error`}>
              {error}
            </Text>
          ) : (
            <View style={{ height: 18, marginTop: 12 }} />
          )}

          <View style={styles.keypad}>
            {keys.map((k, i) => (
              <Pressable
                key={i}
                testID={k ? `${testID}-key-${k}` : `${testID}-key-empty-${i}`}
                onPress={() => k && onKey(k)}
                disabled={!k || loading}
                style={({ pressed }) => [
                  styles.key,
                  {
                    backgroundColor:
                      k && pressed ? colors.surfaceSecondary : "transparent",
                  },
                ]}
              >
                {k === "del" ? (
                  <Delete size={22} color={colors.textMain} />
                ) : (
                  <Text style={[styles.keyText, { color: colors.textMain }]}>{k}</Text>
                )}
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 28,
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 20, fontWeight: "700", letterSpacing: -0.3 },
  sub: { fontSize: 14, marginTop: 6, lineHeight: 20 },
  dots: { flexDirection: "row", justifyContent: "center", marginTop: 24, gap: 16 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5 },
  error: { textAlign: "center", marginTop: 12, fontSize: 13, fontWeight: "500", height: 18 },
  keypad: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginTop: 16,
  },
  key: {
    width: "32%",
    height: 62,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  keyText: { fontSize: 26, fontWeight: "600" },
});
