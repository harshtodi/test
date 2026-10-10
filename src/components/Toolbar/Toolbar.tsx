/** STUB — implemented in milestone M4. */
export function Toolbar({ onOpen }: { onOpen: () => void }) {
  return (
    <header className="toolbar" data-testid="toolbar">
      <button className="btn" onClick={onOpen} data-testid="toolbar-open">
        Open
      </button>
    </header>
  );
}
