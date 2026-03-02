import { useCallback, useEffect, useRef } from 'react';
import type { WSMessage } from '../types';
import { CONFIG } from '../config/constants';

/** Maximum acceptable WebSocket message size in bytes (2 MB). */
const MAX_MESSAGE_SIZE = 2 * 1024 * 1024;

interface UseWebSocketOptions {
    sessionId: string | null;
    onMessage: (msg: WSMessage) => void;
    onOpen: () => void;
    onClose: () => void;
    isRunning: boolean;
}

/**
 * Validates incoming WebSocket messages against expected schema.
 * Prevents processing of malformed or potentially malicious payloads.
 */
function isValidWSMessage(data: unknown): data is WSMessage {
    if (typeof data !== 'object' || data === null) return false;
    const msg = data as Record<string, unknown>;
    const validTypes = ['measurement', 'error', 'command_response', 'stats'];
    return typeof msg.type === 'string' && validTypes.includes(msg.type);
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

        // Sanitize session ID — allow only alphanumeric and hyphens
        const sanitizedId = sessionId.replace(/[^a-zA-Z0-9-]/g, '');
        if (sanitizedId !== sessionId) {
            console.error('Invalid session ID characters detected');
            return;
        }

        const url = `${CONFIG.WS_URL}/${sanitizedId}`;

        try {
            const ws = new WebSocket(url);
            wsRef.current = ws;

            ws.onopen = () => {
                reconnectAttemptsRef.current = 0;
                onOpen();
            };

            ws.onmessage = (event: MessageEvent<string>) => {
                try {
                    // Security: reject oversized messages
                    if (typeof event.data === 'string' && event.data.length > MAX_MESSAGE_SIZE) {
                        console.warn('WebSocket message too large, discarding');
                        return;
                    }

                    const parsed: unknown = JSON.parse(event.data);

                    // Security: validate message schema
                    if (!isValidWSMessage(parsed)) {
                        console.warn('Invalid WebSocket message schema, discarding');
                        return;
                    }

                    onMessage(parsed);
                } catch {
                    console.error('WebSocket message parse error');
                }
            };

            ws.onclose = () => {
                onClose();

                // Reconnect with exponential backoff
                if (
                    isRunningRef.current &&
                    reconnectAttemptsRef.current < CONFIG.MAX_RECONNECT_ATTEMPTS
                ) {
                    const attempt = reconnectAttemptsRef.current;
                    reconnectAttemptsRef.current++;
                    const delay = Math.min(
                        CONFIG.RECONNECT_DELAY_MS * Math.pow(1.5, attempt),
                        15_000, // max 15s
                    );
                    reconnectTimerRef.current = setTimeout(connect, delay);
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
