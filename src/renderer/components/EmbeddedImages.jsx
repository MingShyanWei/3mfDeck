// M19 (SPEC 3.4b): product images embedded in the 3MF — cover, creator photos,
// Orca plate renders. The cover comes from the index (stored at import); the
// others are read from the file one entry at a time.
import { useEffect, useRef } from 'react';
const src = (id, path, cover) => (path === cover ? `mfimg://cover/${id}` : `mfimg://entry/${id}?p=${encodeURIComponent(path)}`);
const LABEL = { cover: '封面', thumb: '縮圖', photo: '實拍', plate: '盤' };

/** 3D / 原檔圖 switch; renders nothing for a project without embedded images. */
export function PreviewSwitch({ embedded, mode, onMode }) {
  if (!embedded?.images.length) return null;
  return (
    <div className="seg-group preview-switch" data-testid="preview-switch">
      <button className={mode === '3d' ? 'seg on' : 'seg'} data-testid="preview-mode-3d" onClick={() => onMode('3d')}>
        <i className="mdi mdi-cube-outline" /> 3D
      </button>
      <button className={mode === 'images' ? 'seg on' : 'seg'} data-testid="preview-mode-images" onClick={() => onMode('images')}>
        <i className="mdi mdi-image-multiple-outline" /> 原檔圖 <span className="muted">{embedded.images.length}</span>
      </button>
    </div>
  );
}

export default function EmbeddedImages({ id, embedded, path, onPath }) {
  const current = embedded.images.find((i) => i.path === path) || embedded.images[0];
  const strip = useRef(null);
  // keep the selected thumbnail visible (e.g. picked through the plate switcher)
  useEffect(() => {
    strip.current?.querySelector('.embedded-thumb.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current.path]);
  return (
    <div className="embedded" data-testid="embedded-images">
      <div className="embedded-stage">
        <img src={src(id, current.path, embedded.cover)} alt="" data-testid="embedded-image" data-path={current.path} draggable={false} />
      </div>
      <div className="embedded-thumbs" data-testid="embedded-thumbs" ref={strip}>
        {embedded.images.map((i) => (
          <button
            key={i.path}
            className={`embedded-thumb${i.path === current.path ? ' on' : ''}`}
            data-testid="embedded-thumb"
            data-path={i.path}
            title={i.path.split('/').pop()}
            onClick={() => onPath(i.path)}
          >
            <img src={src(id, i.path, embedded.cover)} alt="" loading="lazy" draggable={false} />
            <span>{i.kind === 'plate' ? `盤 ${i.plate}` : LABEL[i.kind]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
