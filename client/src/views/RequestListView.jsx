import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axiosInstance';
import socket from '../api/socket';
import { useAuth } from '../context/AuthContext';
import StatusBadge from '../components/StatusBadge';
import PriorityBadge from '../components/PriorityBadge';
import ChannelBadge from '../components/ChannelBadge';
import ConnectionBadge from '../components/ConnectionBadge';

const STATUSES   = ['queued', 'processing', 'completed', 'failed'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const CATEGORIES = ['billing', 'technical', 'general_inquiry', 'complaint', 'feature_request', 'refund', 'other'];

const Select = ({ label, value, onChange, options, allLabel }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
  >
    <option value="">{allLabel ?? `All ${label}`}</option>
    {options.map((o) => (
      <option key={o} value={o}>{o.replace('_', ' ')}</option>
    ))}
  </select>
);

const RequestListView = () => {
  const { user, logout } = useAuth();
  const navigate         = useNavigate();

  const [requests,    setRequests]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [pagination,  setPagination]  = useState({});
  const [page,        setPage]        = useState(1);
  const [filters, setFilters] = useState({ status: '', priority: '', category: '' });
  const [toast, setToast] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { page, limit: 20, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) };
      const { data } = await api.get('/requests', { params });
      setRequests(data.data.requests);
      setPagination(data.data.pagination);
    } catch {
      setError('Failed to load requests.');
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  // ── Real-time Socket.io listeners ────────────────────────────────────────
  useEffect(() => {
    const onNew = (payload) => {
      showToast(`New request received (${payload.requestId.slice(-6)})`);
      fetchRequests();
    };

    const onUpdated = (payload) => {
      setRequests((prev) =>
        prev.map((r) =>
          r._id === payload.requestId
            ? {
                ...r,
                status:           payload.status,
                categorySnapshot: payload.categorySnapshot ?? r.categorySnapshot,
                prioritySnapshot: payload.prioritySnapshot ?? r.prioritySnapshot,
              }
            : r
        )
      );
      showToast(`Request ${payload.requestId.slice(-6)} updated → ${payload.status}`);
    };

    socket.on('request:new',     onNew);
    socket.on('request:updated', onUpdated);
    return () => {
      socket.off('request:new',     onNew);
      socket.off('request:updated', onUpdated);
    };
  }, [fetchRequests]);

  const handleFilterChange = (key) => (val) => {
    setPage(1);
    setFilters((f) => ({ ...f, [key]: val }));
  };

  const clearFilters = () => {
    setPage(1);
    setFilters({ status: '', priority: '', category: '' });
  };

  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-indigo-700 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <span className="font-semibold text-gray-900">AI Request Router</span>
        </div>
        <div className="flex items-center gap-4">
          <ConnectionBadge />
          <span className="text-sm text-gray-500">{user?.email}</span>
          <button onClick={logout} className="text-sm text-red-600 hover:text-red-700 font-medium">Logout</button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Page title + refresh */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Customer Requests</h1>
            {pagination.total !== undefined && (
              <p className="text-sm text-gray-500 mt-0.5">{pagination.total} total requests</p>
            )}
          </div>
          <button onClick={fetchRequests} className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium transition-colors">
            ↻ Refresh
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-5 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-gray-600">Filter by:</span>
          <Select label="Status"   value={filters.status}   onChange={handleFilterChange('status')}   options={STATUSES} />
          <Select label="Priority" value={filters.priority} onChange={handleFilterChange('priority')} options={PRIORITIES} />
          <Select label="Category" value={filters.category} onChange={handleFilterChange('category')} options={CATEGORIES} allLabel="All Categories" />
          {hasFilters && (
            <button onClick={clearFilters} className="text-sm text-red-500 hover:text-red-600 font-medium ml-auto">
              Clear filters
            </button>
          )}
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {error && (
            <div className="p-6 text-center text-red-600 text-sm">{error}</div>
          )}

          {loading ? (
            <div className="p-12 text-center text-gray-400 text-sm">Loading requests…</div>
          ) : requests.length === 0 ? (
            <div className="p-12 text-center text-gray-400 text-sm">No requests match the current filters.</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      {['Message', 'Channel', 'Status', 'Priority', 'Category', 'Customer', 'Created'].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                      ))}
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {requests.map((r) => (
                      <tr key={r._id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 max-w-xs">
                          <p className="text-gray-800 truncate">{r.originalMessage}</p>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap"><ChannelBadge channel={r.sourceChannel} /></td>
                        <td className="px-4 py-3 whitespace-nowrap"><StatusBadge status={r.status} /></td>
                        <td className="px-4 py-3 whitespace-nowrap"><PriorityBadge priority={r.prioritySnapshot} /></td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600 capitalize">
                          {r.categorySnapshot?.replace('_', ' ') ?? <span className="text-gray-400">pending</span>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                          {r.customer?.email ?? r.customer?.name ?? <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-400">
                          {new Date(r.createdAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => navigate(`/requests/${r._id}`)}
                            className="text-indigo-600 hover:text-indigo-800 font-medium whitespace-nowrap"
                          >
                            View →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {pagination.pages > 1 && (
                <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500">
                  <span>Page {pagination.page} of {pagination.pages}</span>
                  <div className="flex gap-2">
                    <button
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                      className="px-3 py-1.5 rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
                    >
                      ← Prev
                    </button>
                    <button
                      disabled={page >= pagination.pages}
                      onClick={() => setPage((p) => p + 1)}
                      className="px-3 py-1.5 rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
                    >
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default RequestListView;
