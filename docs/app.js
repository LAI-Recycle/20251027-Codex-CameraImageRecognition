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
const knownList = document.getElementById("known-list");
const startCameraBtn = document.getElementById("start-camera-btn");
const stopCameraBtn = document.getElementById("stop-camera-btn");
const cameraStatus = document.getElementById("camera-status");
const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const overlayCtx = overlay.getContext("2d");

let modelsLoaded = false;
let labeledDescriptors = [];
let faceMatcher = null;
let detectionActive = false;
let detectionHandle = null;
let mediaStream = null;

function setStatus(element, message, type = null) {
  element.textContent = message;
  element.classList.remove("ready", "warn");
  if (type === "ready") {
    element.classList.add("ready");
  } else if (type === "warn") {
    element.classList.add("warn");
  }
}

async function loadModels() {
  if (modelsLoaded) {
    setStatus(modelsStatus, "模型已載入", "ready");
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
  } catch (error) {
    console.error(error);
    setStatus(modelsStatus, "模型載入失敗", "warn");
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
    alert("請先輸入標籤名稱。");
    return;
  }
  if (files.length === 0) {
    alert("請至少選擇一張照片。");
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
      console.warn(`處理 ${file.name} 失敗`, error);
    }
  }

  if (descriptors.length === 0) {
    alert("選取的照片中未偵測到可用的人臉。");
    setStatus(modelsStatus, "未新增任何人臉", "warn");
    addKnownBtn.disabled = false;
    return;
  }

  labeledDescriptors.push(new faceapi.LabeledFaceDescriptors(label, descriptors));
  faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.45);
  updateKnownList();

  labelInput.value = "";
  imagesInput.value = "";
  setStatus(
    modelsStatus,
    `已新增 ${label}（${descriptors.length} 組特徵向量）`,
    "ready"
  );
  addKnownBtn.disabled = false;
}

function updateKnownList() {
  knownList.innerHTML = "";
  labeledDescriptors.forEach((entry) => {
    const item = document.createElement("li");
    item.textContent = `${entry.label} (${entry.descriptors.length})`;
    knownList.appendChild(item);
  });
}

async function startCamera() {
  if (!modelsLoaded) {
    setStatus(modelsStatus, "請先載入模型", "warn");
    return;
  }
  if (detectionActive) {
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
    setStatus(cameraStatus, "無法存取攝影機", "warn");
  }
}

function stopCamera() {
  detectionActive = false;
  if (detectionHandle) {
    cancelAnimationFrame(detectionHandle);
    detectionHandle = null;
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
}

async function runDetectionLoop() {
  const drawFrame = async () => {
    if (!detectionActive) {
      return;
    }

    const { videoWidth, videoHeight } = video;
    if (videoWidth === 0 || videoHeight === 0) {
      detectionHandle = requestAnimationFrame(drawFrame);
      return;
    }

    if (overlay.width !== videoWidth || overlay.height !== videoHeight) {
      overlay.width = videoWidth;
      overlay.height = videoHeight;
    }

    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

    try {
      const detections = await faceapi
        .detectAllFaces(video, TINY_FACE_DETECTOR_OPTIONS)
        .withFaceLandmarks()
        .withFaceDescriptors();

      const resizedDetections = faceapi.resizeResults(detections, {
        width: overlay.width,
        height: overlay.height,
      });

      resizedDetections.forEach((detection) => {
        const box = detection.detection.box;
        overlayCtx.strokeStyle = "#0f62fe";
        overlayCtx.lineWidth = 2;
        overlayCtx.strokeRect(box.x, box.y, box.width, box.height);

        let label = "未知";
        if (faceMatcher) {
          const match = faceMatcher.findBestMatch(detection.descriptor);
          label =
            match.label === "unknown"
              ? "未知"
              : `${match.label}（${match.distance.toFixed(2)}）`;
        }

        overlayCtx.fillStyle = "rgba(15, 98, 254, 0.85)";
        overlayCtx.fillRect(box.x, box.y - 24, box.width, 24);

        overlayCtx.fillStyle = "#ffffff";
        overlayCtx.font = "16px Segoe UI, sans-serif";
        overlayCtx.fillText(label, box.x + 6, box.y - 6);
      });
    } catch (error) {
      console.error("偵測錯誤：", error);
    }

    detectionHandle = requestAnimationFrame(drawFrame);
  };

  detectionHandle = requestAnimationFrame(drawFrame);
}

loadModelsBtn.addEventListener("click", loadModels);
addKnownBtn.addEventListener("click", addKnownFace);
startCameraBtn.addEventListener("click", startCamera);
stopCameraBtn.addEventListener("click", stopCamera);

window.addEventListener("beforeunload", stopCamera);
