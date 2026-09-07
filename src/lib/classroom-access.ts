/**
 * Decides whether one student may enter one classroom.
 *
 * Server-only: it uses the Supabase service role key and must never be
 * imported from a component. Both classroom server functions call it through
 * `await import()` inside their handlers, which is what keeps it out of the
 * client bundle.
 *
 * It lives on its own because two entry points need the identical answer — the
 * page load that renders the header, and the call that opens a Cloudflare
 * session. If those two ever disagreed, the UI would show a room the media
 * layer refuses to join.
 */
export async function authorizeClassroomAccess(accessToken: string, classId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Identify the caller from their JWT rather than trusting a body field,
  // which anyone could change.
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
  const user = userData?.user;
  if (userErr || !user) throw new Error("Not signed in.");

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("name, suspended_until, onboarded_at, course_slug, year")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.suspended_until && new Date(profile.suspended_until).getTime() > Date.now()) {
    throw new Error("Your account is suspended.");
  }
  if (!profile?.onboarded_at) throw new Error("Finish setting up your profile first.");

  const { data: classroom } = await supabaseAdmin
    .from("classrooms")
    .select("id, room_number, subject_slug, capacity, subjects(name)")
    .eq("id", classId)
    .maybeSingle();
  if (!classroom) throw new Error("That classroom does not exist.");

  // Moderators and admins are the teachers; they may enter any room.
  const [{ data: isAdmin }, { data: isMod }] = await Promise.all([
    supabaseAdmin.rpc("has_role", { _user_id: user.id, _role: "admin" }),
    supabaseAdmin.rpc("has_role", { _user_id: user.id, _role: "moderator" }),
  ]);
  const isModerator = Boolean(isAdmin || isMod);

  if (!isModerator) {
    const year = Math.max(1, parseInt(profile.year ?? "1", 10) || 1);
    const { data: allowed } = profile.course_slug
      ? await supabaseAdmin.rpc("get_course_subjects", {
          _course_slug: profile.course_slug,
          _year: year,
        })
      : { data: null };
    const canJoin = (allowed ?? []).some(
      (s: { slug: string }) => s.slug === classroom.subject_slug,
    );
    if (!canJoin) throw new Error("This classroom is not on your course.");
  }

  const subjectName = (classroom.subjects as { name: string } | null)?.name ?? "Classroom";

  return {
    userId: user.id,
    classroomId: classroom.id,
    isModerator,
    displayName: profile.name?.trim() || "Student",
    title: `${subjectName} · Room ${classroom.room_number}`,
    capacity: classroom.capacity as number,
  };
}
