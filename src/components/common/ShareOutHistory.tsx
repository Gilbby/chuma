/**
 * The group's share-outs, on the reports tab but not part of the report.
 *
 * A share-out is a record, not a metric: "what did we each get last year" is a
 * question a savings group asks constantly, and it is answered by naming people
 * and amounts, not by a chart. So it sits below the analytics under its own
 * heading rather than in the run of report cards, where it read as one more
 * statistic. Every member sees it, not just the treasurer.
 *
 * Only the most recent few runs are listed here — the rest are one tap away on
 * the full history screen. A run opens its own breakdown rather than unfolding
 * in place: unfolding works for a group of six and collapses at thirty, burying
 * every other run with nowhere to search.
 */
import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Card } from "@/src/components/ui/Card";
import { useTheme } from "@/src/theme/ThemeContext";
import { getShareOutHistory, ShareOutRun } from "@/src/services/shareOut";
import { ShareOutRunRow } from "./ShareOutRunRow";
import { ArrowRight } from "lucide-react-native";
import { useAsyncEffect } from "@/src/hooks/useAsyncEffect";

/** How many runs the reports tab lists before handing off to the full screen. */
const PREVIEW = 3;

export function ShareOutHistory({ groupId }: { groupId?: string }) {
  const { colors } = useTheme();
  const router = useRouter();
  const [runs, setRuns] = useState<ShareOutRun[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!groupId) {
      setRuns([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setRuns(await getShareOutHistory(groupId));
    } catch {
      // A group that has never distributed is not an error, and neither is a
      // reports screen that cannot reach this one endpoint. Show nothing.
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useAsyncEffect(load);

  const shown = runs.slice(0, PREVIEW);
  const more = runs.length - shown.length;

  return (
    <View testID="shareout-history">
      <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>SHARE-OUTS</Text>
      <Card padding={20} style={{ marginTop: 8 }}>
        <Text style={[styles.cardTitle, { color: colors.textMain }]}>Past distributions</Text>
        <Text style={[styles.cardSub, { color: colors.textMuted }]}>
          Open one to see who got what
        </Text>

        {loading ? (
          <View style={{ paddingVertical: 20, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : runs.length === 0 ? (
          <Text
            style={{ color: colors.textMuted, fontSize: 13, marginTop: 14 }}
            testID="shareout-history-empty"
          >
            This group hasn&apos;t run a share-out yet. When a cycle closes, the full
            breakdown appears here.
          </Text>
        ) : (
          <View style={{ marginTop: 8 }}>
            {shown.map((run, i) => (
              <ShareOutRunRow
                key={run.shareOutId}
                run={run}
                groupId={groupId}
                divider={i > 0}
              />
            ))}

            {more > 0 ? (
              <Pressable
                onPress={() =>
                  router.push(`/share-out-history?groupId=${groupId}` as never)
                }
                testID="shareout-history-see-all"
                style={({ pressed }) => [
                  styles.seeAll,
                  { borderTopColor: colors.border, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13 }}>
                  {`See all ${runs.length} share-outs`}
                </Text>
                <ArrowRight size={15} color={colors.primary} strokeWidth={2.4} />
              </Pressable>
            ) : null}
          </View>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6 },
  cardTitle: { fontSize: 16, fontWeight: "700", letterSpacing: -0.2 },
  cardSub: { fontSize: 12, marginTop: 4 },
  seeAll: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    paddingTop: 14,
    marginTop: 2,
  },
});
