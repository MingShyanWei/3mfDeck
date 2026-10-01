// Generate missing thumbnails in the background, one model at a time.
// Triggered at startup, after imports and after switching root.
import { renderThumbnail } from './viewer/thumbnail.js';

const failed = new Set(); // don't retry within this session
let running = false;
let again = false;

export async function runThumbQueue(onThumb) {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      for (const id of await window.api.idsNeedingThumb()) {
        if (failed.has(id)) continue;
        try {
          const payload = await window.api.preview(id);
          if (payload.missing) {
            failed.add(id); // missing file (遺失): nothing to render this session
            continue;
          }
          const png = await renderThumbnail(payload);
          await window.api.setThumb(id, png);
          onThumb(id);
        } catch (err) {
          failed.add(id);
          console.warn(`thumbnail failed for model ${id}: ${err.message}`);
        }
      }
    } while (again);
  } finally {
    running = false;
  }
}
