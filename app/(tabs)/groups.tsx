import React, { useState, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { useTheme } from "@/src/theme/ThemeContext";
import { Card } from "@/src/components/ui/Card";
import { Button } from "@/src/components/ui/Button";
import { SkeletonGroup } from "@/src/components/ui";
import { ErrorState } from "@/src/components/common";
import { StatusBadge } from "@/src/components/ui/StatusBadge";
import { ProgressBar } from "@/src/components/ui/ProgressBar";
import {
  getGroups,
  acceptInvite,
  declineInvite,
  getMyInvites,
  type GroupInvite,
} from "@/src/services/groups";
import { getCurrentUser } from "@/src/utils/currentUser";
import { Group, Member, isProjectFundType } from "@/src/types";
import { formatZMW } from "@/src/utils/currency";
import { formatDate } from "@/src/utils/date";
import { invitedAgo, inviteDisplayName, pendingInvites } from "@/src/utils/invites";
import { Users, Plus, ChevronRight, Clock } from "lucide-react-native";

export default function Groups() {
  const { colors } = useTheme();
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [invites, setInvites] = useState<GroupInvite[]>([]);
  const [busyInvite, setBusyInvite] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Founding a group moves money (the month-1 fee), so it needs KYC. Ask for it
  // here rather than at signup — the user now knows why they are being asked.
  const openCreateGroup = useCallback(async () => {
    const user = await getCurrentUser<{ kyc?: { status?: string } }>();
    if (user?.kyc?.status !== "verified") {
      router.push("/kyc?return=create-group" as never);
      return;
    }
    router.push("/(modals)/create-group");
  }, [router]);

  // Invites this user's groups are still waiting on. Derived from the groups
  // themselves on every load, so it cannot be dismissed or swiped away — it
  // clears only when the invitee accepts or declines, or an admin withdraws it.
  // Counted only where the user is an admin: chasing an unanswered invite is
  // an admin job, so an ordinary member is never shown the backlog.
  const awaitingCount = useMemo(
    () =>
      groups.reduce(
        (n, g) => (g.yourRole !== "Member" ? n + pendingInvites(g).length : n),
        0
      ),
    [groups]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      // Invitations come from the groups themselves, not from notifications:
      // reading or clearing a notification must never make an invitation
      // disappear. Only accepting or declining removes one.
      const [g, inv] = await Promise.all([getGroups(), getMyInvites()]);
      setGroups(g);
      setInvites(inv);
    } catch (e) {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleRetry = () => {
    load();
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const handleAccept = useCallback(
    async (inv: GroupInvite) => {
      setBusyInvite(inv.groupId);
      try {
        const res = await acceptInvite(inv.groupId);
        await load();
        Alert.alert(
          res.alreadyMember ? "Already a member" : "Joined",
          res.alreadyMember
            ? `You're already a member of ${inv.groupName}.`
            : `You joined ${inv.groupName}.`
        );
      } catch (e: any) {
        // The invite was withdrawn while it sat on screen — refresh so the dead
        // card goes away instead of failing again on the next tap.
        if (e?.status === 404 || e?.status === 403) {
          await load();
          Alert.alert(
            "Invitation unavailable",
            e?.message || "This invitation is no longer valid."
          );
          return;
        }
        Alert.alert("Could not join", e?.message || "Please try again.");
      } finally {
        setBusyInvite(null);
      }
    },
    [load]
  );

  // Declining is final — the invitee needs a fresh invite to get back in — so
  // confirm before rejecting it.
  const confirmDecline = useCallback(
    (inv: GroupInvite) => {
      Alert.alert(
        "Decline invitation?",
        `You won't join ${inv.groupName}. They would have to invite you again.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Decline",
            style: "destructive",
            onPress: async () => {
              setBusyInvite(inv.groupId);
              try {
                await declineInvite(inv.groupId);
                await load();
              } catch (e: any) {
                Alert.alert("Could not decline", e?.message || "Please try again.");
              } finally {
                setBusyInvite(null);
              }
            },
          },
        ]
      );
    },
    [load]
  );

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
      testID="groups-screen"
    >
      <View style={styles.header}>
        <View>
          <Text style={[styles.title, { color: colors.textMain }]}>My Groups</Text>
          <Text style={[styles.sub, { color: colors.textMuted }]}>
            {groups.length} active chuma groups
            {awaitingCount > 0
              ? ` · ${awaitingCount} invite${awaitingCount === 1 ? "" : "s"} awaiting a reply`
              : ""}
          </Text>
        </View>
        <Pressable
          style={[styles.addBtn, { backgroundColor: colors.primary }]}
          onPress={openCreateGroup}
          testID="groups-add-btn"
        >
          <Plus size={20} color="#fff" strokeWidth={2.4} />
        </Pressable>
      </View>

      {loading ? (
        <View style={{ marginHorizontal: 20, marginTop: 12 }}>
          <SkeletonGroup count={4} height={120} />
        </View>
      ) : error ? (
        <ErrorState onRetry={handleRetry} />
      ) : (
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {invites.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
              PENDING INVITATIONS
            </Text>
            {invites.map((inv) => (
              <Card key={inv.groupId} padding={14} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={[styles.inviteIcon, { backgroundColor: colors.primarySoft }]}>
                    <Users size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={{ color: colors.textMain, fontWeight: "700", fontSize: 14 }}>
                      {inv.groupName}
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                      {inv.invitedBy ? `Invited by ${inv.invitedBy}` : "You've been invited"}
                      {inv.role && inv.role !== "Member" ? ` · as ${inv.role}` : ""}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Button
                      label="Decline"
                      variant="outline"
                      size="sm"
                      fullWidth={false}
                      disabled={busyInvite === inv.groupId}
                      onPress={() => confirmDecline(inv)}
                      testID={`invite-decline-${inv.groupId}`}
                    />
                    <Button
                      label="Accept"
                      variant="primary"
                      size="sm"
                      fullWidth={false}
                      disabled={busyInvite === inv.groupId}
                      onPress={() => handleAccept(inv)}
                      testID={`invite-accept-${inv.groupId}`}
                    />
                  </View>
                </View>
              </Card>
            ))}
          </>
        )}
        {groups.map((g) => (
          <Pressable
            key={g.id}
            onPress={() => router.push(`/group/${g.id}`)}
            style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}
            testID={`group-card-${g.id}`}
          >
            <Card padding={18} style={{ marginBottom: 14 }}>
              <View style={styles.rowBetween}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <View
                      style={[
                        styles.groupIcon,
                        { backgroundColor: colors.primarySoft },
                      ]}
                    >
                      <Users size={18} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={[styles.groupName, { color: colors.textMain }]} numberOfLines={1}>
                        {g.name}
                      </Text>
                      <Text
                        style={[styles.groupSub, { color: colors.textMuted }]}
                        numberOfLines={1}
                      >
                        {isProjectFundType(g.groupType)
                          ? projectSubtitle(g)
                          : `${g.contributionFrequency} · ${formatZMW(g.contributionAmount)}`}
                      </Text>
                    </View>
                  </View>
                </View>
                <ChevronRight size={20} color={colors.textMuted} />
              </View>

              <View style={styles.stats}>
                <Stat label="Pool" value={formatZMW(g.totalSavings, { compact: true })} muted={colors.textMuted} main={colors.textMain} />
                <Stat label="Members" value={String(g.memberCount)} muted={colors.textMuted} main={colors.textMain} />
                {isProjectFundType(g.groupType) ? (
                  <Stat
                    label="Projects"
                    value={String((g.projects ?? []).filter((p) => p.status === "active").length)}
                    muted={colors.textMuted}
                    main={colors.textMain}
                  />
                ) : (
                  <Stat label="Loans out" value={formatZMW(g.loanCirculation, { compact: true })} muted={colors.textMuted} main={colors.textMain} />
                )}
              </View>

              {/* A project-fund group has no cycle to be partway through —
                  its progress lives on each project, inside the group. */}
              {!isProjectFundType(g.groupType) && (
                <View style={{ marginTop: 14 }}>
                  <View style={styles.rowBetween}>
                    <Text style={[styles.cycleLabel, { color: colors.textMuted }]}>
                      Cycle progress
                    </Text>
                    <Text style={[styles.cycleValue, { color: colors.textMain }]}>
                      {Math.round(g.cycleProgress * 100)}%
                    </Text>
                  </View>
                  <View style={{ marginTop: 6 }}>
                    <ProgressBar progress={g.cycleProgress} />
                  </View>
                </View>
              )}

              <View style={{ flexDirection: "row", marginTop: 14 }}>
                <StatusBadge label={g.yourRole} variant="primary" />
                {formatDate(g.shareOutDate) ? (
                  <>
                    <View style={{ width: 8 }} />
                    <StatusBadge
                      label={`Share-out · ${formatDate(g.shareOutDate)}`}
                      variant="neutral"
                    />
                  </>
                ) : null}
              </View>

              <PendingInvitesNote group={g} colors={colors} />
            </Card>
          </Pressable>
        ))}

      </ScrollView>
      )}
    </SafeAreaView>
  );
}

/**
 * The people this group invited who still haven't answered.
 *
 * Rebuilt from the group on every load and deliberately given no dismiss
 * control: an unanswered invitation stays on the overview until someone acts on
 * it — the invitee accepts or declines, or an admin withdraws it from the
 * group's members tab (tap the card to get there).
 */
const PendingInvitesNote = ({
  group,
  colors,
}: {
  group: Group;
  colors: ReturnType<typeof useTheme>["colors"];
}) => {
  // Admins only, matching the header count above and the group's members tab:
  // chasing an unanswered invite is an admin job, and an ordinary member has
  // nothing to do about it.
  if (group.yourRole === "Member") return null;
  const pending = pendingInvites(group);
  if (pending.length === 0) return null;
  // Cap the list so one badly-behaved group can't push the next card off screen;
  // the full list lives on the group's members tab.
  const shown = pending.slice(0, 3);
  const extra = pending.length - shown.length;
  return (
    <View
      style={[
        styles.pendingBox,
        { backgroundColor: colors.warning + "14", borderColor: colors.warning + "33" },
      ]}
      testID={`group-pending-invites-${group.id}`}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Clock size={13} color={colors.warning} />
        <Text style={[styles.pendingTitle, { color: colors.warning }]}>
          {pending.length} INVITE{pending.length === 1 ? "" : "S"} AWAITING A REPLY
        </Text>
      </View>
      {shown.map((m: Member, i: number) => {
        const ago = invitedAgo(m.lastInviteSentAt ?? m.invitedAt);
        return (
          <Text
            key={m.id || m.phone || String(i)}
            style={[styles.pendingRow, { color: colors.textMuted }]}
            numberOfLines={1}
          >
            {inviteDisplayName(m)}
            {m.role && m.role !== "Member" ? ` · ${m.role}` : ""}
            {ago ? ` · sent ${ago}` : ""}
          </Text>
        );
      })}
      {extra > 0 && (
        <Text style={[styles.pendingRow, { color: colors.textMuted }]}>
          +{extra} more
        </Text>
      )}
    </View>
  );
};

/** What a project-fund group shows where a cycle group shows its dues. */
const projectSubtitle = (g: Group) => {
  const open = (g.projects ?? []).filter((p) => p.status === "active");
  if (open.length === 0) return "No open projects";
  if (open.length === 1) return `Saving for ${open[0].name}`;
  return `${open.length} projects`;
};

const Stat = ({
  label,
  value,
  main,
  muted,
}: {
  label: string;
  value: string;
  main: string;
  muted: string;
}) => (
  <View style={{ flex: 1 }}>
    <Text style={{ fontSize: 11, color: muted, fontWeight: "600", letterSpacing: 0.3 }}>
      {label}
    </Text>
    <Text style={{ fontSize: 15, fontWeight: "700", marginTop: 4, color: main }}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: { fontSize: 26, fontWeight: "700", letterSpacing: -0.5 },
  sub: { fontSize: 13, marginTop: 4 },
  addBtn: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  groupIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  groupName: { fontSize: 16, fontWeight: "700", letterSpacing: -0.2 },
  groupSub: { fontSize: 12, marginTop: 2 },
  stats: {
    flexDirection: "row",
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "transparent",
  },
  cycleLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.3 },
  cycleValue: { fontSize: 13, fontWeight: "700" },
  sectionLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2, marginBottom: 8 },
  inviteIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  pendingBox: { marginTop: 14, borderRadius: 12, borderWidth: 1, padding: 10 },
  pendingTitle: { fontSize: 10, fontWeight: "800", letterSpacing: 1, marginLeft: 6 },
  pendingRow: { fontSize: 12, marginTop: 6 },
});
