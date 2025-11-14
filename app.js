const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/";
const TINY_FACE_DETECTOR_OPTIONS = new faceapi.TinyFaceDetectorOptions({
  inputSize: 320,
  scoreThreshold: 0.5,
});

const loadModelsBtn = document.getElementById("load-models-btn");
const modelsStatus = document.getElementById("models-status");
const labelInput = document.getElementById("label-input");
const imagesInput = document.getElementById("images-input");
const addKnownBtn = document.getElementById("add-known-btn");
const captureKnownBtn = document.getElementById("capture-known-btn");
const knownList = document.getElementById("known-list");
const startCameraBtn = document.getElementById("start-camera-btn");
const stopCameraBtn = document.getElementById("stop-camera-btn");
const clearCacheBtn = document.getElementById("clear-cache-btn");
const cameraStatus = document.getElementById("camera-status");
const welcomeMessage = document.getElementById("welcome-message");
const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const overlayCtx = overlay.getContext("2d");

const FACE_STORE_CONFIG = window.__FACE_STORE_CONFIG__ || {};
const FUNCTIONS_BASE_URL = (FACE_STORE_CONFIG.functionsBaseUrl || "").replace(/\/$/, "");
const FUNCTION_PATHS = {
  list: FACE_STORE_CONFIG.listPath || "/faces-list",
  register: FACE_STORE_CONFIG.registerPath || "/faces-register",
};
const SHOULD_USE_REMOTE_STORE = Boolean(FUNCTIONS_BASE_URL);
const LOCAL_STORAGE_KEY = "face-recognition-known-faces";
const RECOGNITION_DURATION_MS = 1000;
const RECOGNITION_RESET_MS = 2000;
const WELCOME_MESSAGE_DURATION_MS = 5000;

let modelsLoaded = false;
let labeledDescriptors = [];
let faceMatcher = null;
let detectionActive = false;
let detectionIntervalId = null;
let processingFrame = false;
let mediaStream = null;
let remoteSyncCompleted = false;
const recognitionSessions = new Map();
let welcomeMessageTimeout = null;

function setStatus(element, message, type = null) {
  element.textContent = message;
  element.classList.remove("ready", "warn");
  if (type === "ready") {
    element.classList.add("ready");
  } else if (type === "warn") {
    element.classList.add("warn");
  }
}

function buildFunctionUrl(pathKey) {
  if (!SHOULD_USE_REMOTE_STORE) {
    return null;
  }
  const path = FUNCTION_PATHS[pathKey];
  if (!path) {
    return null;
  }
  const normalisedPath = path.startsWith("/") ? path : `/${path}`;
  return `${FUNCTIONS_BASE_URL}${normalisedPath}`;
}

function persistLocalDescriptors() {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  if (labeledDescriptors.length === 0) {
    removeLocalCacheEntry();
    return;
  }

  try {
    const payload = labeledDescriptors.map((entry) => ({
      label: entry.label,
      descriptors: entry.descriptors.map((descriptor) => Array.from(descriptor)),
    }));
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("儲存本機快取失敗", error);
  }
}

function removeLocalCacheEntry() {
  if (typeof window === "undefined" || !window.localStorage) {
    return false;
  }
  try {
    window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    return true;
  } catch (error) {
    console.warn("刪除本機快取失敗", error);
    return false;
  }
}

function restoreKnownFacesFromLocal() {
  if (typeof window === "undefined" || !window.localStorage) {
    return false;
  }

  let raw;
  try {
    raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
  } catch (error) {
    console.warn("讀取本機快取失敗", error);
    return false;
  }

  if (!raw) {
    return false;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    console.warn("解析本機快取失敗", error);
    return false;
  }

  if (!Array.isArray(payload)) {
    return false;
  }

  const nextDescriptors = [];
  payload.forEach((item) => {
    if (!item || typeof item.label !== "string" || !Array.isArray(item.descriptors)) {
      return;
    }
    const descriptors = item.descriptors
      .filter((descriptor) => Array.isArray(descriptor) && descriptor.length > 0)
      .map((descriptor) => new Float32Array(descriptor));
    if (descriptors.length > 0) {
      nextDescriptors.push(new faceapi.LabeledFaceDescriptors(item.label, descriptors));
    }
  });

  if (nextDescriptors.length === 0) {
    return false;
  }

  labeledDescriptors = nextDescriptors;
  rebuildMatcher();
  return true;
}

function removeLabelFromCache(label) {
  if (!label) {
    return;
  }

  const nextDescriptors = labeledDescriptors.filter((entry) => entry.label !== label);
  if (nextDescriptors.length === labeledDescriptors.length) {
    return;
  }

  labeledDescriptors = nextDescriptors;
  remoteSyncCompleted = false;
  rebuildMatcher();

  const message = SHOULD_USE_REMOTE_STORE
    ? `已刪除 ${label} 的本機快取，下次同步會重新載入遠端資料`
    : `已刪除 ${label} 的本機快取`;
  setStatus(modelsStatus, message, "ready");
}

function handleClearCacheClick() {
  const confirmed = window.confirm("確定要刪除本機快取嗎？此動作無法復原。");
  if (!confirmed) {
    return;
  }

  labeledDescriptors = [];
  remoteSyncCompleted = false;
  rebuildMatcher();

  const removed = removeLocalCacheEntry();
  if (removed) {
    const message = SHOULD_USE_REMOTE_STORE
      ? "已清除本機快取，若要恢復資料請重新同步遠端紀錄"
      : "已清除本機快取，目前沒有任何已知人像";
    setStatus(modelsStatus, message, "ready");
  } else {
    setStatus(modelsStatus, "刪除本機快取失敗，請稍後再試", "warn");
  }
}

function rebuildMatcher() {
  faceMatcher = labeledDescriptors.length
    ? new faceapi.FaceMatcher(labeledDescriptors, 0.45)
    : null;
  updateKnownList();
  persistLocalDescriptors();
}

restoreKnownFacesFromLocal();

function showWelcomeMessage(label) {
  if (!welcomeMessage) {
    return;
  }
  welcomeMessage.textContent = `歡迎回來，${label}！`;
  welcomeMessage.classList.add("visible");
  welcomeMessage.setAttribute("aria-hidden", "false");
  if (welcomeMessageTimeout) {
    clearTimeout(welcomeMessageTimeout);
  }
  welcomeMessageTimeout = setTimeout(hideWelcomeMessage, WELCOME_MESSAGE_DURATION_MS);
}

function hideWelcomeMessage() {
  if (!welcomeMessage) {
    return;
  }
  welcomeMessage.classList.remove("visible");
  welcomeMessage.setAttribute("aria-hidden", "true");
  if (welcomeMessageTimeout) {
    clearTimeout(welcomeMessageTimeout);
    welcomeMessageTimeout = null;
  }
}

function updateRecognitionSession(label) {
  if (!label) {
    return;
  }
  const now = Date.now();
  const session =
    recognitionSessions.get(label) || { start: now, lastSeen: now, triggered: false };
  if (now - session.lastSeen > RECOGNITION_RESET_MS) {
    session.start = now;
    session.triggered = false;
  }
  session.lastSeen = now;
  if (!session.triggered && now - session.start >= RECOGNITION_DURATION_MS) {
    session.triggered = true;
    showWelcomeMessage(label);
  }
  recognitionSessions.set(label, session);
}

function cleanupRecognitionSessions() {
  const now = Date.now();
  recognitionSessions.forEach((session, label) => {
    if (now - session.lastSeen > RECOGNITION_RESET_MS) {
      recognitionSessions.delete(label);
    }
  });
}

function resetRecognitionTracking() {
  recognitionSessions.clear();
  hideWelcomeMessage();
}

async function syncKnownFacesFromRemote(force = false, options = {}) {
  if (!SHOULD_USE_REMOTE_STORE) {
    return;
  }

  const { silent = false } = options || {};

  if (remoteSyncCompleted && !force) {
    return;
  }

  const endpoint = buildFunctionUrl("list");
  if (!endpoint) {
    return;
  }

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const faces = Array.isArray(payload?.faces) ? payload.faces : [];

    if (faces.length === 0) {
      labeledDescriptors = [];
      rebuildMatcher();
      remoteSyncCompleted = true;
      if (!silent) {
        setStatus(modelsStatus, "遠端未找到已知人像", "warn");
      }
      return;
    }

    const grouped = new Map();
    faces.forEach((item) => {
      if (!item || typeof item.label !== "string" || !Array.isArray(item.embedding)) {
        return;
      }
      const descriptor = new Float32Array(item.embedding);
      if (!grouped.has(item.label)) {
        grouped.set(item.label, []);
      }
      grouped.get(item.label).push(descriptor);
    });

    const nextDescriptors = [];
    grouped.forEach((descriptors, label) => {
      if (descriptors.length > 0) {
        nextDescriptors.push(new faceapi.LabeledFaceDescriptors(label, descriptors));
      }
    });

    labeledDescriptors = nextDescriptors;
    rebuildMatcher();
    remoteSyncCompleted = true;
    if (!silent) {
      setStatus(modelsStatus, "已同步遠端資料", "ready");
    }
  } catch (error) {
    console.error("同步遠端人像資料失敗", error);
    if (!silent) {
      setStatus(modelsStatus, "同步遠端資料失敗，改用本機快取", "warn");
    }
  }
}

async function persistKnownFaces(label, descriptors) {
  if (!SHOULD_USE_REMOTE_STORE) {
    return;
  }
  if (!label || !Array.isArray(descriptors) || descriptors.length === 0) {
    return;
  }

  const endpoint = buildFunctionUrl("register");
  if (!endpoint) {
    return;
  }

  try {
    const body = JSON.stringify({
      label,
      descriptors: descriptors.map((descriptor) =>
        Array.from(descriptor instanceof Float32Array ? descriptor : new Float32Array(descriptor))
      ),
    });

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`HTTP ${response.status}: ${details}`);
    }
  } catch (error) {
    console.error("儲存人像資料到遠端時失敗", error);
    setStatus(modelsStatus, "遠端儲存失敗，資料僅保留在本機快取", "warn");
  }
}

async function loadModels() {
  if (modelsLoaded) {
    setStatus(modelsStatus, "模型已載入", "ready");
    await syncKnownFacesFromRemote(false, { silent: true });
    return;
  }

  setStatus(modelsStatus, "正在載入模型...");
  loadModelsBtn.disabled = true;

  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    modelsLoaded = true;
    setStatus(modelsStatus, "模型載入完成", "ready");
    await syncKnownFacesFromRemote(true);
  } catch (error) {
    console.error(error);
    setStatus(modelsStatus, "模型載入失敗", "warn");
  } finally {
    loadModelsBtn.disabled = false;
  }
}

async function addKnownFace() {
  if (!modelsLoaded) {
    setStatus(modelsStatus, "請先載入模型", "warn");
    return;
  }

  const label = labelInput.value.trim();
  const files = Array.from(imagesInput.files || []);

  if (!label) {
    alert("請先輸入標籤名稱");
    return;
  }
  if (files.length === 0) {
    alert("請至少選擇一張照片");
    return;
  }

  addKnownBtn.disabled = true;
  setStatus(modelsStatus, `正在為 ${label} 處理 ${files.length} 張照片...`);

  const descriptors = [];

  for (const file of files) {
    try {
      const img = await faceapi.bufferToImage(file);
      const detection = await faceapi
        .detectSingleFace(img, TINY_FACE_DETECTOR_OPTIONS)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        console.warn(`在 ${file.name} 中找不到人臉`);
        continue;
      }

      descriptors.push(detection.descriptor);
    } catch (error) {
      console.warn(`處理 ${file.name} 時發生錯誤`, error);
    }
  }

  if (descriptors.length === 0) {
    alert("所選照片中沒有偵測到可用的人臉");
    setStatus(modelsStatus, "未新增任何人像", "warn");
    addKnownBtn.disabled = false;
    return;
  }

  const { added, total, isNew } = registerDescriptors(label, descriptors);
  labelInput.value = "";
  imagesInput.value = "";
  setStatus(
    modelsStatus,
    `${isNew ? "已建立" : "已更新"} ${label}（新增 ${added} 組，累計 ${total} 組）`,
    "ready"
  );
  await persistKnownFaces(label, descriptors);
  await syncKnownFacesFromRemote(true, { silent: true });
  addKnownBtn.disabled = false;
}

function updateKnownList() {
  knownList.innerHTML = "";
  labeledDescriptors.forEach((entry) => {
    const item = document.createElement("li");
    const labelSpan = document.createElement("span");
    labelSpan.className = "known-label";
    labelSpan.textContent = `${entry.label}（${entry.descriptors.length}）`;

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "delete-cache-btn";
    deleteBtn.textContent = "刪除";
    deleteBtn.addEventListener("click", () => {
      const confirmed = window.confirm(`確定要刪除 ${entry.label} 的本機快取嗎？`);
      if (confirmed) {
        removeLabelFromCache(entry.label);
      }
    });

    item.appendChild(labelSpan);
    item.appendChild(deleteBtn);
    knownList.appendChild(item);
  });
}

function registerDescriptors(label, descriptors) {
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    return { added: 0, total: 0, isNew: false };
  }

  let entry = labeledDescriptors.find((item) => item.label === label);
  const added = descriptors.length;
  let isNew = false;

  if (entry) {
    entry.descriptors.push(...descriptors);
  } else {
    entry = new faceapi.LabeledFaceDescriptors(label, descriptors);
    labeledDescriptors.push(entry);
    isNew = true;
  }

  rebuildMatcher();

  return { added, total: entry.descriptors.length, isNew };
}

async function captureKnownFace() {
  if (!modelsLoaded) {
    setStatus(modelsStatus, "請先載入模型", "warn");
    return;
  }

  const label = labelInput.value.trim();
  if (!label) {
    alert("請先輸入標籤名稱");
    return;
  }

  if (!mediaStream || video.readyState < 2) {
    setStatus(cameraStatus, "請先啟動攝影機並確認對準臉部", "warn");
    return;
  }

  captureKnownBtn.disabled = true;
  setStatus(modelsStatus, "正在從攝影機擷取人像...");

  try {
    const detection = await faceapi
      .detectSingleFace(video, TINY_FACE_DETECTOR_OPTIONS)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) {
      setStatus(modelsStatus, "未偵測到人臉，請調整角度後再試", "warn");
      return;
    }

    const { added, total, isNew } = registerDescriptors(label, [detection.descriptor]);
    setStatus(
      modelsStatus,
      `${isNew ? "已建立" : "已更新"} ${label}（攝影機新增 ${added} 組，累計 ${total} 組）`,
      "ready"
    );
    await persistKnownFaces(label, [detection.descriptor]);
    await syncKnownFacesFromRemote(true, { silent: true });
  } catch (error) {
    console.error("擷取人像失敗", error);
    setStatus(modelsStatus, "擷取失敗，請稍後再試", "warn");
  } finally {
    captureKnownBtn.disabled = false;
  }
}

async function startCamera() {
  if (!modelsLoaded) {
    setStatus(modelsStatus, "請先載入模型", "warn");
    return;
  }
  if (detectionActive) {
    return;
  }

  if (
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== "function"
  ) {
    setStatus(cameraStatus, "此瀏覽器不支援攝影機", "warn");
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    video.srcObject = mediaStream;
    await video.play();
    detectionActive = true;
    setStatus(cameraStatus, "攝影機運作中", "ready");
    runDetectionLoop();
  } catch (error) {
    console.error(error);
    setStatus(cameraStatus, "無法啟動攝影機，請確認權限或裝置狀態", "warn");
  }
}

function stopCamera() {
  detectionActive = false;
  if (detectionIntervalId) {
    clearInterval(detectionIntervalId);
    detectionIntervalId = null;
  }
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  if (video.srcObject) {
    video.srcObject = null;
  }
  setStatus(cameraStatus, "攝影機已停止");
  resetRecognitionTracking();
}

function runDetectionLoop() {
  if (detectionIntervalId) {
    return;
  }

  const intervalMs = 120;
  detectionIntervalId = setInterval(processFrame, intervalMs);
  processFrame();
}

async function processFrame() {
  if (!detectionActive || processingFrame) {
    return;
  }

  const { videoWidth, videoHeight } = video;
  if (!videoWidth || !videoHeight) {
    return;
  }

  if (overlay.width !== videoWidth || overlay.height !== videoHeight) {
    overlay.width = videoWidth;
    overlay.height = videoHeight;
  }

  processingFrame = true;

  try {
    const detections = await faceapi
      .detectAllFaces(video, TINY_FACE_DETECTOR_OPTIONS)
      .withFaceLandmarks()
      .withFaceDescriptors();

    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

    if (detections.length > 0) {
      const resizedDetections = faceapi.resizeResults(detections, {
        width: overlay.width,
        height: overlay.height,
      });

      resizedDetections.forEach((detection) => {
        const box = detection.detection.box;
        overlayCtx.strokeStyle = "#00b894";
        overlayCtx.lineWidth = 3;
        overlayCtx.strokeRect(box.x, box.y, box.width, box.height);

        let displayLabel = "未知";
        let resolvedLabel = null;
        if (faceMatcher) {
          const match = faceMatcher.findBestMatch(detection.descriptor);
          if (match.label === "unknown") {
            displayLabel = "未知";
          } else {
            resolvedLabel = match.label;
            displayLabel = `${match.label}（${match.distance.toFixed(2)}）`;
          }
        }

        const labelHeight = 26;
        overlayCtx.fillStyle = "rgba(0, 0, 0, 0.65)";
        const labelY = Math.max(box.y - labelHeight, 0);
        overlayCtx.fillRect(box.x, labelY, box.width, labelHeight);

        overlayCtx.fillStyle = "#ffffff";
        overlayCtx.font = "16px Segoe UI, sans-serif";
        overlayCtx.fillText(displayLabel, box.x + 6, labelY + 18);

        if (resolvedLabel) {
          updateRecognitionSession(resolvedLabel);
        }
      });
    }

    cleanupRecognitionSessions();
  } catch (error) {
    console.error("偵測畫面時發生錯誤", error);
  } finally {
    processingFrame = false;
  }
}

loadModelsBtn.addEventListener("click", () => {
  loadModels().catch((error) => console.error("載入模型時發生錯誤", error));
});
addKnownBtn.addEventListener("click", () => {
  addKnownFace().catch((error) => console.error("新增人像時發生錯誤", error));
});
captureKnownBtn.addEventListener("click", () => {
  captureKnownFace().catch((error) => console.error("擷取人像時發生錯誤", error));
});
startCameraBtn.addEventListener("click", () => {
  startCamera().catch((error) => console.error("啟動攝影機時發生錯誤", error));
});
stopCameraBtn.addEventListener("click", stopCamera);
if (clearCacheBtn) {
  clearCacheBtn.addEventListener("click", handleClearCacheClick);
}

window.addEventListener("DOMContentLoaded", () => {
  if (SHOULD_USE_REMOTE_STORE) {
    syncKnownFacesFromRemote(false, { silent: true }).catch((error) =>
      console.warn("同步遠端資料失敗", error)
    );
  }
});

window.addEventListener("beforeunload", stopCamera);
