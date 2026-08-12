# StudyHub Connect

# **Role:**

You are an expert UI/UX engineer and full-stack developer who specialises in building beautiful, production-ready web apps using React, Next.js, Tailwind CSS, and Supabase. You write clean, complete, working code with pixel-perfect UI.

---

# **Objective:**

Build a complete web app called **StudyAll** — a peer-to-peer doubt-solving platform for college students with the tagline "BE LIMITLESS." The app has two plans: a Free tier for classroom peer help, and a Pro tier (₹99/month) for access to verified SuperStudent experts.

---

# **Context:**

StudyAll is a virtual study platform where college students join silent subject rooms (camera optional, mic off), post academic doubts, and get matched with volunteer peers who help solve them via private A/V sessions. Helpers earn points and climb a leaderboard. Top helpers become SuperStudents — verified experts available exclusively to Pro subscribers. Payments are handled via Razorpay. Video is powered by LiveKit (use mock avatar cards for now — no real video integration yet).

**Tech Stack:**

- React + Next.js + Tailwind CSS
- Supabase (Auth, PostgreSQL, Realtime, Storage)
- LiveKit (mock for now)
- Razorpay (subscriptions, ₹99/month)
- TypeScript throughout

**Design System:**

- Primary Navy: `#1E3A8A` | Accent Blue: `#3B82F6` | Background: `#F0F4F8`
- Card Background: `#FFFFFF` | Study Room BG: `#0D1117` | Pro Purple: `#7C3AED`
- Free Grey: `#6B7280` | Success: `#10B981` | Warning: `#F59E0B` | Danger: `#EF4444`
- Font: Inter | Border radius: 12px cards, 8px buttons | Shadow: 0 2px 8px rgba(0,0,0,0.08)

**Free vs Pro Rule (enforce everywhere):**

- **Free:** Join classrooms, ask & solve peer doubts, earn points, leaderboard, profile
- **Pro (₹99/month):** Everything in Free + SuperStudents directory + 1:1 expert sessions + Pro badge
- Free users tapping the Experts tab or any SuperStudent feature → show Upgrade Modal only
- Plan stored as `'free'` or `'pro'` on the user record. Always check server-side.

---

# **Instructions:**

## **Instruction 1 — Build the Landing Page `/`**

Centered mobile-style card on a light `#F0F4F8` background.

- Logo: **STUDYALL** bold with double-border outline style
- Below logo: thin line + "BE LIMITLESS" in small caps
- Subtitle: "The global peer-to-peer learning platform."
- Blue link text: "Join the academic revolution."
- CTA button: **"Get Started →"** (solid blue)
- Badge: 🌐 "Used by students in 100+ countries"
- Footer: "EST. 2024 — GLOBAL COMMUNITY"
- Floating blue chat bubble bottom-right, small avatar circle bottom-left ("N")
- Link to `/pricing` in the nav

---

## **Instruction 2 — Build Auth Pages `/login` and `/signup`**

White card, centered, light background.

- Logo at top. Heading: **"Welcome Back"**. Subtitle: "Sign in to continue your journey."
- Fields (labels in small caps): STUDENT NAME, COLLEGE/SCHOOL NAME, COURSE (left half), YEAR dropdown (right half), EMAIL, PASSWORD
- Blue "Sign In" button. Divider "OR CONTINUE WITH". Two OAuth buttons: ✉ Google | 🐙 Github
- Footer: "Don't have an account? **Sign Up**"
- On signup: set `plan = 'free'` by default on the user record

---

## **Instruction 3 — Build Pricing Page `/pricing`**

Two plan cards side by side.

**Free card** (white, grey border):

- Label: "FREE" grey badge. Price: "₹0 / month"
- ✅ Join subject classrooms | ✅ Ask & solve peer doubts | ✅ Earn points & leaderboard | ✅ Profile & badges | ❌ SuperStudents access | ❌ 1:1 expert sessions
- Button: "Get Started" (outline blue)

**Pro card** (blue gradient border, elevated shadow):

- Label: "✦ PRO" purple badge. Price: "₹99 / month"
- ✅ Everything in Free | ✅ Full SuperStudents directory | ✅ Book 1:1 expert sessions | ✅ Connect with verified SuperStudents | ✅ Pro badge on profile
- Button: "Upgrade Now →" (solid blue)
- Small text: "Powered by Razorpay · Secure payment · Cancel anytime"

---

## **Instruction 4 — Build Upgrade Modal (shown to free users accessing Pro features)**

Full-screen overlay, blurred background, centered white card.

- Large purple crown icon 👑 at top
- Heading: **"Unlock StudyAll Pro"**
- Subtitle: "Get access to verified SuperStudents who can solve your toughest doubts."
- Benefits list with ✅: 1:1 private sessions with SuperStudents | Connect with verified experts | Priority doubt resolution | Pro badge on your profile
- Price: **"₹99 / month"** bold blue. Small text: "Cancel anytime."
- Button: **"Upgrade to Pro →"** (solid blue, triggers Razorpay)
- Grey text link: "Maybe Later"
- ✕ close button top-right

---

## **Instruction 5 — Build Home Screen `/home`**

- Header left: "Hey, Alex! 👋" bold blue + subtitle "Ready to master CS ENG today?" grey
- Header right: notification bell with red dot + plan badge (grey "FREE" or purple "✦ PRO")
- Section 1 — "✦ Recommended for CS ENG": horizontal scrollable row of subject cards with colored icons
  - Computer Science (dark grey laptop) | AI (purple robot) | Data Structures (teal binary) | Software Engineering (green layers) | Operating Systems (black terminal)
- Section 2 — "Explore other topics": 2-column grid with Web Development (orange `</>`) and Cyber Security (red shield)
- Bottom nav: 🏠 HOME (active blue) | 👥 EXPERTS 👑 | 🏆 RANKS | 👤 PROFILE
- Free users tapping EXPERTS → show Upgrade Modal (do not navigate to the page)

---

## **Instruction 6 — Build Classroom List `/subject/[subject]`**

- Scrolling marquee ticker at very top: "DR. ELENA V. IS ACTIVE ✦ JAMES MILLER IS ACTIVE ✦ ..." scrolling left
- Back arrow + heading **"Computer Science"** + subtitle "JOIN A LIVE CLASSROOM SESSION"
- Top right: "129 Students Online" blue badge
- 3-column grid of classroom cards. Each card shows:
  - "Classroom [N]" + optional "VERIFIED" green badge + star rating
  - "Hosted by [Name]" (SuperStudent names in bold blue with 👑)
  - "[X] / 30 people in room" + color progress bar
  - If full: red "CLASSROOM FULL" badge + grey "Waiting List" button
  - If joinable: green "JOINABLE" badge + blue "Enter Classroom →" button
- All users (free and pro) can enter classrooms — no restriction here
- Show 5 classrooms: 1–4 full, Classroom 5 has 9/30 and shows Enter button

---

## **Instruction 7 — Build Study Room `/room/[room-id]`**

Dark background `#0D1117`. Most important screen.

**Top bar:** Red pill "● LIVE CLASSROOM" + room name + blue "Simulate Request" button + ⚙ icon

**Main grid:** 3×4 participant cards. Each card: dark BG, colored circle with initials, name, mic/camera icons. Pro users show small purple 👑 on card. One card shows a camera feed (Dr. Elena V.). "Alex (You)" card slightly highlighted.

**Bottom controls (pill-shaped, centered):** Mic (red, always disabled) | Camera toggle | Chat toggle | Red ✕ leave

**Interaction Center sidebar (right ~25%):**

- Header: "✦ Interaction Center"
- Tabs: "Peer Help" | "Requests 🔴"
- Doubt cards with poster name, status badge (OFFER RECEIVED green / SOLVING orange), doubt text, "Offer Help" + "Join Session" buttons
- Bottom: "Ask a question..." input + blue send button
- Three-dot ⋯ menu on each doubt card and each participant card → "Report User" or "Report Doubt" or "Block User"
- All users (free and pro) can ask and offer help here

---

## **Instruction 8 — Build Private Peer Session View**

Same dark BG. Available to all users.

- Top bar: purple pill "● PRIVATE SESSION (A/V)" + "🔇 Mute All" | "+ Invite" | "← Return to Main" (orange)
- Only 2 participant cards: "Alex (You)" with 🔵 MOD badge | "Dr. Elena V."
- Toast bottom-right: "Private Session Started — Audio and Video enabled for focused learning."

---

## **Instruction 9 — Build Rating Modal (after session ends)**

Centered modal, blurred overlay background.

- Heading: "Was your doubt solved?"
- Three buttons: ✅ Yes | 🔶 Partially | ❌ No
- Subheading: "Rate your session" in grey small caps
- 10 rounded square buttons in a row labeled 1–10:
  - 1–4 red | 5–7 orange | 8–10 green
  - Selected = solid filled, others outlined
  - Dynamic label below: "1 — Not helpful at all" / "5 — It was okay" / "10 — Absolutely perfect!"
- Text area: label "Tell us why (optional)" + placeholder "What did they explain well? What could be better?" — 4 lines tall, rounded
- Full-width blue "Submit Rating" button

---

## **Instruction 10 — Build SuperStudents Page `/experts` (PRO ONLY)**

Gate this page: if `user.plan !== 'pro'` → show Upgrade Modal. Do not render the page.

- Heading: "SuperStudents" + subtitle "Connect with verified CS experts across the globe."
- Search bar + filter tabs: All | AI & ML | Cyber Security | Full Stack | Data Structures | OS | Cloud
- 2–3 column expert card grid. Each card:
  - Rank badge top-right (🏆 #1, #2...)
  - Colored avatar + initials + purple 👑 PRO badge
  - Name + ✓ verified | 📍 University, Country | ★ Rating + "X VERIFIED REVIEWS"
  - Skill tag chips | Status: green "ACTIVE NOW in [Subject]" or orange "CURRENTLY BUSY"
  - Full-width blue "Connect" button + ⋯ menu with "Report"
- 6 experts: Dr. Elena V. (Cambridge, ★4.9, AI #1), James Miller (Stanford, ★4.5, CS #2), Rahul S. (IIT Delhi, ★4.8, SWE #5), Sofia Chen (MIT, ★4.7, Cyber #12), Anita Kumar (Oxford, ★4.9, DS #3), David Chen (Tsinghua, ★4.8, OS #4)

---

## **Instruction 11 — Build Global Rankings `/ranks` (all users)**

- Blue banner: "YOUR CS POSITION #1,402 Globally" + AVG RATING 4.85★ + SOLVED 24 Doubts + purple 👑 if Pro
- Filter tabs: All CS | Development | Theory
- Leaderboard rows: rank number (👑 crown for #1), name in blue + purple 👑 if Pro, subject tag, doubts solved, rating score, trend arrow ↑↓—
- Rows: 1. Anita Kumar 👑 (4.98★), 2. James Miller (4.95★), 3. Elena V. 👑 (4.92★), 4. David Chen (4.88★), 5. Samira J. (4.85★), 6. Rahul S. (4.82★), 7. Sofia Chen (4.79★)
- Footer: live countdown "The leaderboard resets in 04:22:15"

---

## **Instruction 12 — Build Profile Page `/profile`**

- Avatar: large blue circle "A" + teal star badge. Name: Alex. Location: 📍 Mumbai, India
- Plan badge: "FREE PLAN" grey or "✦ PRO MEMBER" purple
- Stats: 📖 24 DOUBTS ASKED | 👥 186 FRIENDS
- Blue rank card: "GLOBAL RANK #1,402" + 🏆 icon
- Badges: 🟠 Fast Responder | 🟣 Math Whiz | 🟢 Top Reviewer
- Settings list: My Doubts History → | Subscription Details → | Learning Preferences → | Help & Support → | 🔴 Log Out →
- Subscription Details: if free → show "Upgrade to Pro" purple button; if pro → show expiry date + "Cancel Subscription" link

---

## **Instruction 13 — Build Report & Block System**

Three-dot ⋯ menu on participant cards, doubt cards, expert cards, and other user profiles.

**Report Modal:**

- Heading: "Report this user" or "Report this doubt"
- Radio options: 🚫 Spam or fake doubts | 😠 Harassment or bullying | 🔞 Inappropriate content | 🎮 Cheating the points system | 📝 Other
- Text area: "Tell us more (optional)" + placeholder "Give us any extra context..."
- Red "Submit Report" button
- After submit: green toast "Thanks for reporting. Our team will review this shortly."

**Block Modal:**

- "Block this user" in ⋯ menu
- Confirmation dialog: "Are you sure? [Name] won't be able to see your doubts or join your sessions." + "Block" red button + "Cancel" grey link
- After block: that user disappears from doubt feed, participant grid, and volunteer list for the blocker

---

## **Instruction 14 — Build Suspended User Screen**

If `user.suspended_until` is in the future, show a full-screen red warning card on login (no access to anything else):

- Red warning icon
- **"Account Suspended"** bold heading
- "Your account has been suspended until [date]."
- "Reason: [reason]"
- "If you believe this is a mistake, contact support@studyall.com"
- No navigation, no rooms — just this card until suspension lifts

---

## **Instruction 15 — Build Two-Factor Authentication (2FA)**

**2FA Setup in Profile → Settings:**

- Toggle: "Enable Two-Factor Authentication" (off by default)
- On enable: send 6-digit code to email, user must enter it to confirm. Set `two_fa_enabled = true`.
- On disable: require current password to confirm

**2FA Login Screen** (Step 2 after email + password, only if `two_fa_enabled = true`):
White card, same style as login.

- Logo at top
- Heading: **"Two-Step Verification"**
- Subtitle: "We sent a 6-digit code to alex@example.com"
- 6 individual digit input boxes in a row — large, centered, auto-advance on type
- "Resend Code" grey link (only active after 30 seconds, shows "Resend in 28s" countdown)
- Blue "Verify →" button
- "← Back to Login" grey link at bottom
- After 5 wrong attempts: red message "Too many attempts. Try again in 15 minutes." — form disabled

---

## **Instruction 16 — Build Admin Dashboard `/admin` (admin role only)**

Only render if `user.role === 'admin'`. Dark sidebar layout.

**Sidebar nav:** 📋 Pending Reports | 🚩 Flagged Accounts | ⏸ Suspended Users | 📜 Moderation Log

**Pending Reports tab:**

- List of report cards: reporter name, reported user, color-coded reason badge, details, timestamp
- Action buttons per card: "Warn" (yellow) | "Suspend 24h" (orange) | "Suspend 7 days" (red) | "Ban" (dark red) | "Dismiss" (grey)

**Flagged Accounts tab:**

- Users auto-flagged by system (3+ reports in 7 days / 3 bad ratings in a row)
- Flag reason + date. "Review & Clear Flag" button per user.

**Suspended Users tab:**

- List with suspension expiry dates and reasons
- "Lift Suspension Early" button per user

**Moderation Log tab:**

- Full history table: moderator, target user, action, reason, date
- Filterable by action type and date

---

## **Instruction 17 — Wire Up Backend Logic**

1. Supabase Auth — Google OAuth + GitHub OAuth + Email/Password. On signup: `plan = 'free'`
2. Home page — query `course_subject_map` for recommended subjects by course keyword
3. Plan middleware — gate `/experts` and SuperStudent sessions behind `plan === 'pro'` (server-side)
4. Razorpay — on "Upgrade to Pro": create subscription server-side → redirect to Razorpay checkout → on webhook: set `plan = 'pro'`, store `subscription_id`, `plan_expires_at` → on cancel/expiry: revert to `'free'`
5. Study room — Supabase Realtime for presence and live doubt feed
6. Doubt posting — insert to `doubts`, broadcast to room channel
7. Private peer session — LiveKit room (mock), available to all users
8. SuperStudent session — only if `plan === 'pro'`, else Upgrade Modal
9. Rating — insert to `answers` table with rating (1–10) and review_text
10. Points — update `users.points` via Postgres function on rating submit
11. Report — insert to `reports` table; 3+ reports in 7 days auto-flags user
12. Block — insert to `blocks` table; filter blocked users from feed and grid
13. Smart room scaling — Edge Function cron every 2 min: open room when all hit 25 users; merge when a room has ≤5 and another ≤23 (combined ≤28); broadcast ROOM_MERGE Realtime event

---

# **Notes:**

**Note 1 — Start with the most important pages first:**
Home, Study Room (with Interaction Center), Upgrade Modal, and the 2FA login screen are the highest priority. Build and polish these before moving to Admin or Pricing.

**Note 2 — Mock LiveKit video:**
Do not integrate real LiveKit video yet. Show participant cards with colored circles and initials. One card (Dr. Elena V.) can show a static photo as a camera feed placeholder. Real video comes in a later phase.

**Note 3 — Seed this data into the database:**
Subjects: Computer Science, Artificial Intelligence, Data Structures, Software Engineering, Operating Systems, Web Development, Cyber Security, Machine Learning, Algorithms, DBMS, Computer Networks, Electronics, Signal Processing, Microprocessors, Mechanics, Electromagnetism, Thermodynamics, Organic Chemistry, Inorganic Chemistry, Biology, Anatomy, Physiology, Accountancy, Economics, Networking, Cryptography, Ethical Hacking, Maths, Physics, Statistics
ENDOFFILE
echo "Done"
Output
Done

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/3a5f1dcf-9427-428e-a2a2-1c6a8422e17f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
