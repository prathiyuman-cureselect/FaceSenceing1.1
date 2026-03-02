# ─── Stage 1: Build the React Frontend ─────────────────────────────────────────
FROM node:20-slim AS build

WORKDIR /app/frontend-react
COPY frontend-react/package*.json ./
RUN npm install

COPY frontend-react/ ./
RUN npm run build

# ─── Stage 2: Build the FastAPI Backend ───────────────────────────────────────
FROM python:3.11-slim

# Install system dependencies for OpenCV and Signal Processing
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Download DNN Face Detector Models
RUN mkdir -p backend && cd backend && \
    wget https://raw.githubusercontent.com/opencv/opencv/master/samples/dnn/face_detector/deploy.prototxt \
    && wget https://github.com/opencv/opencv_3rdparty/raw/dnn_samples_face_detector_20170830/res10_300x300_ssd_iter_140000.caffemodel

# Copy requirements and install
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY backend/ ./backend/

# Copy built frontend from Stage 1
COPY --from=build /home/prathiyuman/Prathiyuman/FaceSenceing/frontend-dist /app/frontend-dist

# Set working directory to backend for running gunicorn
WORKDIR /app/backend

# Start application using Gunicorn for production
# Use sh to allow environment variable expansion in CMD (Render provides $PORT)
CMD ["sh", "-c", "gunicorn main:app --workers 2 --worker-class uvicorn.workers.UvicornWorker --bind 0.0.0.0:${PORT:-8000}"]
