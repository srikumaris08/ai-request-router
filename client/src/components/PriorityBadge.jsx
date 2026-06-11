const PRIORITY_STYLES = {
  low:      'bg-gray-100 text-gray-600',
  medium:   'bg-blue-100 text-blue-700',
  high:     'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700 font-semibold',
};

const PriorityBadge = ({ priority }) => (
  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs capitalize ${PRIORITY_STYLES[priority] ?? 'bg-gray-100 text-gray-500'}`}>
    {priority ?? '—'}
  </span>
);

export default PriorityBadge;
