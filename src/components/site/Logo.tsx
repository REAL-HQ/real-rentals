import { Link } from "@tanstack/react-router";

export function Logo({ width = 120, offset = true }: { width?: number; offset?: boolean }) {
  return (
    <Link
      to="/"
      aria-label="REAL RENTALS home"
      className={`${offset ? "relative top-[28px]" : ""} flex-shrink-0`}
      style={{
        display: "block",
        textDecoration: "none",
        background: "#E61919",
        padding: 6,
        width,
      }}
    >
      <div
        style={{
          border: "2px solid #fff",
          padding: "14px 14px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontFamily: "'Poppins',sans-serif",
            fontSize: "1.6rem",
            fontWeight: 900,
            color: "#fff",
            letterSpacing: ".05em",
            lineHeight: 1,
            textAlign: "center",
            display: "block",
          }}
        >
          REAL
        </span>
        <span
          style={{
            fontFamily: "'Poppins',sans-serif",
            fontSize: ".5rem",
            fontWeight: 700,
            letterSpacing: ".25em",
            color: "#fff",
            textTransform: "uppercase",
            textAlign: "center",
            display: "block",
            marginTop: 2,
          }}
        >
          RENTALS
        </span>
      </div>
    </Link>
  );
}