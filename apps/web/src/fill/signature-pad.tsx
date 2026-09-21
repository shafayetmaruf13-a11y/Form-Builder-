"use client";

import { type Answer } from "@formcraft/schema";
import { useEffect, useRef, useState } from "react";

/**
 * Drawing a signature.
 *
 * The answer is a `image/png` data URL. Two alternatives were rejected:
 * uploading to object storage would make a signature the only answer that can
 * fail to save for network reasons *after* the form is otherwise complete, and
 * storing stroke coordinates would mean the PDF worker needed its own renderer
 * to turn them back into ink — a second drawing path, which is the kind of
 * thing architecture rule 2 exists to prevent. A data URL is one string that
 * both an `<img>` and headless Chromium render identically.
 *
 * The server caps its size, because a client can put anything in a string.
 */
export function SignaturePad({
  id,
  label,
  value,
  onChange,
  invalid,
  describedBy,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: Answer) => void;
  invalid: boolean;
  describedBy: string | undefined;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(value !== "");

  // Restores a signature drawn before a reload, from the saved draft.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || value === "") return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const image = new Image();
    image.onload = () => context.drawImage(image, 0, 0);
    image.src = value;
    // Only on mount: redrawing on every change would fight the live strokes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function positionOf(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const box = canvas.getBoundingClientRect();

    // The canvas is inside a scaled page, so its box is not its bitmap size.
    return {
      x: ((event.clientX - box.left) / box.width) * canvas.width,
      y: ((event.clientY - box.top) / box.height) * canvas.height,
    };
  }

  function context() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return null;

    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
    return ctx;
  }

  function commit() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange(canvas.toDataURL("image/png"));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
      <canvas
        ref={canvasRef}
        id={id}
        width={600}
        height={180}
        role="img"
        // No `aria-invalid`: it is not supported on `img`, and an invalid
        // signature is announced by the error text this points at instead.
        aria-label={`Signature for ${label}`}
        aria-describedby={describedBy}
        style={{
          width: "100%",
          flex: 1,
          minHeight: 0,
          border: invalid ? "2px solid #b91c1c" : "1px solid #cbd5e1",
          borderRadius: 6,
          backgroundColor: "#ffffff",
          touchAction: "none",
          cursor: disabled ? "default" : "crosshair",
        }}
        onPointerDown={(event) => {
          if (disabled) return;
          const ctx = context();
          if (!ctx) return;

          event.currentTarget.setPointerCapture(event.pointerId);
          drawing.current = true;

          const { x, y } = positionOf(event);
          ctx.beginPath();
          ctx.moveTo(x, y);
          // A tap with no movement should still leave a dot.
          ctx.lineTo(x, y);
          ctx.stroke();
          setHasInk(true);
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          const ctx = context();
          if (!ctx) return;

          const { x, y } = positionOf(event);
          ctx.lineTo(x, y);
          ctx.stroke();
        }}
        onPointerUp={() => {
          if (!drawing.current) return;
          drawing.current = false;
          // Written once per stroke, not per pointer event — the same reason
          // the builder writes the document on pointer-up.
          commit();
        }}
        onPointerLeave={() => {
          if (!drawing.current) return;
          drawing.current = false;
          commit();
        }}
      />

      <button
        type="button"
        disabled={disabled || !hasInk}
        style={{
          alignSelf: "flex-start",
          fontSize: 11,
          padding: "4px 10px",
          minHeight: 24,
          borderRadius: 4,
          border: "1px solid #cbd5e1",
          background: "#f8fafc",
          cursor: hasInk ? "pointer" : "default",
          color: hasInk ? "#0f172a" : "#94a3b8",
        }}
        onClick={() => {
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext("2d");
          if (!canvas || !ctx) return;

          ctx.clearRect(0, 0, canvas.width, canvas.height);
          setHasInk(false);
          onChange("");
        }}
      >
        Clear signature
      </button>
    </div>
  );
}
