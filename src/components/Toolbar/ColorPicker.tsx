import type { CSSProperties } from 'react';
import type { RGB } from '@/core/types';
import { hexToRgb, rgbToCss, rgbToHex } from '@/core/color';
import type { Swatch } from './helpers';
import { sameColor } from './helpers';

export interface ColorPickerProps {
  swatches: Swatch[];
  value: RGB;
  /** Called for every pick (swatches and the custom picker). */
  onChange: (color: RGB) => void;
  /** Show an <input type=color> for arbitrary colors. */
  custom?: boolean;
  /** Prefix for the group's aria-label / tooltip, e.g. "Pen color". */
  label: string;
  testPrefix?: string;
}

/**
 * A row of color swatches plus an optional native color input. Swatches get
 * `opt-color-<name>` test ids; the custom input gets `opt-color-custom`.
 */
export function ColorPicker({ swatches, value, onChange, custom = false, label, testPrefix = 'opt-color-' }: ColorPickerProps) {
  const customActive = !swatches.some((s) => sameColor(s.color, value));
  return (
    <div className="tb-swatches" role="radiogroup" aria-label={label}>
      {swatches.map((s) => {
        const active = sameColor(s.color, value);
        return (
          <button
            key={s.name}
            type="button"
            role="radio"
            aria-checked={active}
            className={`tb-swatch${active ? ' active' : ''}`}
            style={{ '--swatch': rgbToCss(s.color) } as CSSProperties}
            title={`${label}: ${s.label}`}
            aria-label={`${label}: ${s.label}`}
            data-testid={`${testPrefix}${s.name}`}
            // Re-picking the active swatch is a no-op: for a selected annotation
            // every onChange records an undo step, and an empty one makes the
            // next Undo look broken.
            onClick={() => {
              if (!active) onChange(s.color);
            }}
          />
        );
      })}
      {custom && (
        <label
          className={`tb-swatch tb-swatch-custom${customActive ? ' active' : ''}`}
          style={{ '--swatch': rgbToCss(value) } as CSSProperties}
          title={`${label}: custom…`}
        >
          <input
            type="color"
            value={rgbToHex(value)}
            aria-label={`${label}: custom`}
            data-testid={`${testPrefix}custom`}
            onChange={(e) => onChange(hexToRgb(e.target.value))}
          />
        </label>
      )}
    </div>
  );
}
