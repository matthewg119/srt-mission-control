// What category a live hub page tells the concierge widget it is.
//
// This is the one hole in a rail that was otherwise already built end to end:
//
//   ConciergeEmbed(category) -> data-category -> embed.js -> ?category= -> /w/[slug]
//     -> body.category -> startConciergeSession -> session.pageCategory -> MagnetQuery.category
//
// Every hop of that existed and worked. What never happened was the first one: the hub page render
// passed no category, because nothing on client_pages carries one. So MagnetQuery.category was null
// on every request, and rungOf correctly refuses a CATEGORISED library row against a null query, so
// every categorised magnet in the library was unreachable from every page ever published.
//
// ‼️ READ FROM page_plan THROUGH page_id, NOT FROM A NEW COLUMN ON client_pages. src/lib/hub/pages.ts
// builds its page read as ONE string literal, shared by every client's live site, and PostgREST
// fails a WHOLE select on one unknown column name. A client_pages.post_format would therefore take
// down every hub page for every client in the window between the deploy and the migration. One
// indexed read inside a render that is already cached is the cheaper trade by a distance.
//
// ‼️ NULL IS A REAL ANSWER AND IT IS THE DEFAULT. A page written in the studio with no plan row
// behind it has no theme and no shape, and the honest thing to send is nothing, which is exactly
// what every page sends today. Any failure degrades to that, so this file can never cost a page.

import { supabaseAdmin } from "@/lib/db";
import { categoryFor } from "@/config/post-formats";

export async function pageCategoryFor(clientId: string, pageId: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("page_plan")
      .select("theme, post_format")
      .eq("client_id", clientId)
      .eq("page_id", pageId)
      .maybeSingle();

    if (error) {
      // Degrades to exactly today's behaviour: no category, and the ladder decides as it always has.
      console.error(`[hub/page-category] ${error.message}`);
      return null;
    }
    if (!data) return null;

    return categoryFor({
      postFormat: (data.post_format as string | null) ?? null,
      theme: (data.theme as string | null) ?? null,
    });
  } catch (e) {
    console.error("[hub/page-category] threw:", (e as Error).message);
    return null;
  }
}
