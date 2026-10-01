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
          const png = await renderThumbnail(await window.api.preview(id));
          await window.api.setThumb(id, png);
          onThumb(id);
        } catch (err) {
          failed.add(id);
          // A file missing from the current root is expected (shown as 遺失)
          if (!/ENOENT/.test(err.message)) console.warn(`thumbnail failed for model ${id}: ${err.message}`);
        }
      }
    } while (again);
  } finally {
    running = false;
  }
}
