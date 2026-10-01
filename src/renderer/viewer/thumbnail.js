// Offline 512px thumbnail rendering (SPEC 3.4), one shared WebGL context.
import * as THREE from 'three';
import { Viewer } from './Viewer.js';
import { buildModel } from './buildModel.js';

// M21: the preview uses Lambert so black filament looks black, but a black
// albedo then reflects nothing and a black part renders as a flat silhouette
// (咕咕嘎嘎-U1's first plate: a #000000 base). Like Orca's own plate renders,
// thumbnails draw black as a dark grey (linear colours mapped onto
// [FLOOR, 255], other colours barely move) with a little specular, so every
// face shows its shape. Only the thumbnail's copy of the colours changes.
const FLOOR = 6; // linear 6/255 ~ sRGB #2a2a2a
function liftColours(geometry, done) {
  const attr = geometry.getAttribute('color');
  if (!attr || done.has(attr.array)) return;
  done.add(attr.array);
  const a = attr.array;
  for (let i = 0; i < a.length; i++) a[i] = FLOOR + Math.round((a[i] * (255 - FLOOR)) / 255);
  attr.needsUpdate = true;
}
function thumbnailMaterials(root) {
  const swap = new Map();
  const lifted = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    liftColours(o.geometry, lifted);
    const m = o.material;
    if (!swap.has(m)) {
      swap.set(m, new THREE.MeshPhongMaterial({ vertexColors: m.vertexColors, color: m.color, map: m.map ?? null, specular: 0x3a3a3a, shininess: 18, flatShading: true, side: THREE.DoubleSide }));
      m.dispose(); // its texture (if any) lives on in the replacement and is freed by Viewer.clear()
    }
    o.material = swap.get(m);
  });
}

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
  thumbnailMaterials(viewer.root);
  await viewer.reveal(); // spread the GPU upload of big models over frames
  viewer.render();
  const blob = await new Promise((resolve) => viewer.renderer.domElement.toBlob(resolve, 'image/png'));
  viewer.clear();
  return new Uint8Array(await blob.arrayBuffer());
}
