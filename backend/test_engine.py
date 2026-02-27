import sys
import cv2
from rppg_engine import RPPGEngine

engine = RPPGEngine()
import urllib.request
url = "https://raw.githubusercontent.com/opencv/opencv/master/samples/data/lena.jpg"
try:
    urllib.request.urlretrieve(url, "lena.jpg")
except:
    pass
frame = cv2.imread("lena.jpg")
if frame is None:
    frame = __import__("numpy").zeros((480, 640, 3), dtype=__import__("numpy").uint8)

for i in range(70):
    res = engine.process_frame(frame)
    if i % 10 == 0:
        print(f"Frame {i}: face={res.face_detected} buf={res.buffer_fill}% msg={res.message} hr={res.vitals.heart_rate}")

print("Done.")
