import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Bell,
  Sparkles,
  Laptop,
  Bot,
  Binary,
  Layers,
  Terminal,
  Code2,
  ShieldCheck,
  Calculator,
  Atom,
  FlaskConical,
  Dna,
  Microscope,
  BookOpen,
  Globe,
  Landmark,
  Scale,
  Briefcase,
  TrendingUp,
  PieChart,
  DollarSign,
  Building2,
  Stethoscope,
  HeartPulse,
  Pill,
  Brain,
  Cpu,
  Wrench,
  Zap,
  Hammer,
  Palette,
  Music,
  Camera,
  Languages,
  type LucideIcon,
} from "lucide-react";
import { usePlan } from "@/lib/plan-context";
import { BottomNav } from "@/components/bottom-nav";

export const Route = createFileRoute("/_authenticated/home")({
  head: () => ({
    meta: [
      { title: "Your Subjects — Kaenyon" },
      {
        name: "description",
        content: "Pick a subject and jump into a live classroom to ask or solve doubts.",
      },
      { property: "og:title", content: "Your Subjects — Kaenyon" },
      {
        property: "og:description",
        content: "Pick a subject and jump into a live classroom to ask or solve doubts.",
      },
    ],
  }),
  component: Home,
});

type Subject = { name: string; icon: LucideIcon; color: string; slug: string };

type CourseCatalog = {
  label: string;
  recommended: Subject[];
  other: Subject[];
};

const CATALOGS: Record<string, CourseCatalog> = {
  cs: {
    label: "CS ENG",
    recommended: [
      {
        name: "Computer Science",
        icon: Laptop,
        color: "bg-foreground/90 text-background",
        slug: "computer-science",
      },
      { name: "AI", icon: Bot, color: "bg-pro text-white", slug: "ai" },
      {
        name: "Data Structures",
        icon: Binary,
        color: "bg-teal-500 text-white",
        slug: "data-structures",
      },
      {
        name: "Software Eng",
        icon: Layers,
        color: "bg-success text-white",
        slug: "software-engineering",
      },
      {
        name: "Operating Systems",
        icon: Terminal,
        color: "bg-black text-white",
        slug: "operating-systems",
      },
    ],
    other: [
      {
        name: "Web Development",
        icon: Code2,
        color: "bg-orange-500 text-white",
        slug: "web-development",
      },
      {
        name: "Cyber Security",
        icon: ShieldCheck,
        color: "bg-danger text-white",
        slug: "cyber-security",
      },
    ],
  },
  mechanical: {
    label: "MECHANICAL ENG",
    recommended: [
      {
        name: "Thermodynamics",
        icon: Zap,
        color: "bg-orange-500 text-white",
        slug: "thermodynamics",
      },
      {
        name: "Fluid Mechanics",
        icon: Atom,
        color: "bg-teal-500 text-white",
        slug: "fluid-mechanics",
      },
      {
        name: "Machine Design",
        icon: Wrench,
        color: "bg-foreground/90 text-background",
        slug: "machine-design",
      },
      {
        name: "Manufacturing",
        icon: Hammer,
        color: "bg-success text-white",
        slug: "manufacturing",
      },
      { name: "Dynamics", icon: Cpu, color: "bg-pro text-white", slug: "dynamics" },
    ],
    other: [
      {
        name: "Material Science",
        icon: Layers,
        color: "bg-black text-white",
        slug: "material-science",
      },
      { name: "CAD", icon: Palette, color: "bg-danger text-white", slug: "cad" },
    ],
  },
  electrical: {
    label: "ELECTRICAL ENG",
    recommended: [
      { name: "Circuits", icon: Zap, color: "bg-orange-500 text-white", slug: "circuits" },
      {
        name: "Power Systems",
        icon: Cpu,
        color: "bg-foreground/90 text-background",
        slug: "power-systems",
      },
      { name: "Electronics", icon: Binary, color: "bg-teal-500 text-white", slug: "electronics" },
      { name: "Signals", icon: Atom, color: "bg-pro text-white", slug: "signals-and-systems" },
      {
        name: "Control Systems",
        icon: Terminal,
        color: "bg-success text-white",
        slug: "control-systems",
      },
    ],
    other: [
      {
        name: "Microprocessors",
        icon: Layers,
        color: "bg-black text-white",
        slug: "microprocessors",
      },
      { name: "Embedded", icon: Wrench, color: "bg-danger text-white", slug: "embedded-systems" },
    ],
  },
  civil: {
    label: "CIVIL ENG",
    recommended: [
      {
        name: "Structural",
        icon: Building2,
        color: "bg-foreground/90 text-background",
        slug: "structural-engineering",
      },
      {
        name: "Geotechnical",
        icon: Layers,
        color: "bg-orange-500 text-white",
        slug: "geotechnical",
      },
      { name: "Surveying", icon: Globe, color: "bg-teal-500 text-white", slug: "surveying" },
      {
        name: "Transportation",
        icon: Wrench,
        color: "bg-success text-white",
        slug: "transportation",
      },
      { name: "Hydraulics", icon: Atom, color: "bg-pro text-white", slug: "hydraulics" },
    ],
    other: [
      {
        name: "Concrete Tech",
        icon: Hammer,
        color: "bg-black text-white",
        slug: "concrete-technology",
      },
      {
        name: "Env. Engineering",
        icon: FlaskConical,
        color: "bg-danger text-white",
        slug: "environmental-engineering",
      },
    ],
  },
  medical: {
    label: "MEDICAL",
    recommended: [
      { name: "Anatomy", icon: HeartPulse, color: "bg-danger text-white", slug: "anatomy" },
      { name: "Physiology", icon: Stethoscope, color: "bg-pro text-white", slug: "physiology" },
      {
        name: "Biochemistry",
        icon: FlaskConical,
        color: "bg-teal-500 text-white",
        slug: "biochemistry",
      },
      { name: "Pharmacology", icon: Pill, color: "bg-success text-white", slug: "pharmacology" },
      {
        name: "Pathology",
        icon: Microscope,
        color: "bg-foreground/90 text-background",
        slug: "pathology",
      },
    ],
    other: [
      { name: "Microbiology", icon: Dna, color: "bg-black text-white", slug: "microbiology" },
      { name: "Neurology", icon: Brain, color: "bg-orange-500 text-white", slug: "neurology" },
    ],
  },
  business: {
    label: "BUSINESS / MBA",
    recommended: [
      { name: "Marketing", icon: TrendingUp, color: "bg-pro text-white", slug: "marketing" },
      { name: "Finance", icon: DollarSign, color: "bg-success text-white", slug: "finance" },
      { name: "Accounting", icon: PieChart, color: "bg-teal-500 text-white", slug: "accounting" },
      {
        name: "Strategy",
        icon: Briefcase,
        color: "bg-foreground/90 text-background",
        slug: "strategy",
      },
      { name: "Operations", icon: Layers, color: "bg-orange-500 text-white", slug: "operations" },
    ],
    other: [
      { name: "Economics", icon: TrendingUp, color: "bg-black text-white", slug: "economics" },
      {
        name: "Org Behavior",
        icon: Brain,
        color: "bg-danger text-white",
        slug: "organizational-behavior",
      },
    ],
  },
  commerce: {
    label: "COMMERCE",
    recommended: [
      {
        name: "Accountancy",
        icon: PieChart,
        color: "bg-foreground/90 text-background",
        slug: "accountancy",
      },
      { name: "Economics", icon: TrendingUp, color: "bg-success text-white", slug: "economics" },
      {
        name: "Business Studies",
        icon: Briefcase,
        color: "bg-pro text-white",
        slug: "business-studies",
      },
      { name: "Statistics", icon: Calculator, color: "bg-teal-500 text-white", slug: "statistics" },
      { name: "Finance", icon: DollarSign, color: "bg-orange-500 text-white", slug: "finance" },
    ],
    other: [
      { name: "Banking", icon: Landmark, color: "bg-black text-white", slug: "banking" },
      { name: "Taxation", icon: Scale, color: "bg-danger text-white", slug: "taxation" },
    ],
  },
  law: {
    label: "LAW",
    recommended: [
      {
        name: "Constitutional",
        icon: Scale,
        color: "bg-foreground/90 text-background",
        slug: "constitutional-law",
      },
      {
        name: "Criminal Law",
        icon: ShieldCheck,
        color: "bg-danger text-white",
        slug: "criminal-law",
      },
      { name: "Contract Law", icon: BookOpen, color: "bg-pro text-white", slug: "contract-law" },
      { name: "Torts", icon: Landmark, color: "bg-teal-500 text-white", slug: "torts" },
      { name: "Jurisprudence", icon: Brain, color: "bg-success text-white", slug: "jurisprudence" },
    ],
    other: [
      {
        name: "Corporate Law",
        icon: Building2,
        color: "bg-black text-white",
        slug: "corporate-law",
      },
      {
        name: "IPR",
        icon: Palette,
        color: "bg-orange-500 text-white",
        slug: "intellectual-property",
      },
    ],
  },
  arts: {
    label: "ARTS / HUMANITIES",
    recommended: [
      {
        name: "English Lit",
        icon: BookOpen,
        color: "bg-foreground/90 text-background",
        slug: "english-literature",
      },
      { name: "History", icon: Landmark, color: "bg-orange-500 text-white", slug: "history" },
      { name: "Psychology", icon: Brain, color: "bg-pro text-white", slug: "psychology" },
      { name: "Sociology", icon: Globe, color: "bg-teal-500 text-white", slug: "sociology" },
      { name: "Philosophy", icon: Scale, color: "bg-success text-white", slug: "philosophy" },
    ],
    other: [
      { name: "Languages", icon: Languages, color: "bg-black text-white", slug: "languages" },
      {
        name: "Political Sci",
        icon: Landmark,
        color: "bg-danger text-white",
        slug: "political-science",
      },
    ],
  },
  science: {
    label: "SCIENCE",
    recommended: [
      { name: "Physics", icon: Atom, color: "bg-pro text-white", slug: "physics" },
      { name: "Chemistry", icon: FlaskConical, color: "bg-success text-white", slug: "chemistry" },
      {
        name: "Mathematics",
        icon: Calculator,
        color: "bg-foreground/90 text-background",
        slug: "mathematics",
      },
      { name: "Biology", icon: Dna, color: "bg-teal-500 text-white", slug: "biology" },
      { name: "Statistics", icon: PieChart, color: "bg-orange-500 text-white", slug: "statistics" },
    ],
    other: [
      { name: "Astronomy", icon: Globe, color: "bg-black text-white", slug: "astronomy" },
      {
        name: "Env. Science",
        icon: Microscope,
        color: "bg-danger text-white",
        slug: "environmental-science",
      },
    ],
  },
  arch: {
    label: "ARCHITECTURE / DESIGN",
    recommended: [
      { name: "Design Studio", icon: Palette, color: "bg-pro text-white", slug: "design-studio" },
      {
        name: "Building Tech",
        icon: Building2,
        color: "bg-foreground/90 text-background",
        slug: "building-technology",
      },
      {
        name: "History of Arch",
        icon: Landmark,
        color: "bg-orange-500 text-white",
        slug: "history-of-architecture",
      },
      { name: "Drawing", icon: Camera, color: "bg-teal-500 text-white", slug: "drawing" },
      {
        name: "Urban Planning",
        icon: Globe,
        color: "bg-success text-white",
        slug: "urban-planning",
      },
    ],
    other: [
      { name: "Visual Arts", icon: Music, color: "bg-black text-white", slug: "visual-arts" },
      { name: "Materials", icon: Layers, color: "bg-danger text-white", slug: "materials" },
    ],
  },
};

const DEFAULT_CATALOG: CourseCatalog = CATALOGS.cs;

function resolveCatalog(course?: string): CourseCatalog {
  if (!course) return DEFAULT_CATALOG;
  const c = course.toLowerCase();
  const has = (...kw: string[]) => kw.some((k) => c.includes(k));
  if (
    has(
      "cse",
      "computer",
      "software",
      "it ",
      "info tech",
      "information tech",
      "bca",
      "mca",
      "b.tech cs",
      "b tech cs",
    )
  )
    return CATALOGS.cs;
  if (has("mech")) return CATALOGS.mechanical;
  if (has("electr", "eee", "ece")) return CATALOGS.electrical;
  if (has("civil")) return CATALOGS.civil;
  if (has("mbbs", "med", "nurs", "pharm", "bds", "dental")) return CATALOGS.medical;
  if (has("mba", "business", "bba", "management")) return CATALOGS.business;
  if (has("commerce", "b.com", "bcom", "ca ", "cfa")) return CATALOGS.commerce;
  if (has("law", "llb", "llm")) return CATALOGS.law;
  if (
    has(
      "arts",
      "humanities",
      "ba ",
      "b.a",
      "psycholog",
      "sociolog",
      "history",
      "english",
      "literature",
    )
  )
    return CATALOGS.arts;
  if (has("b.sc", "bsc", "msc", "m.sc", "science", "physics", "chem", "math", "bio"))
    return CATALOGS.science;
  if (has("arch", "design", "b.des", "bdes")) return CATALOGS.arch;
  return DEFAULT_CATALOG;
}

function Home() {
  const { profile } = usePlan();
  const displayName = profile?.name ? profile.name.split(" ")[0] : "there";
  const course = profile?.course || "your studies";
  const catalog = resolveCatalog(profile?.course);

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="px-5 pt-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-primary">Hey, {displayName}! 👋</h1>
            <p className="mt-1 text-sm text-muted-foreground">Ready to master {course} today?</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Bell className="h-5 w-5 text-foreground" />
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-danger" />
            </div>
          </div>
        </div>
      </header>

      <section className="mt-8">
        <h2 className="px-5 text-sm font-bold text-foreground flex items-center gap-1">
          <Sparkles className="h-4 w-4 text-primary" /> Recommended for {catalog.label}
        </h2>
        <div className="mt-3 flex gap-3 overflow-x-auto px-5 pb-2">
          {catalog.recommended.map((s) => (
            <Link
              key={s.slug}
              to="/subject/$subject"
              params={{ subject: s.slug }}
              className="flex w-32 shrink-0 flex-col items-start gap-3 rounded-xl bg-card p-4 shadow-card hover:shadow-elevated"
            >
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${s.color}`}>
                <s.icon className="h-5 w-5" />
              </div>
              <div className="text-sm font-semibold leading-tight">{s.name}</div>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-8 px-5">
        <h2 className="text-sm font-bold">Explore other topics</h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {catalog.other.map((s) => (
            <Link
              key={s.slug}
              to="/subject/$subject"
              params={{ subject: s.slug }}
              className="flex items-center gap-3 rounded-xl bg-card p-4 shadow-card hover:shadow-elevated"
            >
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${s.color}`}>
                <s.icon className="h-5 w-5" />
              </div>
              <div className="text-sm font-semibold">{s.name}</div>
            </Link>
          ))}
        </div>
      </section>

      <BottomNav />
    </div>
  );
}
