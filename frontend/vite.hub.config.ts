// srv-hub instance (:10087, see /root/shock/toolbox/srv-hub/tianyan-hub.sh): same app,
// served under /service/tianyan/, so the API proxy has to match the prefixed path too.
import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config'

export default mergeConfig(base, defineConfig({
  base: '/service/tianyan/',
  server: {
    proxy: {
      '/service/tianyan/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/service\/tianyan/, ''),
      },
    },
  },
}))
