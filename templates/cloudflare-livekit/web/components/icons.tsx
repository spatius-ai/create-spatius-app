export type IconName =
  | 'mic'
  | 'mic-off'
  | 'end'
  | 'chat'
  | 'close'
  | 'send'
  | 'type'
  | 'audio'
  | 'arrow';
const paths: Record<IconName, string> = {
  mic: 'M12 15a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v7a3 3 0 0 0 3 3ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8',
  'mic-off':
    'm3 3 18 18M9 9v3a3 3 0 0 0 5.1 2.1M15 9V5a3 3 0 0 0-5.7-1.3M5 10v2a7 7 0 0 0 12 5M19 10v2M12 19v3M8 22h8',
  end: 'M4 15v3H1v-5c6-6 16-6 22 0v5h-3v-3l-4-2v-3M8 10v3l-4 2',
  chat: 'M4 4h16v13H8l-4 4V4ZM8 9h8M8 13h5',
  close: 'm6 6 12 12M6 18 18 6',
  send: 'm5 12 7-7 7 7M12 5v15',
  type: 'M2 5h20v14H2V5ZM6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h4',
  audio: 'm3 9 5 0 5-4v14l-5-4H3V9ZM17 8a6 6 0 0 1 0 8M20 5a10 10 0 0 1 0 14',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
};
export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
