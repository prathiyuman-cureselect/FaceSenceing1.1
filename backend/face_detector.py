"""
Face Detector Module
=====================
Robust face detection using OpenCV's DNN-based face detector
with ROI extraction for forehead and cheek regions.
"""

import logging
from typing import Optional, Tuple

import cv2
import numpy as np

from config import CONFIG

logger = logging.getLogger(__name__)


class FaceDetector:
    """
    Face detection and ROI extraction using OpenCV DNN or Haar Cascade.
    Provides stable face tracking with smoothing to reduce jitter.
    """

    def __init__(self):
        self.config = CONFIG.roi
        self._prev_face_rect: Optional[Tuple[int, int, int, int]] = None
        self._smooth_alpha = 0.3  # Exponential smoothing factor
        self._no_face_count = 0
        self._max_no_face = 10  # Frames before resetting tracker
        self._frame_count = 0
        self._detect_every_n_frames = 3  # Detect every 3 frames if stable
        self._last_confidence = 0.0

        # Try DNN face detector first, fallback to Haar cascade
        self._use_dnn = False
        try:
            self._net = cv2.dnn.readNetFromCaffe(
                "deploy.prototxt",
                "res10_300x300_ssd_iter_140000.caffemodel"
            )
            self._use_dnn = True
            logger.info("Using DNN face detector")
        except Exception:
            logger.info("DNN model not found, using Haar cascade")
            self._cascade = cv2.CascadeClassifier(
                cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
            )

    def detect_face(
        self, frame: np.ndarray
    ) -> Tuple[Optional[Tuple[int, int, int, int]], float]:
        """
        Detect face in frame with optimization to skip detection on stable tracks.

        Returns:
            Tuple of (face_rect, confidence) where face_rect is (x, y, w, h)
            or (None, 0.0) if no face detected.
        """
        self._frame_count += 1

        # If we have a stable track, skip some detections to save CPU
        if (
            self._prev_face_rect is not None
            and self._last_confidence > 0.7
            and self._frame_count % self._detect_every_n_frames != 0
        ):
            return self._prev_face_rect, self._last_confidence

        if self._use_dnn:
            rect, conf = self._detect_dnn(frame)
        else:
            rect, conf = self._detect_haar(frame)
            
        self._last_confidence = conf
        return rect, conf

    def _detect_dnn(
        self, frame: np.ndarray
    ) -> Tuple[Optional[Tuple[int, int, int, int]], float]:
        """DNN-based face detection."""
        h, w = frame.shape[:2]
        blob = cv2.dnn.blobFromImage(
            cv2.resize(frame, (300, 300)), 1.0, (300, 300),
            (104.0, 177.0, 123.0)
        )
        self._net.setInput(blob)
        detections = self._net.forward()

        best_conf = 0.0
        best_rect = None

        for i in range(detections.shape[2]):
            confidence = float(detections[0, 0, i, 2])
            if confidence > 0.5:
                box = detections[0, 0, i, 3:7] * np.array([w, h, w, h])
                x1, y1, x2, y2 = box.astype(int)
                face_w = x2 - x1
                face_h = y2 - y1
                if face_w >= self.config.min_face_size and confidence > best_conf:
                    best_conf = confidence
                    best_rect = (x1, y1, face_w, face_h)

        return self._smooth_rect(best_rect), best_conf

    def _detect_haar(
        self, frame: np.ndarray
    ) -> Tuple[Optional[Tuple[int, int, int, int]], float]:
        """Haar cascade face detection."""
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.equalizeHist(gray)

        faces = self._cascade.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(self.config.min_face_size, self.config.min_face_size),
            flags=cv2.CASCADE_SCALE_IMAGE
        )

        if len(faces) == 0:
            return self._smooth_rect(None), 0.0

        # Select largest face
        areas = [w * h for (x, y, w, h) in faces]
        idx = np.argmax(areas)
        face_rect = tuple(faces[idx])
        confidence = min(0.9, 0.5 + len(faces) * 0.1)

        return self._smooth_rect(face_rect), confidence

    def _smooth_rect(
        self, rect: Optional[Tuple[int, int, int, int]]
    ) -> Optional[Tuple[int, int, int, int]]:
        """Apply exponential smoothing to reduce face bbox jitter."""
        if rect is None:
            self._no_face_count += 1
            if self._no_face_count > self._max_no_face:
                self._prev_face_rect = None
            return self._prev_face_rect

        self._no_face_count = 0

        if self._prev_face_rect is None:
            self._prev_face_rect = rect
            return rect

        alpha = self._smooth_alpha
        smoothed = tuple(
            int(alpha * new + (1 - alpha) * old)
            for new, old in zip(rect, self._prev_face_rect)
        )
        self._prev_face_rect = smoothed
        return smoothed

    def extract_roi(
        self, frame: np.ndarray, face_rect: Tuple[int, int, int, int]
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Extract forehead and cheek ROIs from detected face.

        Returns:
            Tuple of (forehead_roi, cheek_roi) as BGR images.
        """
        x, y, w, h = face_rect

        # Forehead region
        fh_y1 = max(0, y + int(h * self.config.forehead_ratio_top))
        fh_y2 = y + int(h * self.config.forehead_ratio_bottom)
        fh_x1 = max(0, x + int(w * self.config.forehead_ratio_left))
        fh_x2 = x + int(w * self.config.forehead_ratio_right)

        # Cheek region
        ck_y1 = y + int(h * self.config.cheek_ratio_top)
        ck_y2 = min(frame.shape[0], y + int(h * self.config.cheek_ratio_bottom))
        ck_x1 = max(0, x + int(w * self.config.cheek_ratio_left))
        ck_x2 = min(frame.shape[1], x + int(w * self.config.cheek_ratio_right))

        forehead = frame[fh_y1:fh_y2, fh_x1:fh_x2]
        cheek = frame[ck_y1:ck_y2, ck_x1:ck_x2]

        return forehead, cheek

    def get_skin_mask(self, roi: np.ndarray) -> np.ndarray:
        """
        Create skin-color mask using YCrCb color space.
        Loosened range for better performance in clinical/home lighting.
        """
        if roi.size == 0:
            return np.array([])

        ycrcb = cv2.cvtColor(roi, cv2.COLOR_BGR2YCrCb)
        # Expanded range for Cr and Cb to handle varied skin tones and lighting
        mask = cv2.inRange(ycrcb, (0, 130, 70), (255, 180, 135))

        # Morphological cleanup
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

        return mask

    def extract_rgb_signal(
        self, frame: np.ndarray, face_rect: Tuple[int, int, int, int]
    ) -> Optional[np.ndarray]:
        """
        Extract mean RGB values with skin-masking and fallback.
        """
        forehead, cheek = self.extract_roi(frame, face_rect)

        signals = []
        for roi in [forehead, cheek]:
            if roi.size == 0:
                continue
                
            mask = self.get_skin_mask(roi)
            
            # If mask is good, use it (precise)
            if mask.size > 0 and np.count_nonzero(mask) > 50:
                b = np.mean(roi[:, :, 0][mask > 0])
                g = np.mean(roi[:, :, 1][mask > 0])
                r = np.mean(roi[:, :, 2][mask > 0])
                signals.append(np.array([r, g, b]))
            else:
                # Fallback: Use center region of the ROI as it's likely skin
                h, w = roi.shape[:2]
                center_roi = roi[h//4:3*h//4, w//4:3*w//4]
                if center_roi.size > 0:
                    r = np.mean(center_roi[:, :, 2])
                    g = np.mean(center_roi[:, :, 1])
                    b = np.mean(center_roi[:, :, 0])
                    signals.append(np.array([r, g, b]))

        if not signals:
            # Ultimate fallback: just return the mean of the entire face bounding box
            x, y, w, h = face_rect
            face_roi = frame[y:y+h, x:x+w]
            if face_roi.size > 0:
                r = np.mean(face_roi[:, :, 2])
                g = np.mean(face_roi[:, :, 1])
                b = np.mean(face_roi[:, :, 0])
                return np.array([r, g, b])
            return None

        # Average across ROIs
        return np.mean(signals, axis=0)

    def estimate_age(self, frame: np.ndarray, face_rect: Tuple[int, int, int, int]) -> Optional[int]:
        """
        Estimate age from facial features using skin texture analysis.
        Uses wrinkle detection, skin uniformity, and color distribution.
        Returns estimated age as integer.
        """
        try:
            x, y, w, h = face_rect
            face_roi = frame[y:y+h, x:x+w]
            if face_roi.size == 0 or w < 40 or h < 40:
                return None

            # Convert to grayscale and apply Gaussian blur to remove raw webcam noise
            # (Webcam noise causes massive spikes in Laplacian variance, falsely aging the user)
            gray = cv2.GaussianBlur(cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY), (5, 5), 0)

            # 1. Wrinkle/texture score — Laplacian variance (higher = more detail/wrinkles)
            forehead_region = gray[0:h//4, w//4:3*w//4]
            if forehead_region.size == 0:
                return None
            laplacian_var = cv2.Laplacian(forehead_region, cv2.CV_64F).var()

            # 2. Skin smoothness — standard deviation of pixel intensities
            skin_std = np.std(gray[h//4:3*h//4, w//4:3*w//4].astype(float))

            # 3. Under-eye texture (wrinkles around eyes indicate aging)
            eye_region = gray[h//4:h//2, :]
            eye_texture = cv2.Laplacian(eye_region, cv2.CV_64F).var() if eye_region.size > 0 else 0

            # 4. Skin color features in LAB space
            lab = cv2.cvtColor(face_roi, cv2.COLOR_BGR2LAB)
            l_mean = np.mean(lab[:, :, 0])
            a_mean = np.mean(lab[:, :, 1])  # skin redness
            b_mean = np.mean(lab[:, :, 2])  # skin yellowness

            # 5. Face aspect ratio (children have rounder faces)
            aspect_ratio = w / max(h, 1)

            # Estimate age from features
            # Base age: start from 24 (mid 20s baseline)
            age = 24.0

            # Wrinkle contribution (more wrinkles = older)
            if laplacian_var > 800:
                age += 20
            elif laplacian_var > 400:
                age += 12
            elif laplacian_var > 200:
                age += 5
            elif laplacian_var < 50:
                age -= 8  # Very smooth = younger

            # Skin uniformity (less uniform = older)
            if skin_std > 45:
                age += 8
            elif skin_std > 30:
                age += 5
            elif skin_std < 18:
                age -= 3

            # Eye texture
            if eye_texture > 500:
                age += 8
            elif eye_texture > 200:
                age += 3

            # Skin color: older skin tends to be less vibrant
            if l_mean < 120:
                age += 3
            if b_mean > 140:
                age += 4  # more yellowish

            # Face shape
            if aspect_ratio > 0.85:
                age -= 3  # rounder = younger

            # Clamp to reasonable range
            age = max(15, min(80, age))

            return int(round(age))

        except Exception as e:
            logger.warning(f"Age estimation failed: {e}")
            return None

    def estimate_gender(self, frame: np.ndarray, face_rect: Tuple[int, int, int, int]) -> Optional[str]:
        """
        Estimate gender from facial geometry and texture features.
        Uses jaw width, eyebrow thickness, skin smoothness, and face proportions.
        Returns 'Male' or 'Female'.
        """
        try:
            x, y, w, h = face_rect
            face_roi = frame[y:y+h, x:x+w]
            if face_roi.size == 0 or w < 40 or h < 40:
                return None

            gray = cv2.GaussianBlur(cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY), (5, 5), 0)

            # Score: positive = male tendency, negative = female tendency
            # Base bias towards Male to counteract the skin-smoothing bias
            score = 1.0

            # 1. Face aspect ratio: Males tend to have wider faces relative to height
            aspect = w / max(h, 1)
            if aspect > 0.82:
                score += 1.5  # wider jaw = more masculine
            elif aspect < 0.72:
                score -= 1.5  # narrower/oval = more feminine

            # 2. Jaw region intensity contrast (lower 1/3 of face)
            jaw_region = gray[2*h//3:, :]
            upper_region = gray[:h//3, :]
            if jaw_region.size > 0 and upper_region.size > 0:
                jaw_contrast = np.std(jaw_region.astype(float))
                upper_contrast = np.std(upper_region.astype(float))
                # Males often have more jaw texture (stubble, stronger jaw)
                if jaw_contrast > upper_contrast * 1.15:
                    score += 1.0
                elif jaw_contrast < upper_contrast * 0.85:
                    score -= 1.0

            # 3. Eyebrow region thickness/darkness
            brow_region = gray[h//6:h//4, w//6:5*w//6]
            if brow_region.size > 0:
                brow_darkness = 255 - np.mean(brow_region)
                if brow_darkness > 100:
                    score += 1.5  # Darker/thicker brows = masculine
                elif brow_darkness < 60:
                    score -= 1.0  # Lighter brows = feminine

            # 4. Skin smoothness (females typically have smoother skin)
            center = gray[h//4:3*h//4, w//4:3*w//4]
            if center.size > 0:
                smoothness = cv2.Laplacian(center, cv2.CV_64F).var()
                if smoothness < 200:
                    score -= 1.5  # Smoother = feminine
                elif smoothness > 500:
                    score += 1.0  # More texture = masculine

            # 5. Color features: LAB space
            lab = cv2.cvtColor(face_roi, cv2.COLOR_BGR2LAB)
            a_mean = np.mean(lab[:, :, 1])  # redness channel
            if a_mean > 135:
                score -= 0.5  # More reddish/pink undertone = feminine tendency

            # 6. Nose width relative to face
            nose_region = gray[h//3:2*h//3, w//3:2*w//3]
            if nose_region.size > 0:
                nose_edges = cv2.Canny(nose_region, 50, 150)
                edge_density = np.count_nonzero(nose_edges) / max(nose_region.size, 1)
                if edge_density > 0.08:
                    score += 0.5  # More prominent nose features = masculine

            return "Male" if score > 0 else "Female"

        except Exception as e:
            logger.warning(f"Gender estimation failed: {e}")
            return None

    def reset(self):
        """Reset tracker state."""
        self._prev_face_rect = None
        self._no_face_count = 0
