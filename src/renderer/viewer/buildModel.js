// Turn preview data from main into a three.js object.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { AMFLoader } from 'three/addons/loaders/AMFLoader.js';
import MeshWorker from './meshWorker.js?worker';

export const GRAY = 0xb4b4b0;

// Faces per mesh chunk. Big models are split so the GPU upload can be
// spread over several frames instead of freezing the UI in one go.
export const CHUNK_FACES = 262144;

// One worker for all painted-3MF preparation (preview and thumbnails)
let worker = null;
let seq = 0;
const pending = new Map();
function prepareInWorker(payload, options) {
  if (!worker) {
    worker = new MeshWorker();
    worker.onmessage = ({ data }) => {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(data.error));
      else resolve(data.result);
    };
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    // Transfer the input buffers: the worker owns them from here on
    worker.postMessage({ id, payload, options }, [payload.positions.buffer, payload.indices.buffer, payload.faceColor.buffer]);
  });
}

const exactBuffer = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

// Lambert (no specular highlight) so a black filament face renders black,
// not glossy grey.
const grayMaterial = () => new THREE.MeshLambertMaterial({ color: GRAY, flatShading: true, side: THREE.DoubleSide });

/**
 * 3MF with per-face colours (paint_color or material colour). The worker
 * de-indexes (so every face can carry its own colour) and quantizes
 * positions to Int16; the group's scale/position undo the quantization.
 * The faces are split into CHUNK_FACES meshes (views into the same buffers,
 * no copies). `paint` lists, per chunk, the geometry and the two colour
 * arrays the viewer swaps between: original colours and their nearest U1
 * slot colours. Uncoloured faces stay grey.
 */
async function buildPainted(payload, { estimate = false } = {}) {
  const { positions, center, half, original, filament, estimate: est } = await prepareInWorker(payload, { estimate });
  const group = new THREE.Group();
  group.scale.set(...half);
  group.position.set(...center);
  const material = original
    ? new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide })
    : grayMaterial();
  const faces = positions.length / 9;
  const chunks = [];
  for (let f = 0; f < faces; f += CHUNK_FACES) {
    const [a, b] = [f * 9, Math.min(faces, f + CHUNK_FACES) * 9];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions.subarray(a, b), 3, true));
    // Quantized positions lie in [-1, 1]^3: give three the bounds up front
    // instead of letting it scan millions of vertices (framing, culling).
    geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Math.sqrt(3));
    if (original) {
      geometry.setAttribute('color', new THREE.BufferAttribute(original.subarray(a, b), 3, true));
      chunks.push({ geometry, original: original.subarray(a, b), filament: filament.subarray(a, b), estimate: est?.subarray(a, b) ?? null });
    }
    group.add(new THREE.Mesh(geometry, material));
  }
  return { object: group, zUp: true, paint: original ? { chunks, hasEstimate: Boolean(est) } : null };
}

function withGray(object) {
  object.traverse((o) => {
    if (o.isMesh) o.material = grayMaterial();
  });
  return object;
}

/**
 * Returns { object, zUp, paint } — paint is null unless the model has paint
 * colours. `estimate`: also compute the Full Spectrum mixed-colour estimate.
 */
export async function buildModel(payload, { estimate = false } = {}) {
  switch (payload.format) {
    case '3mf':
      return buildPainted(payload, { estimate });
    case 'stl':
      return { object: new THREE.Mesh(new STLLoader().parse(exactBuffer(payload.bytes)), grayMaterial()), zUp: true, paint: null };
    case 'amf':
      return { object: withGray(new AMFLoader().parse(exactBuffer(payload.bytes))), zUp: true, paint: null };
    case 'obj': // OBJ exporters (Meshy, Blender) are Y-up
      return { object: withGray(new OBJLoader().parse(new TextDecoder().decode(payload.bytes))), zUp: false, paint: null };
    case 'glb':
    case 'gltf': {
      const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(exactBuffer(payload.bytes), '', resolve, reject));
      return { object: gltf.scene, zUp: false, paint: null };
    }
    default:
      throw new Error(`no preview for ${payload.format}`);
  }
}
