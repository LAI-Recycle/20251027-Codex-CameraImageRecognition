相機臉部辨識
============

此專案提供兩種臉部辨識方式：

- 本機 Python 應用程式（`camera_recognition.py`），搭配 `face_recognition` 及 OpenCV 透過電腦攝影機偵測與辨識。
- 靜態網頁（`docs/`），採用 `face-api.js`，可部署到 GitHub Pages，所有運算皆在瀏覽器端完成。

方案一：本機 Python 應用
------------------------

### 系統需求
- Python 3.9-3.11（建議 64 位元）
- 能在其他 Windows 應用程式正常運作的攝影機
- Visual C++ 14 Build Tools（若安裝輪子失敗才需要）

### 建置步驟
1. 建議建立虛擬環境：
   ```
   py -3.10 -m venv .venv
   .\.venv\Scripts\activate
   ```
2. 安裝套件：
   ```
   pip install --upgrade pip
   pip install face-recognition opencv-python
   ```
3. 準備已知人臉資料：
   - 建立 `known_faces` 目錄。
   - 在其中為每個人建立子目錄（避免路徑問題，建議使用英文，例如 `Alice`、`Bob`）。
   - 在各子目錄放入一張或多張清晰正臉照片（JPG/PNG）。

### 執行方式
1. 確認虛擬環境已啟動且套件安裝完成。
2. 在專案根目錄執行：
   ```
   python camera_recognition.py
   ```
3. 會開啟視窗顯示攝影機畫面：
   - 已知人臉會顯示對應名稱。
   - 未知人臉顯示 `Unknown`。
   - 按 `q` 離開程式。

### 設定調整
- 若開啟錯誤的攝影機，可在程式中修改 `VIDEO_SOURCE_INDEX`（常見為 0、1、2）。
- 可透過 `FACE_DISTANCE_THRESHOLD` 調整辨識門檻（數值越低越嚴格）。
- 想保存未知人臉供日後檢視，可將 `SAVE_UNKNOWN_FACES` 改為 `True`，並確認 `unknown_faces` 目錄存在。

### 常見問題
- 安裝 `face-recognition` 失敗：請先更新 pip，確認 Python 版本支援，必要時安裝 Visual C++ Build Tools。
- 辨識不準：提供更多高品質照片並保持光線均勻。
- 效能不足：程式預設縮小影像提升速度，可調整 `FRAME_RESIZE_SCALE` 以取得更高畫質。

方案二：GitHub Pages 網頁示範
-----------------------------

`docs/` 目錄提供純瀏覽器版本，使用 `face-api.js` 完成臉部偵測與辨識。影像不會上傳至伺服器。

### 快速預覽（本機）
1. 透過 HTTPS 或 `http://localhost` 服務 `docs/` 目錄（`getUserMedia` 需要安全來源）。例如使用 Python 3：
   ```
   py -m http.server 8000 --directory docs
   ```
2. 於瀏覽器（Chrome、Edge、Firefox）開啟 `http://localhost:8000`。
3. 點擊 **載入模型**（模型將從公共 CDN 下載）。
4. 對每位要辨識的人：
   - 輸入標籤名稱。
   - 選擇一張或多張清晰照片並按 **新增已知人臉（上傳）**，或啟動攝影機後按 **拍照新增已知人臉** 直接擷取影像。
5. 點擊 **啟動攝影機** 並授權使用。畫面會顯示偵測框與最佳匹配結果。

### 部署到 GitHub Pages
1. 將此專案推送至 GitHub。
2. 在 Repository 設定中開啟 GitHub Pages，設定：
   - **Source**：`main`（或你的預設分支）
   - **Folder**：`/docs`
3. GitHub Pages 會自動將 `docs/index.html` 發佈在 `https://<使用者名稱>.github.io/<儲存庫>/`。
4. 造訪網站，載入模型、加入標記照片，即可直接在瀏覽器辨識。
   - 需要時也可在啟動攝影機後使用 **拍照新增已知人臉** 即時建立樣本。

### 注意事項
- 臉部特徵只儲存在記憶體中，重新整理頁面後會清除。若需永久保存，可擴充 `app.js` 將資料存到 IndexedDB 或預先讀取 JSON。
- 示範使用 Tiny Face Detector 取得較佳效能，可在 `docs/app.js` 調整 `TINY_FACE_DETECTOR_OPTIONS` 及匹配門檻改變靈敏度。
- 模型需從 CDN 載入，第一次使用可能需耗費數秒，視網路速度而定。
