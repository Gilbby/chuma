/**
 * Every share-out the group has ever run, newest first.
 *
 * The reports tab lists only the last few. A group four cycles in has a record
 * older than that, and "what did I get in 2023" is exactly the question this
 * screen exists to answer — so the full list gets its own scroll, with the
 * running total of everything the group has ever paid out at the top.
 */
import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { ScreenHeader, ErrorState } from "@/src/components/common";
import { ShareOutRunRow } from "@/src/components/common/ShareOutRunRow";
import { Card } from "@/src/components/ui/Card";
import { useTheme } from "@/src/theme/ThemeContext";
import { getShareOutHistory, ShareOutRun } from "@/src/services/shareOut";
import { formatZMW } from "@/src/utils/currency";
import { useAsyncEffect } from "@/src/hooks/useAsyncEffect";

/** Deep enough to be the whole record for any realistic group. */
const LIMIT = 100;

export default function ShareOutHistoryScreen() {
  const { colors } = useTheme();
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();

  const [runs, setRuns] = useState<ShareOutRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!groupId) {
      setFailed(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailed(false);
    try {
      setRuns(await getShareOutHistory(groupId, LIMIT));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useAsyncEffect(load);

  const totalDistributed = runs.reduce((s, r) => s + r.totalPaid, 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScreenHeader
        title="Share-outs"
        subtitle={
          runs.length
            ? `${runs.length} distribution${runs.length === 1 ? "" : "s"}`
            : undefined
        }
        testID="shareout-history-header"
      />

      {loading ? (
        <View style={{ paddingVertical: 48, alignItems: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : failed ? (
        <ErrorState message="Couldn't load share-out history. Please try again." onRetry={load} />
      ) : (
        <FlatList
          data={runs}
          keyExtractor={(r) => r.shareOutId}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
          testID="shareout-history-list"
          ListHeaderComponent={
            runs.length ? (
              <View>
                <Card padding={20}>
                  <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "600", letterSpacing: 0.3 }}>
                    DISTRIBUTED ALL TIME
                  </Text>
                  <Text
                    style={{ color: colors.textMain, fontSize: 30, fontWeight: "700", letterSpacing: -0.6, marginTop: 4 }}
                    testID="shareout-history-total"
                  >
                    {formatZMW(totalDistributed)}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 6 }}>
                    {`Across ${runs.length} share-out${runs.length === 1 ? "" : "s"}`}
                  </Text>
                </Card>
                <Text style={[styles.listLabel, { color: colors.textMuted }]}>
                  EVERY SHARE-OUT
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <Text
              style={{ color: colors.textMuted, fontSize: 13, marginTop: 24 }}
              testID="shareout-history-list-empty"
            >
              This group hasn&apos;t run a share-out yet.
            </Text>
          }
          renderItem={({ item }) => (
            <View style={[styles.rowWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <ShareOutRunRow run={item} groupId={groupId} divider={false} />
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  listLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    marginTop: 20,
    marginBottom: 8,
  },
  rowWrap: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
});
