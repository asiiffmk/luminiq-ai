import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listShare } from "@/lib/share.functions";
import { CATEGORY_LABELS, type PhotoCategory } from "@/lib/photo-analysis";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/share/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Your photos · PhotoSort` },
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
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="p-6 max-w-md">
          <h2 className="font-semibold mb-2">Couldn't load this gallery</h2>
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
    <div className="min-h-screen flex items-center justify-center">
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
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading gallery…
      </div>
    );
  }

  const folders = data.folders;
  const cats = Object.keys(folders) as PhotoCategory[];

  if (!cats.length) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">This gallery is empty.</p>
      </div>
    );
  }

  const current = active ?? cats[0];
  const photos = folders[current] ?? [];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-5 flex items-center justify-between">
          <Link to="/" className="font-semibold tracking-tight">
            PhotoSort
          </Link>
          <span className="text-xs text-muted-foreground">Gallery {id}</span>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8 grid md:grid-cols-[220px_1fr] gap-8">
        <aside className="space-y-1">
          {cats.map((c) => (
            <button
              key={c}
              onClick={() => setActive(c)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                current === c
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent text-foreground"
              }`}
            >
              <div className="font-medium">{CATEGORY_LABELS[c]}</div>
              <div className="text-xs opacity-70">{folders[c].length} photos</div>
            </button>
          ))}
        </aside>

        <section>
          <h1 className="text-2xl font-semibold mb-4">{CATEGORY_LABELS[current]}</h1>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {photos.map((p) => (
              <a
                key={p.url}
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="block aspect-square overflow-hidden rounded-md bg-muted"
              >
                <img
                  src={p.url}
                  alt={p.name}
                  loading="lazy"
                  className="h-full w-full object-cover hover:scale-105 transition-transform"
                />
              </a>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}