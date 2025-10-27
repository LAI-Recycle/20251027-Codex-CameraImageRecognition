"""
Live webcam face recognition using face_recognition and OpenCV.

Steps before running:
1. Install dependencies: pip install face-recognition opencv-python
2. Prepare known face images under known_faces/<person_name>/*.jpg
3. Run: python camera_recognition.py
"""

from __future__ import annotations

import itertools
import time
from pathlib import Path
from typing import List, Tuple

import cv2
import face_recognition
import numpy as np


# Configuration constants. Adjust to match your hardware and performance needs.
VIDEO_SOURCE_INDEX = 0  # Change to 1/2/... if the wrong camera opens.
FRAME_RESIZE_SCALE = 0.25  # Downscale factor for faster processing (0.25 => 25% size).
PROCESS_EVERY_N_FRAMES = 2  # Skip frames to gain speed (1 = process every frame).
FACE_DISTANCE_THRESHOLD = 0.45  # Lower values mean stricter matching.
SAVE_UNKNOWN_FACES = False  # Set True to store snapshots of unknown visitors.
UNKNOWN_FACES_DIR = Path("unknown_faces")
UNKNOWN_FACE_SAVE_INTERVAL_SEC = 5.0  # Wait time before saving another unknown face.

KNOWN_FACES_DIR = Path("known_faces")


def load_known_faces(known_dir: Path) -> Tuple[List[np.ndarray], List[str]]:
    """
    Load facial encodings and their labels from the known faces directory.

    Directory layout:
        known_faces/
            Alice/
                img1.jpg
            Bob/
                img1.png
                img2.jpg
    """
    encodings: List[np.ndarray] = []
    labels: List[str] = []

    if not known_dir.exists():
        raise FileNotFoundError(
            f"Known faces directory not found: {known_dir}. Create it and add images."
        )

    for person_dir in sorted(p for p in known_dir.iterdir() if p.is_dir()):
        person_label = person_dir.name
        image_paths = sorted(
            p for p in person_dir.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"}
        )

        if not image_paths:
            print(f"[WARN] No images found for '{person_label}'. Skipping.")
            continue

        for image_path in image_paths:
            image = face_recognition.load_image_file(str(image_path))
            face_locations = face_recognition.face_locations(image)

            if not face_locations:
                print(f"[WARN] No face detected in {image_path}. Skipping.")
                continue

            face_encodings = face_recognition.face_encodings(image, face_locations)
            encodings.extend(face_encodings)
            labels.extend(itertools.repeat(person_label, len(face_encodings)))

    if not encodings:
        raise ValueError(
            f"No valid face encodings found in {known_dir}. "
            "Ensure each image contains at least one clear face."
        )

    print(f"[INFO] Loaded {len(encodings)} encodings for {len(set(labels))} identities.")
    return encodings, labels


def ensure_unknown_dir(directory: Path) -> None:
    """Create the directory used to store unknown faces when enabled."""
    if SAVE_UNKNOWN_FACES:
        directory.mkdir(parents=True, exist_ok=True)


def save_unknown_face(frame: np.ndarray, bbox: Tuple[int, int, int, int], directory: Path) -> None:
    """Crop and store an unknown face region."""
    top, right, bottom, left = bbox
    top = max(0, top)
    left = max(0, left)
    bottom = min(frame.shape[0], bottom)
    right = min(frame.shape[1], right)

    if bottom <= top or right <= left:
        return

    timestamp = time.strftime("%Y%m%d-%H%M%S")
    filename = directory / f"unknown_{timestamp}.jpg"
    face_roi = frame[top:bottom, left:right]
    cv2.imwrite(str(filename), face_roi)
    print(f"[INFO] Saved unknown face to {filename}")


def main() -> None:
    try:
        known_encodings, known_labels = load_known_faces(KNOWN_FACES_DIR)
    except (FileNotFoundError, ValueError) as exc:
        print(f"[ERROR] {exc}")
        return

    ensure_unknown_dir(UNKNOWN_FACES_DIR)

    video_capture = cv2.VideoCapture(VIDEO_SOURCE_INDEX)
    if not video_capture.isOpened():
        print(f"[ERROR] Unable to open video source index {VIDEO_SOURCE_INDEX}.")
        return

    frame_index = 0
    last_unknown_saved_at = 0.0

    print("[INFO] Press 'q' to exit.")

    while True:
        ret, frame = video_capture.read()
        if not ret:
            print("[WARN] Failed to read frame from camera. Exiting.")
            break

        process_frame = (frame_index % PROCESS_EVERY_N_FRAMES) == 0
        face_locations: List[Tuple[int, int, int, int]] = []
        face_names: List[str] = []

        if process_frame:
            # Resize to improve processing throughput.
            if FRAME_RESIZE_SCALE != 1.0:
                small_frame = cv2.resize(
                    frame,
                    (0, 0),
                    fx=FRAME_RESIZE_SCALE,
                    fy=FRAME_RESIZE_SCALE,
                    interpolation=cv2.INTER_LINEAR,
                )
            else:
                small_frame = frame

            rgb_small_frame = small_frame[:, :, ::-1]
            scaled_locations = face_recognition.face_locations(rgb_small_frame)
            face_encodings = face_recognition.face_encodings(rgb_small_frame, scaled_locations)

            for encoding, scaled_loc in zip(face_encodings, scaled_locations):
                distances = face_recognition.face_distance(known_encodings, encoding)

                if len(distances) == 0:
                    name = "Unknown"
                else:
                    best_index = int(np.argmin(distances))
                    best_distance = distances[best_index]
                    name = (
                        known_labels[best_index]
                        if best_distance <= FACE_DISTANCE_THRESHOLD
                        else "Unknown"
                    )

                scale_factor = FRAME_RESIZE_SCALE if FRAME_RESIZE_SCALE > 0 else 1.0
                top, right, bottom, left = scaled_loc
                inv_scale = 1.0 / scale_factor
                top = int(top * inv_scale)
                right = int(right * inv_scale)
                bottom = int(bottom * inv_scale)
                left = int(left * inv_scale)
                face_locations.append((top, right, bottom, left))
                face_names.append(name)

                if (
                    SAVE_UNKNOWN_FACES
                    and name == "Unknown"
                    and (time.time() - last_unknown_saved_at) >= UNKNOWN_FACE_SAVE_INTERVAL_SEC
                ):
                    save_unknown_face(frame, (top, right, bottom, left), UNKNOWN_FACES_DIR)
                    last_unknown_saved_at = time.time()

        for (top, right, bottom, left), name in zip(face_locations, face_names):
            cv2.rectangle(frame, (left, top), (right, bottom), (0, 128, 255), 2)
            label_y = top - 10 if top - 10 > 10 else top + 20
            cv2.putText(
                frame,
                name,
                (left, label_y),
                cv2.FONT_HERSHEY_DUPLEX,
                0.7,
                (0, 255, 0) if name != "Unknown" else (0, 0, 255),
                2,
            )

        cv2.imshow("Face Recognition", frame)

        frame_index += 1
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    video_capture.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
