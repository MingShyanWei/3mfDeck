// Web Worker: prepare painted-3MF mesh data off the UI thread.
import { prepareMesh } from './meshData.js';

self.onmessage = ({ data: { id, payload, options } }) => {
  try {
    const r = prepareMesh(payload, options);
    const transfer = [r.positions.buffer, r.original?.buffer, r.filament?.buffer, r.estimate?.buffer].filter(Boolean);
    self.postMessage({ id, result: r }, transfer);
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
