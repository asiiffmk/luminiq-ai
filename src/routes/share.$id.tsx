import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listShare } from "@/lib/share.functions";
import { CATEGORY_LABELS, type PhotoCategory } from "@/lib/photo-analysis";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

export const Route = createFileRoute("/share/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Your photos · Luminiq` },
      { name: "description", content: `Sorted wedding photo gallery ${params.id}` },
      { property: "og:title", content: "Your sorted wedding photos" },
      { property: "og:description", content: "Open your sorted photo folders." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: SharePage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <Card className="p-6 max-w-md border-border">
          <h2 className="font-display text-lg uppercase tracking-tight mb-2">Couldn't load this gallery</h2>
          <p className="text-sm text-muted-foreground mb-4">{error.message}</p>
          <Button
            onClick={() => {
              router.invalidate();
              reset();
            }}
          >
            Try again
          </Button>
        </Card>
      </div>
    );
  },
  notFoundComponent: () => (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <p className="text-muted-foreground">Gallery not found.</p>
    </div>
  ),
});

function SharePage() {
  const { id } = Route.useParams();
  const list = useServerFn(listShare);
  const { data, isLoading } = useQuery({
    queryKey: ["share", id],
    queryFn: () => list({ data: { shareId: id } }),
  });
  const [active, setActive] = useState<PhotoCategory | null>(null);

  if (isLoading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground bg-background">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading gallery…
      </div>
    );
  }

  const folders = data.folders;
  const cats = Object.keys(folders) as PhotoCategory[];

  if (!cats.length) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">This gallery is empty.</p>
      </div>
    );
  }

  const current = active ?? cats[0];
  const photos = folders[current] ?? [];

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-background">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-negative text-background">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="font-display text-lg uppercase tracking-[0.08em]">Luminiq</span>
          </Link>
          <span className="frame-counter">GALLERY {id.toUpperCase()}</span>
        </div>
        <div className="filmstrip h-3 w-full" aria-hidden="true" />
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8 grid md:grid-cols-[220px_1fr] gap-8">
        <aside className="space-y-1">
          {cats.map((c) => (
            <button
              key={c}
              onClick={() => setActive(c)}
              className={`dial-chip w-full text-left px-3 py-2.5 rounded-md text-sm border-2 ${
                current === c
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-transparent hover:bg-accent text-foreground"
              }`}
            >
              <div className="font-medium">{CATEGORY_LABELS[c]}</div>
              <div className="text-xs opacity-70 font-mono">{folders[c].length} photos</div>
            </button>
          ))}
        </aside>

        <section>
          <h1 className="font-display text-2xl uppercase tracking-tight mb-4">{CATEGORY_LABELS[current]}</h1>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {photos.map((p, i) => (
              <a
                key={p.url}
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="develop-in block aspect-square overflow-hidden rounded-md bg-muted relative"
                style={{ animationDelay: `${Math.min(i, 24) * 35}ms` }}
              >
                <span className="absolute left-1.5 top-1.5 z-10 frame-counter rounded-sm bg-negative/70 px-1.5 py-0.5 text-background">
                  F·{String(i + 1).padStart(3, "0")}
                </span>
                <img
                  src={p.url}
                  alt={p.name}
                  loading="lazy"
                  className="h-full w-full object-cover hover:scale-105 transition-transform duration-300"
                />
              </a>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
