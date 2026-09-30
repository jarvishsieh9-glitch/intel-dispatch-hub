import { getStore } from "@netlify/blobs";
import { collectItems, analyzeWithGemini } from "./_lib/intel.mjs";

export default async (req) => {
  const subscribersStore = getStore("subscribers");
  const intelStore = getStore("intel");

  const { blobs } = await subscribersStore.list();

  for (const { key } of blobs) {
    const sub = await subscribersStore.get(key, { type: "json" });
    if (!sub) continue;

    const items = await collectItems(sub, { verify: true });
    const summary = await analyzeWithGemini(sub, items);

    await intelStore.setJSON(`${sub.id}/latest.json`, {
      generatedAt: new Date().toISOString(),
      entries: items,
      summary,
    });
  }

  return new Response("ok");
};

// UTC 23:00 = 台灣時間隔日早上 7:00
export const config = { schedule: "0 23 * * *" };
