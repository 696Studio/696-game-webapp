import React from "react";

export default function DeadPlaceholder() {
  return (
    <div
      className="dead-placeholder"
      style={{
        width: "100%",
        height: "100%",
        background: "linear-gradient(180deg, #2a2a2a, #0f0f0f)",
        borderRadius: "12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        position: "relative",
      }}
    >
      <svg
        width="72"
        height="72"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ opacity: 0.85 }}
      >
        <path
          d="M12 2C7.58 2 4 5.58 4 10v3c0 1.1.9 2 2 2h1v3c0 1.1.9 2 2 2h1v2h4v-2h1c1.1 0 2-.9 2-2v-3h1c1.1 0 2-.9 2-2v-3c0-4.42-3.58-8-8-8z"
          fill="#bdbdbd"
        />
        <circle cx="9" cy="11" r="1.5" fill="#1a1a1a" />
        <circle cx="15" cy="11" r="1.5" fill="#1a1a1a" />
        <rect x="11" y="14" width="2" height="3" rx="1" fill="#1a1a1a" />
      </svg>
    </div>
  );
}
