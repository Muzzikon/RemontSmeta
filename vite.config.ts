import { defineConfig } from 'vite';
export default defineConfig({
  base: '/RemontSmeta/',
  server: { allowedHosts: ['terminal.local'] },
});
