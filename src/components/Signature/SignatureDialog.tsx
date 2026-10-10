/** STUB — implemented in milestone M4. */
export function SignatureDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div role="dialog" data-testid="signature-dialog">
      <button onClick={onClose}>Close</button>
    </div>
  );
}
