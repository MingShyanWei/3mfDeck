import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

// M22 (SPEC 3.11): build time + git short hash, written next to the bundle as
// build-info.json at every `vite build` (main reads it for the sidebar label
// and the About panel). Nothing is fetched: the app stays offline.
function gitCommit() {
  try {
    const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const dirty = execSync('git status --porcelain --untracked-files=no', { encoding: 'utf8' }).trim() ? '+dirty' : '';
    return hash + dirty;
  } catch {
    return 'unknown';
  }
}
const buildInfo = () => ({
  name: 'build-info',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify({ time: new Date().toISOString(), commit: gitCommit() }) });
  },
});

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), buildInfo()],
  build: { outDir: '../../dist', emptyOutDir: true },
});
