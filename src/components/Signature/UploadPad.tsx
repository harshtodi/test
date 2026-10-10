import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, RefObject } from 'react';
import { fitWithin, knockOutWhite, loadImageFile } from './signature-image';

export interface UploadPadProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onInkChange: (hasInk: boolean) => void;
}

/**
 * Upload a PNG or JPEG of a signature. The image is drawn into a canvas
 * (scaled down to at most 1600px on the longest side). PNG transparency is
 * kept; for scans and photos the near-white background can be knocked out.
 */
export function UploadPad({ canvasRef, onInkChange }: UploadPadProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [knockOut, setKnockOut] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    if (!img) {
      canvas.width = 1;
      canvas.height = 1;
      ctx.clearRect(0, 0, 1, 1);
      onInkChange(false);
      return;
    }
    const size = fitWithin(img.naturalWidth, img.naturalHeight);
    canvas.width = size.width;
    canvas.height = size.height;
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.drawImage(img, 0, 0, size.width, size.height);
    if (knockOut) {
      const data = ctx.getImageData(0, 0, size.width, size.height);
      knockOutWhite(data.data);
      ctx.putImageData(data, 0, 0);
    }
    onInkChange(true);
  }, [canvasRef, knockOut, onInkChange]);

  useEffect(() => {
    render();
  }, [render]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    try {
      const img = await loadImageFile(file);
      imageRef.current = img;
      setFileName(file.name);
      // Scans and photos are usually JPEGs on white paper: default to knocking the background out.
      setKnockOut(/jpe?g$/i.test(file.type) || /\.jpe?g$/i.test(file.name));
      render();
    } catch (err) {
      imageRef.current = null;
      setFileName(null);
      setError((err as Error).message);
      render();
    }
  };

  return (
    <div className="sig-pad">
      <label className="sig-upload-label btn">
        <input
          type="file"
          accept="image/png,image/jpeg"
          data-testid="sig-upload-input"
          aria-label="Choose a PNG or JPEG image of your signature"
          onChange={(e) => void onFile(e)}
        />
        Choose image…
      </label>
      <span className="sig-upload-name" data-testid="sig-upload-name">
        {fileName ?? 'PNG or JPEG, ideally on a white or transparent background'}
      </span>
      {error && (
        <p className="sig-error" role="alert" data-testid="sig-upload-error">
          {error}
        </p>
      )}
      <div className="sig-canvas-wrap sig-upload-wrap">
        <canvas
          ref={canvasRef}
          className={`sig-canvas sig-upload-canvas${fileName ? '' : ' hidden'}`}
          data-testid="sig-upload-canvas"
          role="img"
          aria-label="Uploaded signature preview"
        />
        {!fileName && (
          <span className="sig-placeholder" aria-hidden="true">
            Preview
          </span>
        )}
      </div>
      <div className="sig-controls">
        <label className="sig-check">
          <input
            type="checkbox"
            data-testid="sig-upload-transparent"
            checked={knockOut}
            disabled={!fileName}
            onChange={(e) => setKnockOut(e.target.checked)}
          />
          Make white background transparent
        </label>
      </div>
    </div>
  );
}
