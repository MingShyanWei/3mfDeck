// Camera framing math (pure, unit-tested).

// Default view direction in a Z-up world: from front-right-above, so the
// top (+Z), front (-Y) and right (+X) faces are visible.
export const VIEW_DIR = [1, -1.3, 0.9];

/** Camera distance so a sphere of `radius` fits the view frustum. */
export function fitDistance(radius, vfovDeg, aspect, margin = 1.05) {
  const v = (vfovDeg * Math.PI) / 360;
  const h = Math.atan(Math.tan(v) * aspect);
  return (radius / Math.sin(Math.min(v, h))) * margin;
}
