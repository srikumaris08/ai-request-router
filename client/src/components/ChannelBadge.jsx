const CHANNEL_STYLES = {
  email:  'bg-purple-100 text-purple-700',
  chat:   'bg-cyan-100 text-cyan-700',
  phone:  'bg-green-100 text-green-700',
  portal: 'bg-indigo-100 text-indigo-700',
  api:    'bg-gray-100 text-gray-600',
};

const ChannelBadge = ({ channel }) => (
  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs capitalize ${CHANNEL_STYLES[channel] ?? 'bg-gray-100 text-gray-500'}`}>
    {channel ?? '—'}
  </span>
);

export default ChannelBadge;
