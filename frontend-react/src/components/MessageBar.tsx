import React from 'react';

interface MessageBarProps {
    message: string;
    type: 'info' | 'success' | 'error' | 'warning';
}

const iconMap: Record<MessageBarProps['type'], string> = {
    info: 'ℹ️',
    success: '✅',
    error: '❌',
    warning: '⚠️',
};

const MessageBar: React.FC<MessageBarProps> = ({ message, type }) => {
    return (
        <div
            className="message-bar"
            role="status"
            aria-live="polite"
            aria-label="Status message"
        >
            <span aria-hidden="true">{iconMap[type]}</span>
            <span>{message}</span>
        </div>
    );
};

export default MessageBar;
