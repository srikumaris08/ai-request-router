import { useEffect, useState } from 'react';
import socket from '../api/socket';

const DOT = 'w-2 h-2 rounded-full inline-block mr-1.5';

const ConnectionBadge = () => {
  const [status, setStatus] = useState(socket.connected ? 'connected' : 'disconnected');

  useEffect(() => {
    const onConnect    = () => setStatus('connected');
    const onDisconnect = () => setStatus('disconnected');
    const onReconnect  = () => setStatus('reconnecting');

    socket.on('connect',             onConnect);
    socket.on('disconnect',          onDisconnect);
    socket.on('reconnect_attempt',   onReconnect);

    return () => {
      socket.off('connect',           onConnect);
      socket.off('disconnect',        onDisconnect);
      socket.off('reconnect_attempt', onReconnect);
    };
  }, []);

  const config = {
    connected:    { dot: 'bg-green-500',  label: 'Live',          text: 'text-green-700' },
    disconnected: { dot: 'bg-red-400',    label: 'Disconnected',  text: 'text-red-600'   },
    reconnecting: { dot: 'bg-amber-400 animate-pulse', label: 'Reconnecting…', text: 'text-amber-600' },
  }[status] ?? {};

  return (
    <span className={`inline-flex items-center text-xs font-medium ${config.text}`}>
      <span className={`${DOT} ${config.dot}`} />
      {config.label}
    </span>
  );
};

export default ConnectionBadge;
