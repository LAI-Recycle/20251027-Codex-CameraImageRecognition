# 人臉辨識示範專案

這個專案包含兩個部分：

- `index.html`、`app.js`、`styles.css`：瀏覽器端的人臉辨識介面，使用 `face-api.js` 於前端計算臉部特徵，並可將結果同步到 Supabase。
- `camera_recognition.py`：原始的 Python 範例 (OpenCV + face_recognition)，可在本機測試或擴充。

> 建議前端與 Supabase Edge Functions 搭配使用，以保持 GitHub Pages 的純靜態部署，同時安全儲存人臉向量資料。

---

## 1. 瀏覽器端使用方式

1. 以 `index.html` 為入口，在支援 HTTPS 的環境 (GitHub Pages 或本機 HTTPS server) 開啟。
2. 點擊「載入模型」，待模型載入完成後才能進行人臉偵測。
3. 有兩種方式建立已知人像：
   - 上傳照片：輸入標籤，選擇一張或多張人臉照片，再按「加入已知人像（上傳）」。
   - 即時拍攝：啟動攝影機後，輸入標籤並按「拍照加入已知人像」。
4. 每次新增或更新人像後，前端會：
   - 更新瀏覽器記憶中的 `faceMatcher`。
   - 將特徵向量 (embedding) 送至 Supabase Edge Function 儲存。
   - 重新同步遠端資料，確保本機狀態與資料庫一致。
5. 進行辨識時，系統會在畫面上標記人臉與辨識結果：
   - 顯示名稱與距離 (相似度)。
   - 無法辨識時會顯示「未知」。

---

## 2. Supabase 設定流程

### 2.1 建立資料表並啟用 pgvector

在 Supabase SQL Editor 執行下列語法 (若模型 embedding 長度非 128，請調整 `vector(128)` 的值)：

```sql
create extension if not exists vector with schema public;

create table if not exists public.faces (
  id uuid default gen_random_uuid() primary key,
  label text not null,
  embedding vector(128) not null,
  created_at timestamptz default timezone('utc', now())
);

create index if not exists faces_label_idx on public.faces (label);
create index if not exists faces_embedding_idx on public.faces using ivfflat (embedding vector_cosine_ops) with (lists = 100);
```

### 2.2 部署 Edge Functions

專案已提供兩個範例函式：

- `supabase/functions/faces-register/index.ts`：接收人臉向量並寫入資料表。
- `supabase/functions/faces-list/index.ts`：回傳資料表內容供前端同步。

在專案根目錄執行：

```bash
supabase functions deploy faces-register --no-verify-jwt
supabase functions deploy faces-list --no-verify-jwt
```

> 若未來需要權限控管，可移除 `--no-verify-jwt` 並整合 Supabase Auth。

### 2.3 設定 Secrets

將以下參數替換為你的實際專案資訊後執行：

```bash
supabase secrets set \
  SUPABASE_URL=https://<project-ref>.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
  ALLOWED_ORIGINS="https://<username>.github.io,https://<username>.github.io/<repo>,http://localhost:8000"
```

- `SUPABASE_SERVICE_ROLE_KEY` 僅供 Edge Functions 使用，請勿在前端暴露。
- `ALLOWED_ORIGINS` 設定允許呼叫函式的網域，可同時包含 GitHub Pages 與本機開發位址。

### 2.4 前端設定

在 `index.html` 的設定區塊更新 Functions 網域：

```html
<script>
  window.__FACE_STORE_CONFIG__ = Object.assign(
    {
      functionsBaseUrl: "https://<project-ref>.functions.supabase.co",
      listPath: "/faces-list",
      registerPath: "/faces-register",
    },
    window.__FACE_STORE_CONFIG__
  );
</script>
```

---

## 3. Python 範例 (camera_recognition.py)

若想在本機使用 Python 進行偵測：

1. 建議使用 Python 3.9 ~ 3.11，並建立虛擬環境。  
   ```bash
   py -3.10 -m venv .venv
   .\.venv\Scripts\activate
   pip install --upgrade pip
   pip install face-recognition opencv-python
   ```
2. 建立資料夾 `known_faces/<名稱>`，並放入欲辨識對象的照片。
3. 執行 `python camera_recognition.py`，程式會開啟攝影機並於畫面上顯示辨識結果。按 `q` 結束。
4. 可調整程式頂端參數以改善辨識效果，例如：
   - `VIDEO_SOURCE_INDEX`：選擇攝影機。
   - `FACE_DISTANCE_THRESHOLD`：辨識距離門檻。
   - `SAVE_UNKNOWN_FACES`：是否儲存未知人臉截圖。

---

## 4. 常見注意事項

- GitHub Pages 為純靜態託管，無法直接儲存資料，務必透過 Supabase Edge Functions 或其他後端服務。
- 請妥善保護 Supabase Service Role Key，僅存放於 Edge Functions 或安全的伺服器環境。
- 若資料量提升，可調整 pgvector 的索引參數或改用更專業的向量資料庫。
- 在公開環境處理人臉資料時，記得遵循當地法規並取得使用者同意。
