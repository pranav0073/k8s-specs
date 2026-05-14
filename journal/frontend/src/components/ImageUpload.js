import React, { useRef, useState } from 'react';
import axios from 'axios';

// props:
//   images       – string[] of filenames already saved (from DB)
//   uploadUrl    – POST endpoint e.g. /api/sessions/2026-05-11/images
//   deleteUrlFn  – fn(filename) => DELETE endpoint string
//   onImagesChange – called after upload/delete so parent can refresh

export default function ImageUpload({ images, uploadUrl, deleteUrlFn, onImagesChange }) {
  const imgs = Array.isArray(images) ? images : [];
  const inputRef   = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [lightbox,  setLightbox]  = useState(null); // filename to preview full-screen

  const handleFiles = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const base64 = await readAsBase64(file);
        await axios.post(uploadUrl, { data: base64, filename: file.name });
      }
      onImagesChange?.();
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleDelete = async (filename) => {
    await axios.delete(deleteUrlFn(filename));
    onImagesChange?.();
  };

  // drag-and-drop
  const handleDrop = (e) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div className="img-upload-section">
      {/* Thumbnails */}
      {imgs.length > 0 && (
        <div className="img-gallery">
          {imgs.map(fname => (
            <div key={fname} className="img-thumb-wrap">
              <img
                src={`/uploads/${fname}`}
                alt="chart"
                className="img-thumb"
                onClick={() => setLightbox(fname)}
              />
              <button
                className="img-delete-btn"
                title="Remove"
                onClick={() => handleDelete(fname)}
              >×</button>
            </div>
          ))}
        </div>
      )}

      {/* Upload area */}
      <div
        className={`img-drop-zone${uploading ? ' uploading' : ''}`}
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={e => handleFiles(e.target.files)}
        />
        {uploading
          ? <span>Uploading…</span>
          : <span>📷 Drop chart screenshot here or <u>click to browse</u></span>
        }
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div className="img-lightbox" onClick={() => setLightbox(null)}>
          <div className="img-lightbox-inner" onClick={e => e.stopPropagation()}>
            <button className="img-lightbox-close" onClick={() => setLightbox(null)}>✕</button>
            <img src={`/uploads/${lightbox}`} alt="chart preview" className="img-lightbox-img" />
          </div>
        </div>
      )}
    </div>
  );
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      // Scale down if wider than 2400px (keeps chart readable, cuts file size)
      const MAX = 2400;
      const scale = img.width > MAX ? MAX / img.width : 1;
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      // JPEG at 85% quality — good enough for chart screenshots
      const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
      resolve(base64);
    };
    img.onerror = reject;
    img.src = url;
  });
}
