import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const BUCKET = "sorted-photos";
const SIGN_EXPIRES = 60 * 60 * 24 * 7; // 7 days

export const listShare = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ shareId: z.string().min(4).max(80) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin: supabase } = await import("@/integrations/supabase/client.server");

    const categories = ["keepers", "blurry", "tilted", "outdoor", "indoor", "selected_person"];
    const folders: Record<string, { name: string; url: string }[]> = {};

    for (const cat of categories) {
      const { data: files, error } = await supabase.storage
        .from(BUCKET)
        .list(`${data.shareId}/${cat}`, { limit: 1000 });
      if (error || !files?.length) continue;
      const paths = files
        .filter((f) => f.name && !f.name.startsWith("."))
        .map((f) => `${data.shareId}/${cat}/${f.name}`);
      if (!paths.length) continue;
      const { data: signed } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(paths, SIGN_EXPIRES);
      folders[cat] = (signed ?? [])
        .filter((s) => s.signedUrl)
        .map((s, i) => ({ name: files[i].name, url: s.signedUrl! }));
    }

    return { shareId: data.shareId, folders };
  });