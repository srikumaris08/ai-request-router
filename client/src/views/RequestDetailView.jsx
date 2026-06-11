import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/axiosInstance';
import socket from '../api/socket';
import { useAuth } from '../context/AuthContext';
import StatusBadge from '../components/StatusBadge';
import PriorityBadge from '../components/PriorityBadge';
import ChannelBadge from '../components/ChannelBadge';

const STATUSES = ['queued', 'processing', 'completed', 'failed'];

// ── Event type labels ─────────────────────────────────────────────────────────
const EVENT_LABELS = {
  request_created:            '📥 Request Created',
  status_changed:             '🔄 Status Changed',
  priority_changed:           '⚡ Priority Changed',
  category_changed:           '🏷 Category Changed',
  ai_classification_started:  '🤖 AI Started',
  ai_classification_completed:'✅ AI Completed',
  ai_classification_failed:   '❌ AI Failed',
  ai_classification_retried:  '🔁 AI Retried',
  agent_assigned:             '👤 Agent Assigned',
  note_added:                 '📝 Note Added',
  request_resolved:           '🎉 Resolved',
  request_reopened:           '🔓 Reopened',
};

// ── Section card wrapper ──────────────────────────────────────────────────────
const Card = ({ title, children, className = '' }) => (
  <div className={`bg-white rounded-xl border border-gray-200 ${className}`}>
    {title && <div className="px-5 py-4 border-b border-gray-100 font-semibold text-gray-800 text-sm">{title}</div>}
    <div className="p-5">{children}</div>
  </div>
);

// ── Confidence meter ──────────────────────────────────────────────────────────
const ConfidenceMeter = ({ value }) => {
  const pct   = Math.round((value ?? 0) * 100);
  const color = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>Confidence</span><span className="font-semibold text-gray-700">{pct}%</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

// ── Timeline item ─────────────────────────────────────────────────────────────
const TimelineItem = ({ event, isLast }) => (
  <div className="flex gap-3">
    <div className="flex flex-col items-center">
      <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 mt-1 flex-shrink-0" />
      {!isLast && <div className="w-px flex-1 bg-gray-200 mt-1" />}
    </div>
    <div className="pb-5 min-w-0">
      <p className="text-sm font-medium text-gray-800">
        {EVENT_LABELS[event.eventType] ?? event.eventType}
      </p>
      {(event.oldValue !== null && event.newValue !== null) && (
        <p className="text-xs text-gray-500 mt-0.5">
          <span className="line-through text-gray-400">{JSON.stringify(event.oldValue)}</span>
          {' → '}
          <span className="text-gray-700">{JSON.stringify(event.newValue)}</span>
        </p>
      )}
      <p className="text-xs text-gray-400 mt-1">
        {new Date(event.createdAt).toLocaleString()} · {event.actor?.actorType ?? 'system'}
        {event.actor?.label ? ` (${event.actor.label})` : ''}
      </p>
    </div>
  </div>
);

// ── Main view ─────────────────────────────────────────────────────────────────
const RequestDetailView = () => {
  const { id }    = useParams();
  const navigate  = useNavigate();
  const { user }  = useAuth();

  const [detail,      setDetail]      = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [noteText,    setNoteText]    = useState('');
  const [noteLoading, setNoteLoading] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState('');

  const fetchDetail = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/requests/${id}`);
      setDetail(data.data);
      setSelectedStatus(data.data.request.status);
    } catch {
      setError('Failed to load request detail.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();

    // Subscribe to targeted room for this request
    socket.emit('subscribe:request', id);

    const onUpdated = (payload) => {
      if (payload.requestId === id) fetchDetail();
    };
    socket.on('request:updated', onUpdated);

    return () => {
      socket.emit('unsubscribe:request', id);
      socket.off('request:updated', onUpdated);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleAddNote = async (e) => {
    e.preventDefault();
    if (!noteText.trim()) return;
    setNoteLoading(true);
    try {
      await api.post(`/requests/${id}/notes`, { noteBody: noteText });
      setNoteText('');
      fetchDetail();
    } catch (err) {
      alert(err.response?.data?.message ?? 'Failed to add note.');
    } finally {
      setNoteLoading(false);
    }
  };

  const handleStatusChange = async () => {
    if (selectedStatus === detail?.request?.status) return;
    setStatusSaving(true);
    try {
      await api.patch(`/requests/${id}/status`, { status: selectedStatus });
      fetchDetail();
    } catch (err) {
      alert(err.response?.data?.message ?? 'Failed to update status.');
    } finally {
      setStatusSaving(false);
    }
  };

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-400 text-sm">Loading…</div>;
  if (error)   return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-red-500 text-sm">{error}</div>;
  if (!detail) return null;

  const { request, classification, notes, timeline } = detail;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4 sticky top-0 z-30">
        <button onClick={() => navigate('/')} className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1">
          ← Back
        </button>
        <div className="h-4 w-px bg-gray-200" />
        <span className="text-sm font-medium text-gray-700">Request Detail</span>
        <span className="text-xs text-gray-400 font-mono ml-auto">{request._id}</span>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Title row */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <h1 className="text-lg font-bold text-gray-900 mr-2">
            {request.customer?.name ?? request.customer?.email ?? 'Anonymous'}
          </h1>
          <ChannelBadge channel={request.sourceChannel} />
          <StatusBadge  status={request.status} />
          <PriorityBadge priority={request.prioritySnapshot} />
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">

          {/* Left panel */}
          <div className="space-y-5">
            {/* Original message */}
            <Card title="Original Message">
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                {request.originalMessage}
              </p>
              <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-3 text-xs text-gray-500">
                <div><span className="font-medium text-gray-600">Channel:</span> {request.sourceChannel}</div>
                <div><span className="font-medium text-gray-600">Received:</span> {new Date(request.createdAt).toLocaleString()}</div>
                {request.customer?.email && <div><span className="font-medium text-gray-600">Email:</span> {request.customer.email}</div>}
                {request.customer?.phone && <div><span className="font-medium text-gray-600">Phone:</span> {request.customer.phone}</div>}
                {request.resolvedAt && <div><span className="font-medium text-gray-600">Resolved:</span> {new Date(request.resolvedAt).toLocaleString()}</div>}
              </div>
            </Card>

            {/* Status update (admin only) */}
            {user?.role === 'admin' && (
              <Card title="Update Status">
                <div className="flex gap-3">
                  <select
                    value={selectedStatus}
                    onChange={(e) => setSelectedStatus(e.target.value)}
                    className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button
                    onClick={handleStatusChange}
                    disabled={statusSaving || selectedStatus === request.status}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    {statusSaving ? 'Saving…' : 'Update'}
                  </button>
                </div>
              </Card>
            )}

            {/* Add note */}
            <Card title="Internal Notes">
              <form onSubmit={handleAddNote} className="mb-4">
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Add an internal note…"
                  rows={3}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                />
                <button
                  type="submit"
                  disabled={noteLoading || !noteText.trim()}
                  className="mt-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {noteLoading ? 'Adding…' : '+ Add Note'}
                </button>
              </form>

              {notes?.length === 0 && <p className="text-xs text-gray-400">No notes yet.</p>}
              <div className="space-y-3">
                {notes?.map((n) => (
                  <div key={n._id} className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{n.noteBody}</p>
                    <div className="mt-2 text-xs text-gray-400 flex items-center gap-2">
                      <span>{n.author?.email ?? 'unknown'}</span>
                      <span>·</span>
                      <span>{new Date(n.createdAt).toLocaleString()}</span>
                      {n.isEdited && <span className="italic">(edited)</span>}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Right panel — AI Classification */}
          <div>
            <Card title="AI Classification">
              {!classification ? (
                <p className="text-sm text-gray-400">Classification pending…</p>
              ) : (
                <div className="space-y-4">
                  <ConfidenceMeter value={classification.confidence} />

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-1">Category</p>
                      <p className="text-sm font-semibold text-gray-800 capitalize">
                        {classification.category?.replace('_', ' ')}
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-1">Priority</p>
                      <PriorityBadge priority={classification.priority} />
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-1">Provider</p>
                      <p className="text-sm font-medium text-gray-700 capitalize">{classification.provider}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-1">Latency</p>
                      <p className="text-sm font-medium text-gray-700">{classification.latencyMs ?? '—'} ms</p>
                    </div>
                  </div>

                  <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3">
                    <p className="text-xs font-semibold text-indigo-600 mb-1">Summary</p>
                    <p className="text-sm text-gray-700 leading-relaxed">{classification.summary}</p>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs font-semibold text-gray-500 mb-1">Reason</p>
                    <p className="text-sm text-gray-600 leading-relaxed">{classification.reason}</p>
                  </div>

                  {classification.modelVersion && (
                    <p className="text-xs text-gray-400">Model: {classification.modelVersion}</p>
                  )}
                </div>
              )}
            </Card>
          </div>
        </div>

        {/* Timeline */}
        <Card title={`Event Timeline (${timeline?.length ?? 0} events)`}>
          {!timeline?.length ? (
            <p className="text-sm text-gray-400">No events recorded yet.</p>
          ) : (
            <div className="pt-2">
              {timeline.map((event, idx) => (
                <TimelineItem key={event._id} event={event} isLast={idx === timeline.length - 1} />
              ))}
            </div>
          )}
        </Card>
      </main>
    </div>
  );
};

export default RequestDetailView;
