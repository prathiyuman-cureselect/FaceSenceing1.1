import React, { memo } from 'react';

interface MessageBarProps {
    message: string;
    type: 'info' | 'success' | 'error' | 'warning';
}

const iconMap: Readonly<Record<MessageBarProps['type'], string>> = {
    info: 'ℹ️',
    success: '✅',
    error: '❌',
    warning: '⚠️',
};

const MessageBar: React.FC<MessageBarProps> = memo(({ message, type }) => {
    // Sanitize message — strip any HTML to prevent XSS
    const safeMessage = message.replace(/<[^>]*>/g, '');

    return (
        <div
            className={`message-bar message-bar--${type}`}
            role="status"
            aria-live="polite"
            aria-label="Status message"
        >
            <span aria-hidden="true">{iconMap[type]}</span>
            <span>{safeMessage}</span>
        </div>
    );
});

MessageBar.displayName = 'MessageBar';

export default MessageBar;
