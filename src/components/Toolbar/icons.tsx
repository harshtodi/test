/** Inline stroke icons for the toolbar (18px, currentColor). No icon library. */
import type { SVGProps } from 'react';

function Svg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}

export function FolderOpenIcon() {
  return (
    <Svg>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z" />
      <path d="M3 10h18l-1.5 8a2 2 0 0 1-2 1.6H6.5A2 2 0 0 1 4.5 18z" />
    </Svg>
  );
}

export function SaveIcon() {
  return (
    <Svg>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </Svg>
  );
}

export function MoreIcon() {
  return (
    <Svg>
      <circle cx="12" cy="5" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="12" cy="19" r="1.2" fill="currentColor" />
    </Svg>
  );
}

export function UndoIcon() {
  return (
    <Svg>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Svg>
  );
}

export function RedoIcon() {
  return (
    <Svg>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </Svg>
  );
}

export function GridIcon() {
  return (
    <Svg>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </Svg>
  );
}

export function EditorIcon() {
  return (
    <Svg>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
      <path d="M13 8h5M13 12h5M13 16h3" />
    </Svg>
  );
}

export function ChevronLeftIcon() {
  return (
    <Svg>
      <path d="m15 18-6-6 6-6" />
    </Svg>
  );
}

export function ChevronRightIcon() {
  return (
    <Svg>
      <path d="m9 18 6-6-6-6" />
    </Svg>
  );
}

export function ChevronDownIcon() {
  return (
    <Svg width="12" height="12">
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

export function RotateCcwIcon() {
  return (
    <Svg>
      <path d="M3 12a9 9 0 1 0 2.64-6.36L3 8" />
      <path d="M3 3v5h5" />
    </Svg>
  );
}

export function RotateCwIcon() {
  return (
    <Svg>
      <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" />
      <path d="M21 3v5h-5" />
    </Svg>
  );
}

export function TrashIcon() {
  return (
    <Svg>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </Svg>
  );
}

export function BlankPageIcon() {
  return (
    <Svg>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M12 18v-6M9 15h6" />
    </Svg>
  );
}

export function CursorIcon() {
  return (
    <Svg>
      <path d="M5 3l14 8.5-6.5 1.5L10 20z" />
    </Svg>
  );
}

export function TextIcon() {
  return (
    <Svg>
      <path d="M5 5h14" />
      <path d="M12 5v15" />
      <path d="M9 20h6" />
    </Svg>
  );
}

export function PenIcon() {
  return (
    <Svg>
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <path d="M2 2l7.586 7.586" />
      <circle cx="11" cy="11" r="2" />
    </Svg>
  );
}

export function HighlighterIcon() {
  return (
    <Svg>
      <path d="m9 11-6 6v3h9l3-3" />
      <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4z" />
    </Svg>
  );
}

export function RectIcon() {
  return (
    <Svg>
      <rect x="4" y="5" width="16" height="14" rx="1.5" />
    </Svg>
  );
}

export function HighlightBoxIcon() {
  return (
    <Svg>
      <rect x="4" y="5" width="16" height="14" rx="1.5" fill="currentColor" fillOpacity="0.35" />
    </Svg>
  );
}

export function WhiteoutIcon() {
  return (
    <Svg>
      <path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4L13 5a2 2 0 0 1 2.8 0L21 10.2a2 2 0 0 1 0 2.8L13 21" />
      <path d="M22 21H7" />
      <path d="m5 11 9 9" />
    </Svg>
  );
}

export function SignatureIcon() {
  return (
    <Svg>
      <path d="M3 17c3-6 5-9 7-9s1 6 3 6 3-5 4-5 1 5 2 5 2-2 3-3" />
      <path d="M3 21h18" />
    </Svg>
  );
}

export function MinusIcon() {
  return (
    <Svg>
      <path d="M5 12h14" />
    </Svg>
  );
}

export function PlusIcon() {
  return (
    <Svg>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function CloseIcon() {
  return (
    <Svg>
      <path d="M18 6 6 18M6 6l12 12" />
    </Svg>
  );
}

export function PencilIcon() {
  return (
    <Svg width="14" height="14">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </Svg>
  );
}
