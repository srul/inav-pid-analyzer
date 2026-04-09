import React from "react";

const CONF_MAP = {
  HIGH: {
    color: "#22c55e", // green
    width: "100%",
    label: "High confidence",
    description: "Analysis is well-supported by available data."
  },
  MEDIUM: {
    color: "#f59e0b", // amber
    width: "66%",
    label: "Medium confidence",
    description: "Analysis is based on partial or heuristic data."
  },
  LOW: {
    color: "#ef4444", // red
    width: "33%",
    label: "Low confidence",
    description: "Limited data available. Interpret results carefully."
  }
};

export default function ConfidenceIndicator({ confidence }) {
  const cfg = CONF_MAP[confidence] ?? CONF_MAP.MEDIUM;

  return (
    <div style={{ marginTop: "12px" }}>
      <div style={{ fontSize: "0.9rem", marginBottom: "4px" }}>
        <strong>Configuration confidence:</strong> {confidence}
      </div>

      <div
        style={{
          height: "8px",
          background: "#e5e7eb",
          borderRadius: "4px",
          overflow: "hidden"
        }}
      >
        <div
          style={{
            width: cfg.width,
            background: cfg.color,
            height: "100%",
            transition: "width 0.3s ease"
          }}
        />
      </div>

      <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "4px" }}>
        {cfg.description}
      </div>
    </div>
  );
}