import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
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

type Step = "choose" | "options" | "running" | "done";

const SORT_TYPES: { value: SortType; label: string; icon: typeof TreePalm }[] = [
  { value: "all", label: "All photos", icon: Grid3x3 },
  { value: "outdoor", label: "Outdoor", icon: TreePalm },
  { value: "indoor", label: "Indoor", icon: Home },
  { value: "group", label: "Group only", icon: Users },
];

function Header() {
  const { user, isReady } = useAuth();
  return (
    <header className="border-b border-border">
      <div className="mx-auto max-w-5xl px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <span className="font-semibold tracking-tight">Luminiq</span>
        </div>
        {!isReady ? (
          <div className="h-8 w-20" />
        ) : user ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs">
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />

      <main className="mx-auto max-w-5xl px-6 py-10 space-y-8">
        {step === "choose" && (
          <>
            <section className="space-y-3">
              <h1 className="text-xl md:text-4xl font-semibold tracking-tight">
                <span className="whitespace-nowrap md:whitespace-normal">Transform thousands of photos into</span>
                <br className="md:hidden" />{" "}
                <span className="whitespace-nowrap md:whitespace-normal">organized galleries in minutes</span>
              </h1>
              <p className="text-muted-foreground max-w-2xl">
                Upload an entire shoot and let AI handle the sorting. Automatically group people, identify the best shots, remove duplicates, and organize your photos into ready-to-deliver collections.
              </p>
            </section>

            <div className="flex flex-col items-center justify-center py-16 gap-4 border border-dashed border-border rounded-xl">
              <input
                ref={photosInput}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleChooseFiles}
              />
              <Upload className="h-8 w-8 text-muted-foreground" />
              <Button size="lg" onClick={() => photosInput.current?.click()}>
                Choose files to sort
              </Button>
              <p className="text-xs text-muted-foreground">Up to 1000 JPGs. Nothing uploads until you tap Sort.</p>
            </div>
          </>
        )}

        {step === "options" && (
          <>
            <button
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setStep("choose")}
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Choose different files
            </button>

            <section className="space-y-1">
              <h1 className="text-lg font-semibold">{photos.length} photos selected</h1>
              <p className="text-sm text-muted-foreground">Set your sort options, then tap Sort.</p>
            </section>

            <Card className="p-5 space-y-3">
              <h2 className="font-medium">Sort type</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {SORT_TYPES.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    onClick={() => setSortType(value)}
                    className={`flex flex-col items-center gap-2 rounded-lg border p-4 text-sm transition-colors ${
                      sortType === value
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border hover:bg-accent text-muted-foreground"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {label}
                  </button>
                ))}
              </div>
            </Card>

            <Card className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Camera className="h-4 w-4 text-primary" />
                <h2 className="font-medium">Select person from reference image (optional)</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                One clear photo of the person you want pulled out of group shots. Leave empty to keep everyone.
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

            <Button size="lg" onClick={handleRun}>
              <Sparkles className="h-4 w-4 mr-2" /> Sort photos
            </Button>
          </>
        )}

        {(step === "running" || step === "done") && (
          <>
            <div className="flex flex-col items-start gap-3">
              {step === "running" ? (
                <Button size="lg" disabled>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Sorting…
                </Button>
              ) : (
                <Button variant="outline" onClick={reset}>
                  <RotateCcw className="h-4 w-4 mr-2" /> Sort another batch
                </Button>
              )}

              {(running || progress > 0) && (
                <div className="w-full space-y-2">
                  <Progress value={total ? (progress / total) * 100 : 0} />
                  <div className="text-xs text-muted-foreground">
                    {progress} / {total} · {status}
                  </div>
                </div>
              )}
            </div>

            <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {(Object.keys(CATEGORY_LABELS) as PhotoCategory[]).map((cat) => (
                <Card key={cat} className="p-4">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {CATEGORY_LABELS[cat]}
                  </div>
                  <div className="text-2xl font-semibold mt-1">{counts[cat]}</div>
                </Card>
              ))}
            </section>

            {shareUrl && (
              <Card className="p-5 space-y-3 border-primary/40">
                <div className="flex items-center gap-2">
                  <LinkIcon className="h-4 w-4 text-primary" />
                  <h2 className="font-medium">Client share link</h2>
                </div>
                <div className="flex flex-col md:flex-row gap-2">
                  <input
                    className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
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
                    className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    Open
                  </Link>
                </div>
                <p className="text-xs text-muted-foreground">
                  Links expire after 7 days of inactivity. Anyone with the link can view the photos.
                </p>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}
