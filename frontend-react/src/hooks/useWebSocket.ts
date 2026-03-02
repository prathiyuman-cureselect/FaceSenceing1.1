import { useCallback, useEffect, useRef } from 'react';
import type { WSMessage } from '../types';
import { CONFIG } from '../config/constants';

interface UseWebSocketOptions {
    sessionId: string | null;
    onMessage: (msg: WSMessage) => void;
    onOpen: () => void;
    onClose: () => void;
    isRunning: boolean;
}

export function useWebSocket({
    sessionId,
    onMessage,
    onOpen,
    onClose,
    isRunning,
}: UseWebSocketOptions) {
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectAttemptsRef = useRef(0);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isRunningRef = useRef(isRunning);
    isRunningRef.current = isRunning;

    const connect = useCallback(() => {
        if (!sessionId) return;

        const url = `${CONFIG.WS_URL}/${sessionId}`;

        try {
            const ws = new WebSocket(url);
            wsRef.current = ws;

            ws.onopen = () => {
                reconnectAttemptsRef.current = 0;
                onOpen();
            };

            ws.onmessage = (event: MessageEvent<string>) => {
                try {
                    const msg = JSON.parse(event.data) as WSMessage;
                    onMessage(msg);
                } catch {
                    console.error('WebSocket message parse error');
                }
            };

            ws.onclose = () => {
                onClose();

                if (
                    isRunningRef.current &&
                    reconnectAttemptsRef.current < CONFIG.MAX_RECONNECT_ATTEMPTS
                ) {
                    reconnectAttemptsRef.current++;
                    reconnectTimerRef.current = setTimeout(
                        connect,
                        CONFIG.RECONNECT_DELAY_MS,
                    );
                }
            };

            ws.onerror = (err) => {
                console.error('WebSocket error:', err);
            };
        } catch (err) {
            console.error('WebSocket connection failed:', err);
        }
    }, [sessionId, onMessage, onOpen, onClose]);

    const disconnect = useCallback(() => {
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
        if (wsRef.current) {
            wsRef.current.onclose = null; // prevent auto-reconnect
            wsRef.current.close();
            wsRef.current = null;
        }
    }, []);

    const send = useCallback((data: object) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(data));
        }
    }, []);

    // Auto-connect when sessionId is set
    useEffect(() => {
        if (sessionId) {
            connect();
        }
        return () => {
            disconnect();
        };
    }, [sessionId, connect, disconnect]);

    return { connect, disconnect, send, wsRef };
}
