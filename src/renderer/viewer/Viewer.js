// three.js scene shared by the interactive preview and thumbnail rendering.
// World is Z-up (3D printing convention); Y-up formats are rotated in.
import * as THREE from 'three';
import { VIEW_DIR, fitDistance } from './fit.js';

export const MODES = ['original', 'filament', 'estimate'];

export class Viewer {
  constructor(canvas, { preserveDrawingBuffer = false } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
    this.camera.up.set(0, 0, 1);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.6));
    // Key light rides with the camera so visible faces are always lit
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(0.3, 0.6, 1);
    this.camera.add(key);
    this.scene.add(this.camera);
    this.built = null;
    this.root = null;
    this.target = new THREE.Vector3();
  }

  setSize(w, h, pixelRatio = window.devicePixelRatio) {
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setModel(built) {
    this.clear();
    this.built = built;
    this.root = new THREE.Group();
    if (!built.zUp) built.object.rotation.x = Math.PI / 2;
    this.root.add(built.object);
    this.scene.add(this.root);
    this.fit();
  }

  clear() {
    if (!this.root) return;
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      for (const m of [o.material].flat()) {
        if (!m) continue;
        m.map?.dispose();
        m.dispose();
      }
    });
    this.root = null;
    this.built = null;
  }

  fit() {
    const sphere = new THREE.Box3().setFromObject(this.root).getBoundingSphere(new THREE.Sphere());
    const dist = fitDistance(sphere.radius, this.camera.fov, this.camera.aspect);
    const dir = new THREE.Vector3(...VIEW_DIR).normalize();
    this.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.camera.near = Math.max(dist / 1000, dist - sphere.radius * 2);
    this.camera.far = dist + sphere.radius * 4;
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
  }

  /** 'original' | 'filament' (needs paint data) | 'estimate' (Full Spectrum estimate) */
  setMode(mode) {
    if (!this.root) return;
    const paint = this.built.paint;
    if (paint) {
      // Swap the backing array (same length) instead of copying 50 MB+ on big models
      for (const c of paint.chunks) {
        const attr = c.geometry.getAttribute('color');
        attr.array = mode === 'filament' ? c.filament : mode === 'estimate' && c.estimate ? c.estimate : c.original;
        attr.needsUpdate = true;
      }
    }
  }

  /**
   * Show the model's meshes one per frame: each render uploads one chunk to
   * the GPU, so a multi-million-face model never blocks the UI for long.
   * Resolves when everything is visible (or the model was replaced).
   */
  async reveal() {
    const root = this.root;
    const meshes = [];
    root.traverse((o) => o.isMesh && meshes.push(o));
    if (meshes.length < 2) return this.render();
    for (const m of meshes) m.visible = false;
    for (const m of meshes) {
      if (this.root !== root) return;
      m.visible = true;
      this.render();
      await new Promise((r) => requestAnimationFrame(r));
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
