import cv2
import numpy as np
from backend.rppg_engine import RPPGEngine

engine = RPPGEngine()
# Create a dummy image (e.g. 640x480 black image, wait we need a face)
# To avoid face detection failing, let's just use a random colorful image? No, face detector won't find a face.
# Let's download a sample face image
import urllib.request
url = "https://raw.githubusercontent.com/opencv/opencv/master/samples/data/lena.jpg"
urllib.request.urlretrieve(url, "lena.jpg")
frame = cv2.imread("lena.jpg")

for i in range(70): # Run for more than 60 frames to trigger processing
    res = engine.process_frame(frame)
    print(f"Frame {i}: face={res.face_detected} msg={res.message} buf={res.buffer_fill}% hr={res.vitals.heart_rate}")

