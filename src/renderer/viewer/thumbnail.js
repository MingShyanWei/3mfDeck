// Offline 512px thumbnail rendering (SPEC 3.4), one shared WebGL context.
import { Viewer } from './Viewer.js';
import { buildModel } from './buildModel.js';

const SIZE = 512;
let viewer = null;

/** Render preview data to a 512×512 PNG (transparent background). */
export async function renderThumbnail(payload) {
  if (!viewer) {
    viewer = new Viewer(document.createElement('canvas'), { preserveDrawingBuffer: true });
    viewer.setSize(SIZE, SIZE, 1);
  }
  viewer.setModel(await buildModel(payload));
  viewer.setMode('original');
  await viewer.reveal(); // spread the GPU upload of big models over frames
  viewer.render();
  const blob = await new Promise((resolve) => viewer.renderer.domElement.toBlob(resolve, 'image/png'));
  viewer.clear();
  return new Uint8Array(await blob.arrayBuffer());
}
