import React from "react";

const CONF_MAP = {
  HIGH: {
    color: "#22c55e",
    width: "100%",
    description: "Analysis is well-supported by available data."
  },
  MEDIUM: {
    color: "#f59e0b",
    width: "66%",
    description: "Analysis is based on partial or heuristic data."
  },
  LOW: {
    color: "#ef4444",
    width: "33%",
    description: "Limited data available. Interpret results carefully."
  }
};

export default function ConfidenceIndicator({ confidence }) {
  const cfg = CONF_MAP[confidence] ?? CONF_MAP.MEDIUM;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: "0.9rem", marginBottom: 4 }}>
        <strong>Configuration confidence:</strong> {confidence}
      </div>

      <div
        style={{
          height: 8,
          background: "#e5e7eb",
          borderRadius: 4,
          overflow: "hidden"
        }}
      >
        <div
          style={{
            width: cfg.width,
            background: cfg.color,
            height: "100%"
          }}
        />
      </div>

      <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: 4 }}>
        {cfg.description}
      </div>
    </div>
  );
}