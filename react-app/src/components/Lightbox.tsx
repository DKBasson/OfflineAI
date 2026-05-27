import { useApp } from '../context/AppContext';

export function Lightbox() {
  const { lightboxSrc, closeLightbox } = useApp();

  if (!lightboxSrc) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 cursor-zoom-out"
      onClick={closeLightbox}
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
    >
      <img
        src={lightboxSrc}
        alt="Full size preview"
        className="max-w-[90vw] max-h-[90vh] object-contain rounded shadow-xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
