import type {
  DividerElement,
  ImageElement,
  ShapeElement,
  TextElement,
} from "@formcraft/schema";

import { boxStyle, textStyle, verticalAlignStyle } from "../style-utils";

export function TextView({ element }: { element: TextElement }) {
  return (
    <div
      style={{
        ...boxStyle(element.style),
        ...verticalAlignStyle(element.style),
        ...textStyle(element.style),
        width: "100%",
        height: "100%",
        // Text that outgrows its box is clipped rather than reflowing the
        // page: the document's geometry is authoritative.
        overflow: "hidden",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {element.content}
    </div>
  );
}

export function ImageView({
  element,
  src,
}: {
  element: ImageElement;
  /** Resolved from `objectKey`; null until Slice 3 wires object storage. */
  src?: string | null;
}) {
  const style = boxStyle(element.style);

  if (element.objectKey === null || !src) {
    return (
      <div
        style={{
          ...style,
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: element.style.fill ?? "#f1f5f9",
          color: "#94a3b8",
          fontSize: 11,
          textAlign: "center",
        }}
      >
        {element.alt || "Image"}
      </div>
    );
  }

  return (
    // next/image is deliberately not used: the same markup must render inside
    // headless Chromium at Slice 5, where Next's image optimizer is not in the
    // loop, and a mismatch there is a PDF that doesn't match the design.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={element.alt}
      style={{
        ...style,
        width: "100%",
        height: "100%",
        objectFit: element.fit,
      }}
    />
  );
}

export function ShapeView({ element }: { element: ShapeElement }) {
  const { style, shape, w, h } = element;
  const stroke = style.stroke ?? "#0f172a";
  const strokeWidth = style.strokeWidth || 1;

  if (shape === "rect" || shape === "ellipse") {
    return (
      <div
        style={{
          ...boxStyle(style),
          width: "100%",
          height: "100%",
          borderRadius: shape === "ellipse" ? "50%" : style.radius || undefined,
        }}
      />
    );
  }

  // Lines and arrows are drawn as SVG rather than borders: a border cannot
  // carry an arrowhead, and SVG scales with the page transform identically.
  const markerId = `arrowhead-${element.id}`;
  const midY = h / 2;

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ overflow: "visible" }}
    >
      {shape === "arrow" && (
        <defs>
          <marker
            id={markerId}
            markerWidth={6}
            markerHeight={6}
            refX={5}
            refY={3}
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L6,3 L0,6 z" fill={stroke} />
          </marker>
        </defs>
      )}
      <line
        x1={0}
        y1={midY}
        x2={shape === "arrow" ? w - strokeWidth * 5 : w}
        y2={midY}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        markerEnd={shape === "arrow" ? `url(#${markerId})` : undefined}
      />
    </svg>
  );
}

export function DividerView({ element }: { element: DividerElement }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: "100%",
          height: element.thickness,
          backgroundColor: element.color,
        }}
      />
    </div>
  );
}
