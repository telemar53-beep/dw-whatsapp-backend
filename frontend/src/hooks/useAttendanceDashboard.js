import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { getDashboardConversations } from '../services/api';

function upsert(list, conversation) {
  const index = list.findIndex((c) => c.id === conversation.id);
  if (index === -1) return [...list, conversation];
  const next = [...list];
  next[index] = conversation;
  return next;
}

function remove(list, id) {
  return list.filter((c) => c.id !== id);
}

export function useAttendanceDashboard() {
  const { token } = useAuth();
  const socket = useSocket();
  const [inProgress, setInProgress] = useState([]);
  const [waiting, setWaiting] = useState([]);
  const [inAutomation, setInAutomation] = useState([]);
  const [closedTodayCount, setClosedTodayCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return getDashboardConversations(token)
      .then((data) => {
        setInProgress(data.inProgress);
        setWaiting(data.waiting);
        setInAutomation(data.inAutomation);
        setClosedTodayCount(data.closedTodayCount);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!socket) return undefined;

    function onDashboardConversation({ conversation, closedAt }) {
      const isInProgress = conversation.status === 'assigned';
      const isInAutomation = conversation.triageState === 'pending' && conversation.status !== 'closed' && conversation.status !== 'silent';
      const isWaiting = conversation.status === 'waiting' && !isInAutomation;

      setInProgress((prev) => (isInProgress ? upsert(prev, conversation) : remove(prev, conversation.id)));
      setWaiting((prev) => (isWaiting ? upsert(prev, conversation) : remove(prev, conversation.id)));
      setInAutomation((prev) => (isInAutomation ? upsert(prev, conversation) : remove(prev, conversation.id)));

      if (closedAt) {
        setClosedTodayCount((prev) => prev + 1);
      }
    }

    socket.on('dashboard:conversation', onDashboardConversation);
    return () => socket.off('dashboard:conversation', onDashboardConversation);
  }, [socket]);

  return { inProgress, waiting, inAutomation, closedTodayCount, loading, refresh };
}
