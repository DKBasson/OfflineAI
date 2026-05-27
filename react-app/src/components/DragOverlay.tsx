import { useApp } from '../context/AppContext';

export function DragOverlay() {
  const { isDragActive } = useApp();

  if (!isDragActive) return null;

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-[rgba(98,168,255,0.08)] border-2 border-dashed border-accent rounded-lg pointer-events-none"
      aria-hidden="true"
    >
      <div className="text-center">
        <div className="text-4xl mb-2">📎</div>
        <p className="text-accent text-[16px] font-semibold">Drop files to attach</p>
      </div>
    </div>
  );
}
