import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import {
  analyzePhoto,
  computeReferenceDescriptor,
  loadModels,
  findDuplicatesToDrop,
  CATEGORY_LABELS,
  type PhotoCategory,
  type AnalysisResult,
  type SortType,
} from "@/lib/photo-analysis";
import {
  Camera,
  Upload,
  Sparkles,
  Link as LinkIcon,
  Loader2,
  TreePalm,
  Home,
  Users,
  Grid3x3,
  ArrowLeft,
  RotateCcw,
  Check,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Luminiq — Transform thousands of photos into organized galleries in minutes" },
      {
        name: "description",
        content:
          "Upload an entire shoot and let AI handle the sorting. Automatically group people, identify the best shots, remove duplicates, and organize your photos into ready-to-deliver collections.",
      },
      { property: "og:title", content: "Luminiq — Transform thousands of photos into organized galleries in minutes" },
      {
        property: "og:description",
        content: "Upload an entire shoot and let AI handle the sorting. Automatically group people, identify the best shots, remove duplicates, and organize your photos into ready-to-deliver collections.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Index,
});

const BUCKET = "sorted-photos";

type Counts = Record<PhotoCategory, number>;
const EMPTY_COUNTS: Counts = {
  keepers: 0, blurry: 0, tilted: 0, outdoor: 0, indoor: 0, selected_person: 0, duplicate: 0,
};

// Categories that represent rejected/wasted shots — shown in their own
// "developing tray reject" row so the photographer can sanity-check what
// got tossed, rather than the AI silently discarding things.
const WASTE_CATEGORIES: PhotoCategory[] = ["blurry", "tilted", "duplicate"];
const KEEP_CATEGORIES: PhotoCategory[] = ["keepers", "outdoor", "indoor", "selected_person"];

type Step = "choose" | "options" | "running" | "done";

const SORT_TYPES: { value: SortType; label: string; icon: typeof TreePalm }[] = [
  { value: "all", label: "All photos", icon: Grid3x3 },
  { value: "outdoor", label: "Outdoor", icon: TreePalm },
  { value: "indoor", label: "Indoor", icon: Home },
  { value: "group", label: "Group only", icon: Users },
];

function FilmDivider() {
  return <div className="filmstrip h-3 w-full" aria-hidden="true" />;
}

function Header() {
  const { user, isReady } = useAuth();
  return (
    <header className="sticky top-0 z-10 bg-background/90 backdrop-blur-sm">
      <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-negative text-background">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="font-display text-lg uppercase tracking-[0.08em]">Luminiq</span>
        </div>
        {!isReady ? (
          <div className="h-8 w-20" />
        ) : user ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Avatar className="h-8 w-8 border border-border">
                <AvatarFallback className="text-xs font-mono">
                  {(user.email ?? "?").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="font-normal text-xs text-muted-foreground">
                Signed in as
                <div className="mt-0.5 text-sm font-medium text-foreground truncate max-w-[200px]">
                  {user.email}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={async () => {
                  await supabase.auth.signOut();
                  toast.success("Logged out");
                }}
              >
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link to="/auth">Log in</Link>
          </Button>
        )}
      </div>
      <FilmDivider />
    </header>
  );
}

function Index() {
  const [step, setStep] = useState<Step>("choose");
  const [photos, setPhotos] = useState<File[]>([]);
  const [sortType, setSortType] = useState<SortType>("all");
  const [referenceFile, setReferenceFile] = useState<File | null>(null);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");

  const photosInput = useRef<HTMLInputElement>(null);
  const refInput = useRef<HTMLInputElement>(null);

  function reset() {
    setStep("choose");
    setPhotos([]);
    setSortType("all");
    setReferenceFile(null);
    setProgress(0);
    setTotal(0);
    setCounts(EMPTY_COUNTS);
    setShareUrl(null);
    setStatus("");
  }

  function handleChooseFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, 1000);
    if (!files.length) return;
    setPhotos(files);
    setStep("options");
  }

  async function handleRun() {
    if (!photos.length) {
      toast.error("Add some photos first");
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      toast.error("Please sign in to upload photos");
      return;
    }

    setStep("running");
    setRunning(true);
    setShareUrl(null);
    setCounts(EMPTY_COUNTS);
    setProgress(0);
    setTotal(photos.length);

    try {
      await loadModels(setStatus);

      let referenceDescriptor: Float32Array | null = null;
      if (referenceFile) {
        setStatus("Reading reference person…");
        referenceDescriptor = await computeReferenceDescriptor(referenceFile);
        if (!referenceDescriptor) {
          toast.warning("No face detected in reference photo — skipping person match");
        }
      }

      // Phase 1: analyze every photo (no uploads yet — we need every photo's
      // perceptual hash before we can tell which ones are near-duplicate
      // burst shots of each other).
      const results: { file: File; result: AnalysisResult }[] = [];
      for (let i = 0; i < photos.length; i++) {
        const file = photos[i];
        setStatus(`Analyzing ${file.name}`);
        try {
          const result = await analyzePhoto(file, referenceDescriptor);
          results.push({ file, result });
        } catch (e) {
          console.error("Failed", file.name, e);
        }
        setProgress(i + 1);
      }

      // Phase 2: figure out which photos pass the chosen sort-type filter
      // and reference-person filter, then dedupe bursts down to the 2 best.
      const passesFilter = (r: AnalysisResult) => {
        if (r.isBlurry || r.isTilted) return false;
        if (sortType === "outdoor" && r.scene !== "outdoor") return false;
        if (sortType === "indoor" && r.scene !== "indoor") return false;
        if (sortType === "group" && r.faceCount < 2) return false;
        if (referenceDescriptor && !r.matchedPerson) return false;
        return true;
      };

      const eligible = results
        .map((r, idx) => ({ ...r, idx }))
        .filter((r) => passesFilter(r.result));

      const dropSet = findDuplicatesToDrop(
        eligible.map((r) => r.result),
        2,
      );

      const live: Counts = { ...EMPTY_COUNTS };
      const shareId = crypto.randomUUID().slice(0, 12);

      setStatus("Uploading sorted photos…");
      for (let i = 0; i < results.length; i++) {
        const { file, result } = results[i];
        const eligibleIdx = eligible.findIndex((e) => e.idx === i);
        const isDuplicate = eligibleIdx !== -1 && dropSet.has(eligibleIdx);
        const isKept = eligibleIdx !== -1 && !isDuplicate;

        let cat: PhotoCategory;
        if (result.isBlurry) cat = "blurry";
        else if (result.isTilted) cat = "tilted";
        else if (isDuplicate) cat = "duplicate";
        else if (isKept) cat = "keepers";
        else cat = result.scene === "outdoor" ? "outdoor" : result.scene === "indoor" ? "indoor" : "blurry";

        live[cat] += 1;
        setCounts({ ...live });

        try {
          const path = `${shareId}/${cat}/${Date.now()}_${i}_${sanitize(file.name)}`;
          await supabase.storage.from(BUCKET).upload(path, file, {
            contentType: file.type || "image/jpeg",
            upsert: false,
          });
        } catch (e) {
          console.error("Upload failed", file.name, e);
        }
      }

      const url = `${window.location.origin}/share/${shareId}`;
      setShareUrl(url);
      setStatus("Done");
      setStep("done");
      toast.success("Sorted! Share link is ready.");
    } catch (e) {
      console.error(e);
      toast.error("Something went wrong. Check the console.");
      setStep("options");
    } finally {
      setRunning(false);
    }
  }

  const totalKept = KEEP_CATEGORIES.reduce((s, c) => s + counts[c], 0);
  const totalWasted = WASTE_CATEGORIES.reduce((s, c) => s + counts[c], 0);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />

      <main className="mx-auto max-w-5xl px-6 py-12 space-y-10">
        {step === "choose" && (
          <div key="choose" className="step-in space-y-10">
            <section className="space-y-4">
              <div className="frame-counter flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
                F·001 — CONTACT SHEET TOOL
              </div>
              <h1 className="font-display text-3xl md:text-5xl uppercase tracking-tight leading-[1.05]">
                Thousands of photos.
                <br />
                <span className="text-primary">One organized gallery.</span>
              </h1>
              <p className="text-muted-foreground max-w-xl text-base">
                Load a whole shoot onto the light table. Luminiq culls the blur, straightens out
                the bursts, and hands back a gallery worth delivering.
              </p>
            </section>

            <div className="relative overflow-hidden rounded-xl border-2 border-dashed border-brass/50 bg-card">
              <div className="absolute left-3 top-3 h-2 w-2 rounded-full border border-brass/60" />
              <div className="absolute right-3 top-3 h-2 w-2 rounded-full border border-brass/60" />
              <div className="absolute left-3 bottom-3 h-2 w-2 rounded-full border border-brass/60" />
              <div className="absolute right-3 bottom-3 h-2 w-2 rounded-full border border-brass/60" />
              <input
                ref={photosInput}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleChooseFiles}
              />
              <div className="flex flex-col items-center justify-center py-20 gap-5 px-6">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Upload className="h-6 w-6" />
                </span>
                <Button size="lg" className="font-display uppercase tracking-wide" onClick={() => photosInput.current?.click()}>
                  Choose files to sort
                </Button>
                <p className="frame-counter">UP TO 1000 JPGS · NOTHING UPLOADS UNTIL YOU SORT</p>
              </div>
            </div>
          </div>
        )}

        {step === "options" && (
          <div key="options" className="step-in space-y-8">
            <button
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setStep("choose")}
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Choose different files
            </button>

            <section className="space-y-1">
              <div className="frame-counter">F·002 — {photos.length} FRAMES LOADED</div>
              <h1 className="font-display text-2xl uppercase tracking-tight">Set the sort</h1>
              <p className="text-sm text-muted-foreground">Pick what to keep, then run it through.</p>
            </section>

            <Card className="p-5 space-y-4 border-border">
              <h2 className="font-display text-sm uppercase tracking-wide text-muted-foreground">Sort type</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {SORT_TYPES.map(({ value, label, icon: Icon }) => {
                  const active = sortType === value;
                  return (
                    <button
                      key={value}
                      data-active={active}
                      onClick={() => setSortType(value)}
                      className={`dial-chip flex flex-col items-center gap-2 rounded-lg border-2 p-4 text-sm ${
                        active
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border hover:border-brass/60 hover:bg-accent text-muted-foreground"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      <span className="font-medium">{label}</span>
                    </button>
                  );
                })}
              </div>
            </Card>

            <Card className="p-5 space-y-3 border-border">
              <div className="flex items-center gap-2">
                <Camera className="h-4 w-4 text-primary" />
                <h2 className="font-display text-sm uppercase tracking-wide text-muted-foreground">
                  Select person from reference image
                </h2>
                <span className="frame-counter">OPTIONAL</span>
              </div>
              <p className="text-sm text-muted-foreground">
                One clear photo of the person to pull out of group shots. Leave empty to keep everyone.
              </p>
              <input
                ref={refInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setReferenceFile(e.target.files?.[0] ?? null)}
              />
              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={() => refInput.current?.click()}>
                  Choose photo
                </Button>
                <span className="text-sm truncate">
                  {referenceFile?.name ?? <span className="text-muted-foreground">none</span>}
                </span>
                {referenceFile && (
                  <Button variant="ghost" size="sm" onClick={() => setReferenceFile(null)}>
                    Clear
                  </Button>
                )}
              </div>
            </Card>

            <Button size="lg" className="font-display uppercase tracking-wide" onClick={handleRun}>
              <Sparkles className="h-4 w-4 mr-2" /> Sort photos
            </Button>
          </div>
        )}

        {(step === "running" || step === "done") && (
          <div key="result" className="step-in space-y-8">
            <div className="flex flex-col items-start gap-4">
              {step === "running" ? (
                <Button size="lg" disabled className="font-display uppercase tracking-wide">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Sorting…
                </Button>
              ) : (
                <Button variant="outline" onClick={reset} className="font-display uppercase tracking-wide">
                  <RotateCcw className="h-4 w-4 mr-2" /> Sort another batch
                </Button>
              )}

              {(running || progress > 0) && (
                <div className="w-full space-y-2">
                  <div className="h-3 w-full overflow-hidden rounded-sm bg-muted">
                    <div
                      className="film-advance h-full bg-primary transition-[width] duration-300 ease-out"
                      style={{ width: `${total ? (progress / total) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="frame-counter flex items-center justify-between">
                    <span>F·{String(progress).padStart(3, "0")} / F·{String(total).padStart(3, "0")}</span>
                    <span>{status}</span>
                  </div>
                </div>
              )}
            </div>

            {(running || progress > 0) && (
              <section className="space-y-3">
                <h2 className="font-display text-sm uppercase tracking-wide text-muted-foreground">
                  Final picks · {totalKept}
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {KEEP_CATEGORIES.map((cat) => (
                    <Card key={cat} className="p-4 border-border">
                      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                        <Check className="h-3 w-3 text-primary" />
                        {CATEGORY_LABELS[cat]}
                      </div>
                      <div className="font-mono text-2xl font-medium mt-1">{counts[cat]}</div>
                    </Card>
                  ))}
                </div>

                <h2 className="font-display text-sm uppercase tracking-wide text-muted-foreground pt-2">
                  Developing tray rejects · {totalWasted}
                </h2>
                <div className="grid grid-cols-3 gap-3">
                  {WASTE_CATEGORIES.map((cat) => (
                    <Card key={cat} className="p-4 border-border bg-muted/40">
                      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                        <X className="h-3 w-3 text-destructive" />
                        {CATEGORY_LABELS[cat]}
                      </div>
                      <div className="font-mono text-2xl font-medium mt-1 text-muted-foreground">{counts[cat]}</div>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {shareUrl && (
              <Card className="p-5 space-y-3 border-primary/40 step-in">
                <div className="flex items-center gap-2">
                  <LinkIcon className="h-4 w-4 text-primary" />
                  <h2 className="font-display text-sm uppercase tracking-wide">Client share link</h2>
                </div>
                <div className="flex flex-col md:flex-row gap-2">
                  <input
                    className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                    value={shareUrl}
                    readOnly
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button
                    variant="secondary"
                    onClick={() => {
                      navigator.clipboard.writeText(shareUrl);
                      toast.success("Copied");
                    }}
                  >
                    Copy link
                  </Button>
                  <Link
                    to="/share/$id"
                    params={{ id: shareUrl.split("/").pop()! }}
                    className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Open
                  </Link>
                </div>
                <p className="text-xs text-muted-foreground">
                  Links expire after 7 days of inactivity. Anyone with the link can view the photos.
                </p>
              </Card>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}
