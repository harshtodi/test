export function EmptyState({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="empty-state" data-testid="empty-state">
      <div className="empty-card">
        <div className="empty-icon" aria-hidden>
          📄
        </div>
        <h1>Drop PDFs or images here</h1>
        <p>Merge files, rearrange and rotate pages, add text, draw, highlight and sign. Nothing leaves your computer.</p>
        <button className="btn btn-primary" onClick={onOpen} data-testid="open-button">
          Open files…
        </button>
        <p className="hint">Supports .pdf, .png, .jpg, .webp — drop several at once to merge them.</p>
      </div>
    </div>
  );
}
