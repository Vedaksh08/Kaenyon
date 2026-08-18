import { supabase } from "@/integrations/supabase/client";

export interface FriendRow {
  friend_id: string;
  name: string | null;
  avatar_url: string | null;
  college: string | null;
  course: string | null;
  year: string | null;
  status: "pending" | "accepted" | "declined";
  direction: "incoming" | "outgoing";
  online: boolean;
  subject_name: string | null;
  classroom_id: string | null;
  room_number: number | null;
}

export interface LeaderRow {
  user_id: string;
  name: string | null;
  avatar_url: string | null;
  course: string | null;
  solved: number;
  avg_rating: number;
  /** How many ratings the average is built from — 9.0 from one person is not
   *  the same claim as 9.0 from twenty. */
  ratings_count: number;
}

export interface MyStats {
  doubts_asked: number;
  /** Times you offered to help. */
  answers_given: number;
  /** Times someone confirmed you actually helped. This is what ranks you. */
  solved: number;
  friends: number;
  avg_rating: number;
  ratings_count: number;
  rank: number;
}

export async function fetchFriends(userId: string): Promise<FriendRow[]> {
  const { data, error } = await supabase.rpc("get_friends", { _user_id: userId });
  if (error) throw error;
  return (data ?? []) as unknown as FriendRow[];
}

export async function fetchLeaderboard(limit = 25): Promise<LeaderRow[]> {
  const { data, error } = await supabase.rpc("get_leaderboard", { _limit: limit });
  if (error) throw error;
  return (data ?? []) as unknown as LeaderRow[];
}

export async function fetchMyStats(userId: string): Promise<MyStats | null> {
  const { data, error } = await supabase.rpc("get_my_stats", { _user_id: userId });
  if (error) throw error;
  const row = (data as unknown as MyStats[])?.[0];
  return row ?? null;
}

/** Send (or re-send) a friend request. Returns a user-facing message. */
export async function sendFriendRequest(targetId: string): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const me = userData.user?.id;
  if (!me) throw new Error("Sign in required");
  if (me === targetId) throw new Error("You can't add yourself");

  // Existing relation in either direction?
  const { data: existing } = await supabase
    .from("friendships")
    .select("id, requester_id, addressee_id, status")
    .or(
      `and(requester_id.eq.${me},addressee_id.eq.${targetId}),and(requester_id.eq.${targetId},addressee_id.eq.${me})`,
    )
    .maybeSingle();

  if (existing) {
    if (existing.status === "accepted") return "You are already friends";
    if (existing.requester_id === me) return "Friend request already sent";
    // They requested us -> accept it.
    await supabase.from("friendships").update({ status: "accepted" }).eq("id", existing.id);
    return "Friend request accepted";
  }

  const { error } = await supabase
    .from("friendships")
    .insert({ requester_id: me, addressee_id: targetId, status: "pending" });
  if (error) throw error;
  return "Friend request sent";
}

export async function respondToRequest(friendId: string, accept: boolean) {
  const { data: userData } = await supabase.auth.getUser();
  const me = userData.user?.id;
  if (!me) throw new Error("Sign in required");
  const { error } = await supabase
    .from("friendships")
    .update({ status: accept ? "accepted" : "declined" })
    .eq("requester_id", friendId)
    .eq("addressee_id", me);
  if (error) throw error;
}

export async function removeFriend(friendId: string) {
  const { data: userData } = await supabase.auth.getUser();
  const me = userData.user?.id;
  if (!me) return;
  await supabase
    .from("friendships")
    .delete()
    .or(
      `and(requester_id.eq.${me},addressee_id.eq.${friendId}),and(requester_id.eq.${friendId},addressee_id.eq.${me})`,
    );
}

/** Publish "I'm in this classroom right now" so friends see live status. */
export async function markPresence(
  userId: string,
  classroomId: string | null,
  subjectSlug: string | null,
) {
  await supabase.from("user_presence").upsert(
    {
      user_id: userId,
      classroom_id: classroomId,
      subject_slug: subjectSlug,
      last_seen: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
}

export async function clearPresence(userId: string) {
  await supabase.from("user_presence").delete().eq("user_id", userId);
}
