"""
Face Detector Module
=====================
Robust face detection using OpenCV's DNN-based face detector
with ROI extraction for forehead and cheek regions.
"""

import logging
from typing import Dict, List, Optional, Tuple

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
            # Optimize Haar: Enhance contrast for low-light
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            enhanced = clahe.apply(gray)
            rect, conf = self._detect_haar_optimized(enhanced)
            
        self._last_confidence = conf
        return rect, conf

    def _detect_haar_optimized(self, enhanced_gray: np.ndarray) -> Tuple[Optional[Tuple[int, int, int, int]], float]:
        """Haar-based face detection with optimized parameters."""
        faces = self._cascade.detectMultiScale(
            enhanced_gray,
            scaleFactor=1.05,
            minNeighbors=1,
            minSize=(25, 25)
        )

        if len(faces) == 0:
            self._no_face_count += 1
            # Coasting: Return previous rect if we just lost it briefly
            if self._prev_face_rect and self._no_face_count < 5:
                return self._prev_face_rect, 0.4
            return None, 0.0

        self._no_face_count = 0
        # Pick largest face
        best_face = max(faces, key=lambda f: f[2] * f[3])
        logger.info(f"Face detected (Haar): {best_face}")
        return tuple(map(int, best_face)), 0.8

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
    ) -> Dict[str, List[np.ndarray]]:
        """
        Extract sub-grid ROIs for spatial-temporal signal filtering.
        Divides forehead and cheeks into multiple patches to allow for
        Quality-Based spatial averaging (similar to commercial grade rPPG).
        """
        x, y, w, h = face_rect
        h_orig, w_orig = frame.shape[:2]

        def get_patches(x1, y1, x2, y2, grid_size=(2, 2)):
            """Divide a region into a grid of patches."""
            patches = []
            x1, x2 = max(0, x1), min(w_orig, x2)
            y1, y2 = max(0, y1), min(h_orig, y2)
            
            if x2 <= x1 or y2 <= y1: return []
            
            pw = (x2 - x1) // grid_size[0]
            ph = (y2 - y1) // grid_size[1]
            
            for i in range(grid_size[0]):
                for j in range(grid_size[1]):
                    px1 = x1 + i * pw
                    py1 = y1 + j * ph
                    px2 = px1 + pw
                    py2 = py1 + ph
                    patch = frame[py1:py2, px1:px2]
                    if patch.size > 0:
                        patches.append(patch)
            return patches

        # Define 3 core capture zones
        # 1. Forehead (divided into 4 patches)
        forehead_patches = get_patches(
            x + int(w * 0.3), y + int(h * 0.05),
            x + int(w * 0.7), y + int(h * 0.20),
            (2, 2)
        )
        
        # 2. Left Cheek (divided into 4 patches)
        l_cheek_patches = get_patches(
            x + int(w * 0.15), y + int(h * 0.45),
            x + int(w * 0.35), y + int(h * 0.65),
            (2, 2)
        )

        # 3. Right Cheek (divided into 4 patches)
        r_cheek_patches = get_patches(
            x + int(w * 0.65), y + int(h * 0.45),
            x + int(w * 0.85), y + int(h * 0.65),
            (2, 2)
        )

        return {
            "forehead": forehead_patches,
            "left_cheek": l_cheek_patches,
            "right_cheek": r_cheek_patches
        }

    def get_skin_mask(self, roi: np.ndarray) -> np.ndarray:
        """
        Ultra-precise skin-color verification using dual-space (YCrCb + HSV) masking.
        Excludes lips, eyes, and shadows which contaminate rPPG signals.
        """
        if roi.size == 0:
            return np.array([])

        # Space 1: YCrCb (Better for skin across ethnicities)
        ycrcb = cv2.cvtColor(roi, cv2.COLOR_BGR2YCrCb)
        mask1 = cv2.inRange(ycrcb, (0, 130, 75), (255, 180, 135))

        # Space 2: HSV (Better for identifying shadows/highlights)
        hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
        mask2 = cv2.inRange(hsv, (0, 20, 50), (25, 180, 255))

        mask = cv2.bitwise_and(mask1, mask2)

        # Morphological cleanup to remove small noise
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

            # Convert to grayscale
            gray_full = cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY)
            
            # Use minimal blur for texture analysis to preserve wrinkles
            gray_texture = cv2.GaussianBlur(gray_full, (3, 3), 0)
            
            # 1. Wrinkle/texture score — Laplacian variance (higher = more detail/wrinkles)
            # Forehead is a prime area for wrinkles
            fh_y1, fh_y2 = 0, h // 4
            fh_x1, fh_x2 = w // 4, 3 * w // 4
            forehead_region = gray_texture[fh_y1:fh_y2, fh_x1:fh_x2]
            
            if forehead_region.size == 0:
                return None
                
            laplacian_var = cv2.Laplacian(forehead_region, cv2.CV_64F).var()

            # 2. Skin smoothness — standard deviation of pixel intensities
            # Older skin often has more pigment variation (age spots)
            skin_region = gray_texture[h//4:3*h//4, w//4:3*w//4]
            skin_std = np.std(skin_region.astype(float)) if skin_region.size > 0 else 20

            # 3. Under-eye texture (wrinkles around eyes indicate aging)
            eye_region = gray_texture[h//4:h//2, :]
            eye_texture = cv2.Laplacian(eye_region, cv2.CV_64F).var() if eye_region.size > 0 else 0

            # 4. Skin color features in LAB space
            lab = cv2.cvtColor(face_roi, cv2.COLOR_BGR2LAB)
            l_mean = np.mean(lab[:, :, 0])
            b_mean = np.mean(lab[:, :, 2])  # skin yellowness

            # 5. Face aspect ratio (children have rounder faces)
            aspect_ratio = w / max(h, 1)

            # Estimate age from features
            # Base age: start from 25
            age = 25.0

            # Wrinkle contribution (more wrinkles = older)
            # Adjusted thresholds to be more sensitive to subtle wrinkles often lost in webcams
            if laplacian_var > 600:
                age += 25
            elif laplacian_var > 300:
                age += 15
            elif laplacian_var > 150:
                age += 8
            elif laplacian_var < 40:
                age -= 7  # Very smooth = younger

            # Skin uniformity (less uniform = older)
            if skin_std > 40:
                age += 10
            elif skin_std > 25:
                age += 5
            elif skin_std < 12:
                age -= 4

            # Eye texture
            if eye_texture > 400:
                age += 10
            elif eye_texture > 150:
                age += 4

            # Skin color: older skin tends to be less vibrant / more yellowish
            if l_mean < 110:
                age += 4
            if b_mean > 135:
                age += 3

            # Face shape
            if aspect_ratio > 0.82:
                age -= 4  # rounder = younger

            # Clamp to reasonable range
            age = max(18, min(85, age))

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

            gray = cv2.GaussianBlur(cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY), (3, 3), 0)

            # Score: positive = male tendency, negative = female tendency
            # Very high base bias (3.5) to override smoothing from mobile cameras
            score = 3.5

            # 1. Face aspect ratio: Males tend to have wider faces/jaws relative to height
            aspect = w / max(h, 1)
            if aspect > 0.82:
                score += 1.8
            elif aspect < 0.65:
                score -= 2.0

            # 2. Jaw region intensity contrast (lower 1/3 of face)
            # This is the most reliable check for facial hair/stubble texture
            jaw_region = gray[2*h//3:, :]
            upper_region = gray[:h//3, :]
            if jaw_region.size > 0 and upper_region.size > 0:
                jaw_contrast = np.std(jaw_region.astype(float))
                upper_contrast = np.std(upper_region.astype(float))
                if jaw_contrast > upper_contrast * 1.2:
                    score += 3.0
                elif jaw_contrast < upper_contrast * 0.8:
                    score -= 1.5

            # 3. Vertical Jaw Ratio (New Heuristic)
            # Males tend to have vertically longer jaws/chins relative to the upper face
            jaw_h = h - h//1.6
            upper_h = h//3
            if jaw_h > upper_h * 1.1:
                score += 1.5

            # 4. Eyebrow region thickness/darkness
            brow_region = gray[h//6:h//4, w//6:5*w//6]
            if brow_region.size > 0:
                brow_darkness = 255 - np.mean(brow_region)
                if brow_darkness > 75:
                    score += 2.0
                elif brow_darkness < 45:
                    score -= 1.8

            # 5. Skin smoothness (lower 1/2 of face)
            center = gray[h//2:, w//4:3*w//4]
            if center.size > 0:
                smoothness = cv2.Laplacian(center, cv2.CV_64F).var()
                if smoothness < 40:
                    score -= 2.5  # Only extremely smooth skin counts as female
                elif smoothness > 200:
                    score += 3.0  # Texture/stubble = masculine

            # 6. Color features: LAB space (redness/flushing)
            lab = cv2.cvtColor(face_roi, cv2.COLOR_BGR2LAB)
            a_mean = np.mean(lab[:, :, 1])
            if a_mean > 145:
                score -= 1.5

            return "Male" if score > 0 else "Female"

        except Exception as e:
            logger.warning(f"Gender estimation failed: {e}")
            return None

    def estimate_sentiment(self, frame: np.ndarray, face_rect: Tuple[int, int, int, int]) -> Optional[str]:
        """
        Estimate facial sentiment/expression using geometric heuristics.
        Analyzes mouth curvature, eye openness, and brow positioning.
        Returns: 'Smiling', 'Sad', 'Surprised', 'Neutral', or 'Focused'.
        """
        try:
            x, y, w, h = face_rect
            face_roi = frame[y:y+h, x:x+w]
            if face_roi.size == 0 or w < 60 or h < 60:
                return None

            gray = cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY)
            gray = cv2.equalizeHist(gray)

            # Heuristic 1: Mouth curvature (Happy vs Sad)
            # Define mouth region (bottom 1/3 of face, center 1/2)
            my1, my2 = int(h * 0.75), int(h * 0.92)
            mx1, mx2 = int(w * 0.25), int(w * 0.75)
            mouth_roi = gray[my1:my2, mx1:mx2]
            
            if mouth_roi.size > 0:
                # Use Canny to find mouth edges
                edges = cv2.Canny(mouth_roi, 50, 150)
                # Count edge pixels in the corners vs center of mouth ROI
                mw = mx2 - mx1
                left_corner = edges[:, :mw//4]
                right_corner = edges[:, -mw//4:]
                center_mouth = edges[:, mw//4:3*mw//4]
                
                l_count = np.count_nonzero(left_corner)
                r_count = np.count_nonzero(right_corner)
                c_count = np.count_nonzero(center_mouth)
                
                # Heuristic 2: Eye openness (Surprised vs Focused)
                # Eyes roughly at 1/3 height
                ey1, ey2 = int(h * 0.25), int(h * 0.45)
                eye_roi = gray[ey1:ey2, :]
                
                if eye_roi.size > 0:
                    _, thresh = cv2.threshold(eye_roi, 50, 255, cv2.THRESH_BINARY_INV)
                    eye_pixels = np.count_nonzero(thresh)
                    
                    # Sentiment Logic
                    if c_count > 0 and (l_count + r_count) / (c_count + 1) > 1.2:
                        return "Smiling"
                    if eye_pixels > (eye_roi.size * 0.15):
                        return "Surprised"
                    if l_count + r_count < 5 and c_count > 10:
                        return "Sad"
                    if eye_pixels < (eye_roi.size * 0.05):
                        return "Focused"
            
            return "Neutral"

        except Exception as e:
            logger.debug(f"Sentiment estimation failed: {e}")
            return "Neutral"

    def reset(self):
        """Reset tracker state."""
        self._prev_face_rect = None
        self._no_face_count = 0
