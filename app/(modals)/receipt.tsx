import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Platform,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScreenHeader } from "@/src/components/common/ScreenHeader";
import { Button } from "@/src/components/ui/Button";
import { useTheme } from "@/src/theme/ThemeContext";
import { formatZMW } from "@/src/utils/currency";
import { CHUMA_LOGO_DATA_URI, printOrShareHtml } from "@/src/utils/exports";
import {
  CheckCircle2,
  Download,
  Share2,
  Copy,
  PiggyBank,
  Banknote,
  RefreshCw,
  Gift,
  Wallet,
} from "lucide-react-native";

const TYPE_ICONS = {
  contribution: PiggyBank,
  loan: Banknote,
  repayment: RefreshCw,
  "share-out": Gift,
  withdrawal: Wallet,
};

interface ReceiptParams {
  id?: string;
  amount?: string;
  type?: string;
  group?: string;
  date?: string;
  note?: string;
  txnId?: string;
  status?: string;
  direction?: string;
}

export default function ReceiptScreen() {
  const { colors, mode } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams() as ReceiptParams;

  // Generated once, not per render, so a receipt opened without a txnId keeps a
  // stable number instead of a new one each time params change.
  const [fallbackTxnId] = useState(() => `CHM-${Date.now().toString().slice(-8)}`);

  // Build the receipt entirely from params — callers pass all needed data.
  const data = useMemo(() => {
    const txnId = params.txnId
      ? params.txnId
      : params.id
        ? `CHM-${params.id.toUpperCase()}-${(2026 + parseInt(params.id.replace(/\D/g, "") || "0", 10)) % 99999}`
        : fallbackTxnId;
    return {
      amount: parseFloat(params.amount ?? "0"),
      type: (params.type ?? "contribution") as keyof typeof TYPE_ICONS,
      groupName: params.group ?? "Lusaka Market Sisters",
      date: params.date ?? new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }),
      note: params.note ?? "",
      status: (params.status ?? "completed") as "completed" | "pending" | "failed",
      direction: (params.direction ?? "out") as "in" | "out",
      txnId,
    };
  }, [params, fallbackTxnId]);

  const Icon = TYPE_ICONS[data.type as keyof typeof TYPE_ICONS] ?? PiggyBank;
  const typeLabel =
    data.type === "share-out"
      ? "Share-out"
      : data.type.charAt(0).toUpperCase() + data.type.slice(1);

  const buildHtml = () => {
    const isIn = data.direction === "in";
    return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { margin: 24px; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #064E3B; background: #fff; }
  .wrap { max-width: 520px; margin: 0 auto; }
  .header { background: #0A5C36; color: #fff; padding: 28px; border-radius: 20px 20px 0 0; }
  .brand { display:flex; align-items:center; gap:12px; margin-bottom: 18px; }
  .logo { width: 36px; height: 36px; border-radius: 11px; background: rgba(255,255,255,0.18); border: 1px solid rgba(255,255,255,0.45); display:inline-flex; align-items:center; justify-content:center; }
  .brand-name { font-size: 18px; font-weight: 700; letter-spacing: -0.3px; }
  .label { font-size: 11px; font-weight: 600; letter-spacing: 1.4px; color: rgba(255,255,255,0.75); text-transform: uppercase; }
  .amount { font-size: 38px; font-weight: 800; letter-spacing: -1px; margin-top: 6px; }
  .body { background: #fff; border: 1px solid #E5E7EB; border-top: 0; padding: 26px 28px; border-radius: 0 0 20px 20px; }
  .row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #F3F5F4; }
  .row:last-child { border-bottom: 0; }
  .row .k { color: #6B7280; font-size: 13px; }
  .row .v { color: #064E3B; font-weight: 600; font-size: 14px; max-width: 60%; text-align: right; }
  .status { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }
  .status.completed { background: #D1FAE5; color: #059669; }
  .status.pending { background: #FEF3C7; color: #B45309; }
  .status.failed { background: #FEE2E2; color: #DC2626; }
  .foot { margin-top: 22px; text-align: center; color: #9CA3AF; font-size: 11px; line-height: 18px; }
  .id { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; color: #6B7280; letter-spacing: 0.5px; }
  .stamp { display:inline-block; margin-top: 10px; border: 2px solid #10B981; color: #10B981; padding: 6px 12px; border-radius: 6px; font-weight: 800; letter-spacing: 1.5px; transform: rotate(-6deg); font-size: 12px; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="brand">
        <span class="logo"><img src="${CHUMA_LOGO_DATA_URI}" style="width:24px;height:24px;" /></span>
        <span class="brand-name">Chuma</span>
      </div>
      <div class="label">${typeLabel} receipt</div>
      <div class="amount">${isIn ? "+" : "−"} ${formatZMW(data.amount)}</div>
    </div>
    <div class="body">
      <div class="row"><span class="k">Status</span><span class="v"><span class="status ${data.status}">${data.status}</span></span></div>
      <div class="row"><span class="k">Transaction ID</span><span class="v id">${data.txnId}</span></div>
      <div class="row"><span class="k">Type</span><span class="v">${typeLabel}</span></div>
      <div class="row"><span class="k">Group</span><span class="v">${data.groupName}</span></div>
      <div class="row"><span class="k">Date</span><span class="v">${data.date}</span></div>
      ${data.note ? `<div class="row"><span class="k">Note</span><span class="v">${data.note}</span></div>` : ""}
      <div class="row"><span class="k">Member</span><span class="v">Gilbert · +260 977 234 567</span></div>
      ${data.status === "completed" ? '<div style="text-align:center;"><span class="stamp">PAID</span></div>' : ""}
      <div class="foot">
        This is an official Chuma receipt.<br />
        Community Chuma, Digitally.<br /><br />
        Verify at chuma.app · ${new Date().getFullYear()}
      </div>
    </div>
  </div>
</body>
</html>`;
  };

  const onShare = () => printOrShareHtml(buildHtml(), `Chuma receipt · ${typeLabel}`);

  const onCopyId = () => {
    // simple feedback alert (avoid clipboard dependency)
    Alert.alert("Transaction ID", data.txnId);
  };

  const statusColor =
    data.status === "completed" ? colors.success : data.status === "pending" ? colors.warning : colors.danger;
  const statusBg =
    data.status === "completed"
      ? mode === "light" ? "#D1FAE5" : "#0D3D2C"
      : data.status === "pending"
        ? mode === "light" ? "#FEF3C7" : "#3D2F0E"
        : mode === "light" ? "#FEE2E2" : "#3F1414";

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
      testID="receipt-screen"
    >
      <ScreenHeader
        title="Receipt"
        subtitle={typeLabel}
        rightAction={
          <Pressable onPress={onShare} hitSlop={10} testID="receipt-header-share">
            <Share2 size={20} color={colors.primary} />
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Receipt card */}
        <View style={[styles.receipt, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {/* Top emerald band */}
          <View style={[styles.band, { backgroundColor: colors.primary }]}>
            <View style={styles.brand}>
              <View style={styles.logoSm}>
                <Image
                  source={require("@/assets/images/logo-mark.png")}
                  style={{ width: 24, height: 24 }}
                  resizeMode="contain"
                />
              </View>
              <Text style={styles.brandName}>Chuma</Text>
            </View>
            <Text style={styles.bandLabel}>{typeLabel.toUpperCase()} RECEIPT</Text>
            <Text style={styles.bandAmount}>
              {data.direction === "in" ? "+" : "−"} {formatZMW(data.amount)}
            </Text>
            {data.status === "completed" ? (
              <View style={styles.stamp}>
                <CheckCircle2 size={14} color="#10B981" />
                <Text style={styles.stampText}>PAID</Text>
              </View>
            ) : null}
          </View>

          {/* Perforation */}
          <View style={styles.perforation}>
            <View style={[styles.notchL, { backgroundColor: colors.background }]} />
            <View style={styles.dottedRow}>
              {Array.from({ length: 30 }).map((_, i) => (
                <View key={i} style={[styles.dot, { backgroundColor: colors.borderStrong }]} />
              ))}
            </View>
            <View style={[styles.notchR, { backgroundColor: colors.background }]} />
          </View>

          {/* Details */}
          <View style={{ padding: 22 }}>
            <Row k="Status" colors={colors}>
              <View style={[styles.badge, { backgroundColor: statusBg }]}>
                <Text style={{ color: statusColor, fontSize: 11, fontWeight: "700", letterSpacing: 0.5 }}>
                  {data.status.toUpperCase()}
                </Text>
              </View>
            </Row>
            <Row k="Transaction ID" colors={colors}>
              <Pressable onPress={onCopyId} style={{ flexDirection: "row", alignItems: "center" }} testID="receipt-copy-id">
                <Text style={[styles.mono, { color: colors.textMain }]}>{data.txnId}</Text>
                <Copy size={12} color={colors.textMuted} style={{ marginLeft: 6 }} />
              </Pressable>
            </Row>
            <Row k="Type" colors={colors}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Icon size={14} color={colors.primary} />
                <Text style={[styles.val, { color: colors.textMain, marginLeft: 6 }]}>{typeLabel}</Text>
              </View>
            </Row>
            <Row k="Group" colors={colors}>
              <Text style={[styles.val, { color: colors.textMain }]}>{data.groupName}</Text>
            </Row>
            <Row k="Date" colors={colors}>
              <Text style={[styles.val, { color: colors.textMain }]}>{data.date}</Text>
            </Row>
            {data.note ? (
              <Row k="Note" colors={colors}>
                <Text style={[styles.val, { color: colors.textMain }]}>{data.note}</Text>
              </Row>
            ) : null}
            <Row k="Member" colors={colors} last>
              <Text style={[styles.val, { color: colors.textMain }]}>Gilbert · +260 977 234 567</Text>
            </Row>
          </View>

          {/* Footer */}
          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <Text style={{ color: colors.textMuted, fontSize: 11, textAlign: "center", lineHeight: 16 }}>
              This is an official Chuma receipt.{"\n"}
              Verify at chuma.app · Community Chuma, Digitally.
            </Text>
          </View>
        </View>

        {/* Actions */}
        <View style={{ marginTop: 20 }}>
          <Button
            label={Platform.OS === "web" ? "Open & print PDF" : "Share as PDF"}
            icon={<Download size={18} color="#fff" />}
            onPress={onShare}
            testID="receipt-share-btn"
          />
          <View style={{ height: 10 }} />
          <Button
            label="Done"
            variant="outline"
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))}
            testID="receipt-done-btn"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const Row = ({
  k,
  children,
  colors,
  last,
}: {
  k: string;
  children: React.ReactNode;
  colors: ReturnType<typeof useTheme>["colors"];
  last?: boolean;
}) => (
  <View
    style={[
      styles.row,
      !last && { borderBottomWidth: 1, borderBottomColor: colors.border },
    ]}
  >
    <Text style={{ color: colors.textMuted, fontSize: 13 }}>{k}</Text>
    <View style={{ maxWidth: "62%", alignItems: "flex-end" }}>{children}</View>
  </View>
);

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingBottom: 32 },
  receipt: {
    borderRadius: 24,
    borderWidth: 1,
    overflow: "hidden",
  },
  band: {
    padding: 24,
    paddingBottom: 28,
  },
  brand: { flexDirection: "row", alignItems: "center", marginBottom: 18 },
  logoSm: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.45)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  brandName: { color: "#fff", fontSize: 18, fontWeight: "700", letterSpacing: -0.3 },
  bandLabel: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
  },
  bandAmount: {
    color: "#fff",
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: -0.8,
    marginTop: 6,
  },
  stamp: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1.5,
    borderColor: "#10B981",
    backgroundColor: "rgba(16,185,129,0.12)",
    borderRadius: 6,
    marginTop: 14,
    transform: [{ rotate: "-4deg" }],
    gap: 6,
  },
  stampText: {
    color: "#10B981",
    fontWeight: "800",
    letterSpacing: 1.6,
    fontSize: 11,
    marginLeft: 4,
  },
  perforation: {
    height: 24,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
  },
  notchL: {
    position: "absolute",
    left: -12,
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  notchR: {
    position: "absolute",
    right: -12,
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  dottedRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
  },
  dot: {
    width: 4,
    height: 1.5,
    borderRadius: 1,
  },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12 },
  val: { fontSize: 14, fontWeight: "600" },
  mono: { fontSize: 12, fontWeight: "700", letterSpacing: 0.5 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  footer: { paddingHorizontal: 22, paddingVertical: 16, borderTopWidth: 1 },
});
