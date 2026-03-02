import { useCallback, useRef } from 'react';

interface UseCameraReturn {
    initCamera: () => Promise<MediaStream | null>;
    stopCamera: (stream: MediaStream | null) => void;
}

export function useCamera(): UseCameraReturn {
    const streamRef = useRef<MediaStream | null>(null);

    const initCamera = useCallback(async (): Promise<MediaStream | null> => {
        // Must be in a secure context
        const isSecure =
            window.isSecureContext || window.location.hostname === 'localhost';
        if (!isSecure) {
            throw new Error(
                'Camera Blocked: Browsers require HTTPS or Localhost for camera access.',
            );
        }

        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error(
                'Browser Not Supported: Your browser does not support camera access. On iOS, use Safari.',
            );
        }

        const constraints: MediaStreamConstraints = {
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false,
        };

        let stream: MediaStream;
        try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch {
            console.warn('Retrying with simple constraints...');
            stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }

        streamRef.current = stream;
        return stream;
    }, []);

    const stopCamera = useCallback((stream: MediaStream | null) => {
        const target = stream ?? streamRef.current;
        if (target) {
            target.getTracks().forEach((t) => t.stop());
        }
        streamRef.current = null;
    }, []);

    return { initCamera, stopCamera };
}
