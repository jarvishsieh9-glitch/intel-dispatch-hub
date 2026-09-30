# 情報訂閱台 Intel Dispatch Hub

多人共用的產業情報訂閱服務。任何人開啟首頁填表單訂閱（產業、關鍵詞、YouTube 監控目標），就會拿到一個專屬儀表板連結。不需要自己申請任何 API 金鑰、不需要 GitHub 帳號。

## 架構

- `public/index.html` — 訂閱表單
- `public/dashboard.html` — 訂閱者查看每日情報的頁面
- `netlify/functions/subscribe.mjs` — 儲存新訂閱到 Netlify Blobs
- `netlify/functions/get-dashboard.mjs` — 讀取某訂閱者的設定與最新情報
- `netlify/functions/run-now.mjs` — 手動立即執行一次（給儀表板的「立即更新」按鈕用）
- `netlify/functions/run-daily-intel.mjs` — 排程函式，每天 UTC 23:00（台灣 07:00）自動跑過所有訂閱者
- `netlify/functions/_lib/intel.mjs` — 共用邏輯：抓 Google 新聞 RSS / YouTube、驗證連結、呼叫 Gemini 分析

所有資料存在 Netlify Blobs（Netlify 內建，不需要另外申請資料庫）。

## 部署前需要設定的環境變數（只需設定一次，全站共用）

到 Netlify 專案的 **Site configuration → Environment variables** 新增：

| 變數 | 用途 | 取得方式 |
|---|---|---|
| `GEMINI_API_KEY` | AI 分析摘要 | https://aistudio.google.com/apikey |
| `YOUTUBE_API_KEY` | YouTube 頻道/關鍵字監控 | Google Cloud Console 啟用 YouTube Data API v3 後建立 API 金鑰 |

這兩把金鑰由網站擁有者（您）設定一次，之後所有訂閱者都共用，訂閱者本人完全不需要碰任何金鑰。

## 核心原則

每一則情報寫入前都會檢查是否附有原始來源連結；沒有連結的項目一律捨棄，不進入 AI 分析與儀表板。
