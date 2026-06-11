const STATUS_STYLES = {
  queued:     'bg-blue-100 text-blue-700',
  processing: 'bg-amber-100 text-amber-700',
  completed:  'bg-green-100 text-green-700',
  failed:     'bg-red-100 text-red-700',
};

const StatusBadge = ({ status }) => (
  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600'}`}>
    {status ?? '—'}
  </span>
);

export default StatusBadge;
