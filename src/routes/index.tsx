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
  CATEGORY_LABELS,
  type PhotoCategory,
} from "@/lib/photo-analysis";
import { Camera, Upload, Sparkles, Link as LinkIcon, Loader2 } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PhotoSort — Auto-sort wedding photos in your browser" },
      {
        name: "description",
        content:
          "Upload up to 1000 wedding photos and automatically sort out blurry, tilted, indoor/outdoor and selected-person shots. 100% browser-based, free, with shareable client links.",
      },
      { property: "og:title", content: "PhotoSort — Auto-sort wedding photos" },
      {
        property: "og:description",
        content: "Auto-sort blurry, tilted, indoor/outdoor and selected-person shots in your browser.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Index,
});

const BUCKET = "sorted-photos";

type Counts = Record<PhotoCategory, number>;
const EMPTY_COUNTS: Counts = {
  keepers: 0, blurry: 0, tilted: 0, outdoor: 0, indoor: 0, selected_person: 0,
};

function Index() {
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const refInput = useRef<HTMLInputElement>(null);
  const photosInput = useRef<HTMLInputElement>(null);

  async function handleRun() {
    if (!photos.length) {
      toast.error("Add some photos first");
      return;
    }
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

      const shareId = crypto.randomUUID().slice(0, 12);
      const live: Counts = { ...EMPTY_COUNTS };

      for (let i = 0; i < photos.length; i++) {
        const file = photos[i];
        setStatus(`Analyzing ${file.name}`);
        try {
          const result = await analyzePhoto(file, referenceDescriptor);
          for (const cat of result.categories) {
            live[cat] += 1;
            const path = `${shareId}/${cat}/${Date.now()}_${i}_${sanitize(file.name)}`;
            await supabase.storage.from(BUCKET).upload(path, file, {
              contentType: file.type || "image/jpeg",
              upsert: false,
            });
          }
        } catch (e) {
          console.error("Failed", file.name, e);
        }
        setProgress(i + 1);
        setCounts({ ...live });
      }

      const url = `${window.location.origin}/share/${shareId}`;
      setShareUrl(url);
      setStatus("Done");
      toast.success("Sorted! Share link is ready.");
    } catch (e) {
      console.error(e);
      toast.error("Something went wrong. Check the console.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto max-w-5xl px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <span className="font-semibold tracking-tight">PhotoSort</span>
          </div>
          <span className="text-xs text-muted-foreground">Runs 100% in your browser</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10 space-y-8">
        <section className="space-y-3">
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
            Sort a wedding shoot in minutes.
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            Drop up to 1000 photos. We detect blurry / tilted shots, separate indoor from
            outdoor, and pull out every photo containing a chosen person. Then we hand you a
            shareable link for the client.
          </p>
        </section>

        <div className="grid md:grid-cols-2 gap-4">
          <Card className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Camera className="h-4 w-4 text-primary" />
              <h2 className="font-medium">1. Reference person (optional)</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              One clear photo of the person you want pulled out of group shots.
            </p>
            <input
              ref={refInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setReferenceFile(e.target.files?.[0] ?? null)}
            />
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => refInput.current?.click()} disabled={running}>
                Choose photo
              </Button>
              <span className="text-sm truncate">
                {referenceFile?.name ?? <span className="text-muted-foreground">none</span>}
              </span>
            </div>
          </Card>

          <Card className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-primary" />
              <h2 className="font-medium">2. Shoot photos</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Select up to 1000 JPGs. Nothing is uploaded until sorting finishes.
            </p>
            <input
              ref={photosInput}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 1000))}
            />
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => photosInput.current?.click()} disabled={running}>
                Choose photos
              </Button>
              <span className="text-sm">{photos.length} selected</span>
            </div>
          </Card>
        </div>

        <div className="flex flex-col items-start gap-3">
          <Button size="lg" onClick={handleRun} disabled={running || !photos.length}>
            {running ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Sorting…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" /> Sort photos
              </>
            )}
          </Button>

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
      </main>
    </div>
  );
}

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}
