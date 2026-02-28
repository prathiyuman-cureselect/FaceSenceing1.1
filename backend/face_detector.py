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
    ) -> Dict[str, np.ndarray]:
        """
        Extract refined Forehead and Cheek ROIs.
        Avoids the T-zone (eyes/nose) which contains high specular reflection.
        """
        x, y, w, h = face_rect
        h_orig, w_orig = frame.shape[:2]

        # 1. Forehead: Central top part of the face
        fh_y1 = max(0, y + int(h * 0.05))
        fh_y2 = y + int(h * 0.22)
        fh_x1 = x + int(w * 0.3)
        fh_x2 = x + int(w * 0.7)
        
        # 2. Left Cheek: Center-left
        lc_y1 = y + int(h * 0.45)
        lc_y2 = y + int(h * 0.70)
        lc_x1 = x + int(w * 0.15)
        lc_x2 = x + int(w * 0.35)

        # 3. Right Cheek: Center-right
        rc_y1 = y + int(h * 0.45)
        rc_y2 = y + int(h * 0.70)
        rc_x1 = x + int(w * 0.65)
        rc_x2 = x + int(w * 0.85)

        rois = {
            "forehead": frame[fh_y1:fh_y2, max(0, fh_x1):min(w_orig, fh_x2)],
            "left_cheek": frame[max(0, lc_y1):min(h_orig, lc_y2), max(0, lc_x1):min(w_orig, lc_x2)],
            "right_cheek": frame[max(0, rc_y1):min(h_orig, rc_y2), max(0, rc_x1):min(w_orig, rc_x2)],
        }
        
        return rois

    def get_skin_mask(self, roi: np.ndarray) -> np.ndarray:
        """
        Precise skin-color mask using YCrCb.
        """
        if roi.size == 0:
            return np.array([])

        ycrcb = cv2.cvtColor(roi, cv2.COLOR_BGR2YCrCb)
        # Tighter range for skin-only detection to avoid lips or shadows
        mask = cv2.inRange(ycrcb, (0, 133, 77), (255, 173, 127))

        # Morphological cleanup
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

        return mask

    def extract_rgb_signal(
        self, frame: np.ndarray, face_rect: Tuple[int, int, int, int]
    ) -> Optional[np.ndarray]:
        """
        Extract pulse-rich RGB averages from refined skin ROIs.
        Uses spatial averaging and skin-masking.
        """
        rois = self.extract_roi(frame, face_rect)

        signals = []
        for name, roi in rois.items():
            if roi.size == 0:
                continue
                
            mask = self.get_skin_mask(roi)
            
            # If mask is good, use it (precise)
            if mask.size > 0 and np.count_nonzero(mask) > 20:
                # We calculate mean across masked regions
                # Green channel is the primary carrier of the pulse signal in rPPG
                b = np.mean(roi[:, :, 0][mask > 0])
                g = np.mean(roi[:, :, 1][mask > 0])
                r = np.mean(roi[:, :, 2][mask > 0])
                signals.append(np.array([r, g, b]))
            else:
                # Fallback: Just the center of the ROI
                h, w = roi.shape[:2]
                center_roi = roi[h//4:3*h//4, w//4:3*w//4]
                if center_roi.size > 0:
                    r = np.mean(center_roi[:, :, 2])
                    g = np.mean(center_roi[:, :, 1])
                    b = np.mean(center_roi[:, :, 0])
                    signals.append(np.array([r, g, b]))

        if not signals:
            return None

        # Return mean RGB values across all ROIs
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
            # Significant base bias towards Male to counteract the aggressive skin-smoothing blur
            # which otherwise universally penalizes men for having "female-like" smooth skin data
            score = 2.5

            # 1. Face aspect ratio: Males tend to have wider faces relative to height
            aspect = w / max(h, 1)
            if aspect > 0.85:
                score += 1.0  # wider jaw = more masculine
            elif aspect < 0.65:
                score -= 1.0  # narrower/oval = more feminine

            # 2. Jaw region intensity contrast (lower 1/3 of face)
            jaw_region = gray[2*h//3:, :]
            upper_region = gray[:h//3, :]
            if jaw_region.size > 0 and upper_region.size > 0:
                jaw_contrast = np.std(jaw_region.astype(float))
                upper_contrast = np.std(upper_region.astype(float))
                # Males often have more jaw texture (stubble, stronger jaw)
                if jaw_contrast > upper_contrast * 1.25:
                    score += 1.5
                elif jaw_contrast < upper_contrast * 0.80:
                    score -= 0.5  # Softened feminine penalty

            # 3. Eyebrow region thickness/darkness
            brow_region = gray[h//6:h//4, w//6:5*w//6]
            if brow_region.size > 0:
                brow_darkness = 255 - np.mean(brow_region)
                if brow_darkness > 90:
                    score += 1.5  # Darker/thicker brows = masculine
                elif brow_darkness < 50:
                    score -= 1.0  # Lighter brows = feminine

            # 4. Skin smoothness
            # Because we applied GaussianBlur to kill webcam noise, ALL skin is very smooth now. 
            # We must drastically reduce the penalty for smooth skin, otherwise men are classified as women.
            center = gray[h//4:3*h//4, w//4:3*w//4]
            if center.size > 0:
                smoothness = cv2.Laplacian(center, cv2.CV_64F).var()
                if smoothness < 100:
                    score -= 0.5  # Only slightly feminine if phenomenally smooth
                elif smoothness > 400:
                    score += 1.5  # Definite masculine stubble/texture

            # 5. Color features: LAB space
            lab = cv2.cvtColor(face_roi, cv2.COLOR_BGR2LAB)
            a_mean = np.mean(lab[:, :, 1])  # redness channel
            if a_mean > 138:
                score -= 0.5  # More reddish/pink undertone = feminine tendency

            # 6. Nose width relative to face
            nose_region = gray[h//3:2*h//3, w//3:2*w//3]
            if nose_region.size > 0:
                nose_edges = cv2.Canny(nose_region, 50, 150)
                edge_density = np.count_nonzero(nose_edges) / max(nose_region.size, 1)
                if edge_density > 0.07:
                    score += 1.0  # More prominent nose features = masculine


            return "Male" if score > 0 else "Female"

        except Exception as e:
            logger.warning(f"Gender estimation failed: {e}")
            return None

    def reset(self):
        """Reset tracker state."""
        self._prev_face_rect = None
        self._no_face_count = 0
