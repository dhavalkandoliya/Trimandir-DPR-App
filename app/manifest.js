export default function manifest() {
  return {
    name: 'Trimandir Construction DPR',
    short_name: 'Trimandir DPR',
    description: 'Trimandir Construction DPR Man Power Report',
    start_url: '/',
    display: 'standalone',
    background_color: '#E8EBE9',
    theme_color: '#15212B',
    icons: [
      {
        src: '/favicon.ico',
        sizes: 'any',
        type: 'image/x-icon',
      },
      {
        src: '/icon.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}
