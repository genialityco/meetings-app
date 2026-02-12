import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: [
      'firebase/app',
      'firebase/auth',
      'firebase/firestore',
      'firebase/storage',
      'firebase/messaging',
      '@mantine/core',
      '@mantine/hooks',
      '@mantine/dates',
      '@mantine/modals',
      '@mantine/notifications',
      '@mantine/tiptap',
      '@tabler/icons-react',
      'react-icons/fa',
      'react-icons/io5',
      'react-icons/bi',
      'react-router-dom',
      'dayjs',
      'xlsx',
    ],
  },
})
