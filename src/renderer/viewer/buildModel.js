// Turn preview data from main into a three.js object.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { AMFLoader } from 'three/addons/loaders/AMFLoader.js';
import { nearestSlot } from '../../core/filament.mjs';

export const GRAY = 0xb4b4b0;

const exactBuffer = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

// Lambert (no specular highlight) so a black filament face renders black,
// not glossy grey.
const grayMaterial = () => new THREE.MeshLambertMaterial({ color: GRAY, flatShading: true, side: THREE.DoubleSide });

// #RRGGBB -> linear RGB bytes (three treats vertex colours as linear)
function linearBytes(hex) {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b].map((v) => Math.round(v * 255));
}

function faceColours(faceColor, palette) {
  const out = new Uint8Array(faceColor.length * 9);
  const gray = linearBytes('#' + GRAY.toString(16));
  for (let f = 0; f < faceColor.length; f++) {
    const rgb = palette[faceColor[f] - 1] || gray;
    for (let k = 0; k < 3; k++) out.set(rgb, f * 9 + k * 3);
  }
  return out;
}

/**
 * 3MF with per-face colours (paint_color or material colour). Geometry is
 * de-indexed so every face can carry its own colour. `paint` holds the two
 * colour arrays the viewer swaps between: original colours and their
 * nearest U1 slot colours. Faces without a colour (index 0) stay grey.
 */
function buildPainted({ positions, indices, faceColor, palette }) {
  const pos = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i] * 3;
    pos[i * 3] = positions[v];
    pos[i * 3 + 1] = positions[v + 1];
    pos[i * 3 + 2] = positions[v + 2];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (!palette.length) return { object: new THREE.Mesh(geometry, grayMaterial()), zUp: true, paint: null };

  const original = faceColours(faceColor, palette.map(linearBytes));
  const filament = faceColours(faceColor, palette.map((c) => linearBytes(nearestSlot(c).hex)));
  geometry.setAttribute('color', new THREE.BufferAttribute(original.slice(), 3, true));
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  return { object: new THREE.Mesh(geometry, material), zUp: true, paint: { geometry, original, filament } };
}

function withGray(object) {
  object.traverse((o) => {
    if (o.isMesh) o.material = grayMaterial();
  });
  return object;
}

/** Returns { object, zUp, paint } — paint is null unless the model has paint colours. */
export async function buildModel(payload) {
  switch (payload.format) {
    case '3mf':
      return buildPainted(payload);
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
