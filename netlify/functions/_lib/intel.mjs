import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

const LOCALE_LABELS = {
  "zh-TW|TW|TW:zh-Hant": "繁體中文（台灣）",
  "zh-CN|CN|CN:zh-Hans": "简体中文（中国）",
  "en-US|US|US:en": "English（US）",
  "ja|JP|JP:ja": "日本語（日本）",
};

export function buildNewsUrl(query, localeKey) {
  const [hl, gl, ceid] = localeKey.split("|");
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${hl}&gl=${gl}&ceid=${encodeURIComponent(ceid)}`;
}

function asArray(x) {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

async function fetchText(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 IntelDispatchBot/1.0" } });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fetchNewsGroup(group) {
  const xml = await fetchText(group.url);
  if (!xml) return [];
  let parsed;
  try {
    parsed = parser.parse(xml);
  } catch {
    return [];
  }
  const items = asArray(parsed?.rss?.channel?.item);
  return items
    .map((it) => ({
      sourceType: "news",
      group: group.group,
      title: typeof it.title === "string" ? it.title : it.title?.["#text"] || "",
      summary: typeof it.description === "string" ? it.description : it.description?.["#text"] || "",
      link: typeof it.link === "string" ? it.link.trim() : "",
      published: it.pubDate || "",
    }))
    .filter((it) => it.link);
}

async function resolveHandleToChannelId(handle, apiKey) {
  if (!apiKey) return null;
  const url = `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(handle.replace(/^@/, ""))}&key=${apiKey}`;
  const text = await fetchText(url);
  if (!text) return null;
  try {
    const data = JSON.parse(text);
    return data.items?.[0]?.id || null;
  } catch {
    return null;
  }
}

function extractChannelRef(raw) {
  const line = raw.trim();
  const channelMatch = line.match(/\/channel\/(UC[a-zA-Z0-9_-]{10,})/);
  if (channelMatch) return { type: "id", value: channelMatch[1] };
  const bareId = line.match(/^UC[a-zA-Z0-9_-]{10,}$/);
  if (bareId) return { type: "id", value: line };
  const handle = line.match(/@([a-zA-Z0-9._-]+)/);
  if (handle) return { type: "handle", value: `@${handle[1]}` };
  return null;
}

async function fetchYoutubeChannelItems(sub, apiKey) {
  const refs = (sub.ytChannels || []).map(extractChannelRef).filter(Boolean);
  const ids = [];
  for (const ref of refs) {
    if (ref.type === "id") {
      ids.push(ref.value);
    } else {
      const resolved = await resolveHandleToChannelId(ref.value, apiKey);
      if (resolved) ids.push(resolved);
    }
  }
  const results = await Promise.all(
    ids.map(async (cid) => {
      const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${cid}`);
      if (!xml) return [];
      let parsed;
      try {
        parsed = parser.parse(xml);
      } catch {
        return [];
      }
      const entries = asArray(parsed?.feed?.entry);
      return entries
        .map((e) => ({
          sourceType: "youtube",
          group: "頻道監控",
          title: e.title || "",
          summary: e["media:group"]?.["media:description"] || "",
          link: e.link?.["@_href"] || "",
          published: e.published || "",
        }))
        .filter((it) => it.link);
    })
  );
  return results.flat();
}

async function fetchYoutubeSearchItems(sub, apiKey) {
  const keywords = sub.ytKeywords || [];
  if (!keywords.length || !apiKey) return [];
  const publishedAfter = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const results = await Promise.all(
    keywords.map(async (kw) => {
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date&maxResults=10&publishedAfter=${publishedAfter}&q=${encodeURIComponent(kw)}&key=${apiKey}`;
      const text = await fetchText(url);
      if (!text) return [];
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return [];
      }
      return (data.items || [])
        .map((it) => {
          const videoId = it.id?.videoId;
          if (!videoId) return null;
          return {
            sourceType: "youtube",
            group: `關鍵字：${kw}`,
            title: it.snippet?.title || "",
            summary: it.snippet?.description || "",
            link: `https://www.youtube.com/watch?v=${videoId}`,
            published: it.snippet?.publishedAt || "",
          };
        })
        .filter(Boolean);
    })
  );
  return results.flat();
}

async function verifyLink(url, timeoutMs = 4000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    return resp.status < 400;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function collectItems(sub, { verify = true } = {}) {
  const apiKey = process.env.YOUTUBE_API_KEY || "";
  const newsGroups = (sub.keywordGroups || []).map((g) => ({
    group: g.group,
    url: buildNewsUrl(g.query, sub.localeKey || "zh-TW|TW|TW:zh-Hant"),
  }));

  const [newsResults, ytChannelItems, ytSearchItems] = await Promise.all([
    Promise.all(newsGroups.map(fetchNewsGroup)),
    fetchYoutubeChannelItems(sub, apiKey),
    fetchYoutubeSearchItems(sub, apiKey),
  ]);

  let items = [...newsResults.flat(), ...ytChannelItems, ...ytSearchItems].filter((it) => it.link);

  if (verify) {
    const verified = await Promise.all(items.map((it) => verifyLink(it.link)));
    items = items.filter((_, i) => verified[i]);
  }

  return items;
}

function buildPrompt(sub, items) {
  const groupsList = (sub.keywordGroups || []).map((g, i) => `${i + 1}. ${g.query}`).join("\n") || "（未設定關鍵詞組）";
  const ytKwList = (sub.ytKeywords || []).join("、") || "（未設定）";
  const [f1, f2, f3] = sub.coreFields?.length ? sub.coreFields : ["重點摘要", "對本公司的商業影響", "建議行動方案"];
  const itemsText = items
    .map((it) => `[${it.sourceType}] ${it.title}\n連結：${it.link}\n摘要：${(it.summary || "").slice(0, 300)}`)
    .join("\n\n");

  return `# 角色
你是「${sub.industry}」產業的情報分析助理，服務對象是${sub.role}。

# 輸入資料
你會收到今日抓取到的新聞條目與 YouTube 影片條目，每筆皆包含：標題、摘要或文字稿片段、來源連結、發布時間。

# 追蹤關鍵詞組
${groupsList}

# YouTube 關鍵字
${ytKwList}

# 嚴格規則（不可違反）
1. 只根據輸入資料中的標題與摘要/文字稿進行判讀，禁止使用你自身知識庫補充任何未在輸入資料中出現的事實、數字或事件。
2. 每一則輸出的情報都必須附上對應的「來源連結」欄位；若輸入資料缺少連結，直接捨棄該筆，不得輸出、不得杜撰連結。
3. 若輸入資料不足以判斷商業影響或建議行動，請明確回覆「資訊不足，待更多來源確認」，不要臆測。
4. 摘要與洞察需分別標註對應的來源連結，讀者需能一鍵回溯原文。

# 輸出格式（逐筆情報）
- 標題：
- 來源連結：
- ${f1}（100 字內）：
- ${f2}：
- ${f3}：

# 每日總結（彙整所有情報後）
- 產業新聞／影音綜合摘要（100 字內，需標註引用的來源連結）
- 針對${sub.role}的關鍵洞察與商業影響
- 建議行銷／策略內容切角
- 今日建議優先選擇行動方案（分為：優先執行、重點產出、後續追蹤），每項需註明依據來自哪一則情報（附連結）

今日輸入資料：
${itemsText}`;
}

export async function analyzeWithGemini(sub, items) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return "尚未設定 GEMINI_API_KEY，無法產生分析摘要。";
  if (!items.length) return "今日未擷取到任何具備有效來源連結的情報。";

  const prompt = buildPrompt(sub, items);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
  const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });

  const maxAttempts = 3;
  let lastError = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (resp.ok) {
      const data = await resp.json();
      return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "AI 未回傳內容。";
    }
    const errText = await resp.text().catch(() => "");
    lastError = `AI 分析失敗（HTTP ${resp.status}）：${errText.slice(0, 200)}`;
    // 503 是暫時性過載，值得重試；其他錯誤（如金鑰/格式問題）重試也沒用，直接回傳
    if (resp.status !== 503 || attempt === maxAttempts) break;
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
  return lastError;
}

export { LOCALE_LABELS };
