// Minimal geometry helpers for bounding boxes.
// Affine matrices are row-major 3x4: [a b c tx, d e f ty, g h i tz].

export const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

export const emptyBox = () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });

export function growBox(box, x, y, z) {
  if (x < box.min[0]) box.min[0] = x;
  if (y < box.min[1]) box.min[1] = y;
  if (z < box.min[2]) box.min[2] = z;
  if (x > box.max[0]) box.max[0] = x;
  if (y > box.max[1]) box.max[1] = y;
  if (z > box.max[2]) box.max[2] = z;
}

export function applyAffine(m, x, y, z) {
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11],
  ];
}

// Grow `out` by the 8 transformed corners of `box`.
export function transformBox(box, m, out) {
  if (box.min[0] === Infinity) return;
  for (const x of [box.min[0], box.max[0]])
    for (const y of [box.min[1], box.max[1]])
      for (const z of [box.min[2], box.max[2]]) growBox(out, ...applyAffine(m, x, y, z));
}

// a ∘ b (apply b first, then a)
export function mulAffine(a, b) {
  const r = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) r[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j];
    r[i * 4 + 3] = a[i * 4] * b[3] + a[i * 4 + 1] * b[7] + a[i * 4 + 2] * b[11] + a[i * 4 + 3];
  }
  return r;
}

// {x,y,z} size in mm, rounded to 0.01; null for an empty box.
export function boxSize(box, scale = 1) {
  if (box.min[0] === Infinity) return null;
  const r = (v) => Math.round(v * scale * 100) / 100;
  return { x: r(box.max[0] - box.min[0]), y: r(box.max[1] - box.min[1]), z: r(box.max[2] - box.min[2]) };
}
