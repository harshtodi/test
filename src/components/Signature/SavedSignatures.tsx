import type { SavedSignature } from './signature-store';

export interface SavedSignaturesProps {
  signatures: SavedSignature[];
  onPick: (sig: SavedSignature) => void;
  onRemove: (id: string) => void;
}

/** Thumbnails of previously used signatures. Click to use one, × to forget it. */
export function SavedSignatures({ signatures, onPick, onRemove }: SavedSignaturesProps) {
  if (signatures.length === 0) return null;
  return (
    <section className="sig-saved" aria-labelledby="sig-saved-heading">
      <h3 id="sig-saved-heading" className="sig-saved-heading">
        Saved signatures
      </h3>
      <ul className="sig-saved-list" data-testid="sig-saved-list">
        {signatures.map((sig, i) => (
          <li key={sig.id} className="sig-saved-entry">
            <button
              type="button"
              className="sig-saved-item"
              data-testid="sig-saved-item"
              data-signature-id={sig.id}
              title="Use this signature"
              aria-label={`Use saved signature ${i + 1}`}
              onClick={() => onPick(sig)}
            >
              <img src={sig.dataUrl} alt="" width={sig.width} height={sig.height} draggable={false} />
            </button>
            <button
              type="button"
              className="sig-saved-remove"
              data-testid="sig-saved-remove"
              title="Remove from saved signatures"
              aria-label={`Remove saved signature ${i + 1}`}
              onClick={(e) => {
                e.stopPropagation();
                onRemove(sig.id);
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
