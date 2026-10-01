// Web Worker: prepare painted-3MF mesh data off the UI thread.
import { prepareMesh } from './meshData.js';

self.onmessage = ({ data: { id, payload } }) => {
  try {
    const r = prepareMesh(payload);
    const transfer = [r.positions.buffer, r.original?.buffer, r.filament?.buffer].filter(Boolean);
    self.postMessage({ id, result: r }, transfer);
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
