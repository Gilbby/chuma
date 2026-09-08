import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Linking,
  LayoutAnimation,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/src/components/common/ScreenHeader";
import { Card } from "@/src/components/ui/Card";
import { useTheme } from "@/src/theme/ThemeContext";
import {
  MessageCircle,
  Mail,
  ChevronDown,
  ChevronUp,
} from "lucide-react-native";

const FAQS = [
  {
    id: "1",
    q: "What is village banking?",
    a: "Village banking is a community savings system where a group of people pool their money regularly, lend to each other, and share the profits at the end of a cycle. Chuma digitises this so your group can track everything transparently.",
  },
  {
    id: "2",
    q: "How do contributions work?",
    a: "Each cycle you contribute a set amount agreed by your group. Right now contributions are paid in cash and confirmed by an admin. Your savings balance grows once they confirm they have the money. Mobile money payments are paused while we finish setting up payouts.",
  },
  {
    id: "3",
    q: "How do I get a loan?",
    a: "Open the Loan screen, enter the amount and an optional reason, then submit. Your request goes to the group admins for approval. Once enough admins approve, your treasurer hands you the loan in cash. No fees are deducted, so you receive the full amount.",
  },
  {
    id: "4",
    q: "What happens if I pay late?",
    a: "Your group sets penalty rules when the group is created. If you contribute or repay late, the system automatically applies the penalty defined in your group constitution and notifies you so you can pay it.",
  },
  {
    id: "5",
    q: "What is a share-out?",
    a: "At the end of a savings cycle, the total pool plus any profit from loan interest is shared among members based on how much each person saved. The share-out calculator shows you your expected payout.",
  },
  {
    id: "6",
    q: "Is my money safe?",
    a: "Chuma records every transaction with a timestamp and an audit trail. Sensitive actions like loan approvals and withdrawals require multiple admins to approve, protecting the group from fraud.",
  },
  {
    id: "7",
    q: "What is a trust score?",
    a: "Your trust score reflects your reliability as a member: how consistently you contribute on time and repay loans. A higher score can improve your loan eligibility within your group.",
  },
];

export default function Help() {
  const { colors } = useTheme();
  const [openId, setOpenId] = useState<string | null>(null);

  const toggle = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenId((prev) => (prev === id ? null : id));
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
      testID="help-screen"
    >
      <ScreenHeader title="Help & support" subtitle="Answers to common questions" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Contact card */}
        <Card padding={0}>
          <ContactRow
            icon={<MessageCircle size={20} color={colors.primary} />}
            label="Chat on WhatsApp"
            sublabel="+91 991 711 2050"
            onPress={() => Linking.openURL("https://wa.me/919917112050")}
            colors={colors}
            testID="help-whatsapp-btn"
          />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <ContactRow
            icon={<Mail size={20} color={colors.primary} />}
            label="Email us"
            sublabel="support@chuma.app"
            onPress={() => Linking.openURL("mailto:support@chuma.app")}
            colors={colors}
            testID="help-email-btn"
          />
        </Card>

        {/* FAQ section */}
        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
          FREQUENTLY ASKED QUESTIONS
        </Text>

        {FAQS.map((item) => {
          const isOpen = openId === item.id;
          return (
            <Card key={item.id} padding={0} style={{ marginBottom: 10 }}>
              <Pressable
                onPress={() => toggle(item.id)}
                style={({ pressed }) => [styles.faqHeader, { opacity: pressed ? 0.75 : 1 }]}
                testID={`faq-item-${item.id}`}
              >
                <Text style={[styles.question, { color: colors.textMain, flex: 1, marginRight: 12 }]}>
                  {item.q}
                </Text>
                {isOpen
                  ? <ChevronUp size={18} color={colors.textMuted} />
                  : <ChevronDown size={18} color={colors.textMuted} />}
              </Pressable>
              {isOpen && (
                <View style={styles.answerWrap}>
                  <Text style={[styles.answer, { color: colors.textMuted }]}>{item.a}</Text>
                </View>
              )}
            </Card>
          );
        })}

      </ScrollView>
    </SafeAreaView>
  );
}

const ContactRow = ({
  icon,
  label,
  sublabel,
  onPress,
  colors,
  testID,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>["colors"];
  testID?: string;
}) => (
  <Pressable
    onPress={onPress}
    testID={testID}
    style={({ pressed }) => [styles.contactRow, { opacity: pressed ? 0.7 : 1 }]}
  >
    <View style={[styles.iconCircle, { backgroundColor: colors.primarySoft }]}>{icon}</View>
    <View style={{ flex: 1, marginLeft: 14 }}>
      <Text style={{ color: colors.textMain, fontWeight: "600", fontSize: 15 }}>{label}</Text>
      <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 2 }}>{sublabel}</Text>
    </View>
  </Pressable>
);

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  separator: { height: 1, marginHorizontal: 16 },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginTop: 24,
    marginBottom: 12,
  },
  faqHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  question: { fontSize: 14, fontWeight: "600" },
  answerWrap: { paddingHorizontal: 16, paddingBottom: 16 },
  answer: { fontSize: 14, lineHeight: 21, marginTop: 0 },
});
