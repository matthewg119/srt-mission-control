"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ background: "#0B1426", color: "#fff", fontFamily: "monospace", padding: "2rem" }}>
        <h1 style={{ color: "#ef4444" }}>Application Error</h1>
        <pre style={{ whiteSpace: "pre-wrap", background: "#1a1a2e", padding: "1rem", borderRadius: "8px", fontSize: "14px" }}>
          {error.message}
        </pre>
        {error.stack && (
          <details style={{ marginTop: "1rem" }}>
            <summary style={{ cursor: "pointer", color: "#888" }}>Stack trace</summary>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: "12px", color: "#888", marginTop: "0.5rem" }}>
              {error.stack}
            </pre>
          </details>
        )}
        {error.digest && <p style={{ color: "#888", fontSize: "12px" }}>Digest: {error.digest}</p>}
        <button
          onClick={reset}
          style={{ marginTop: "1rem", padding: "8px 16px", background: "#00C9A7", color: "#000", border: "none", borderRadius: "6px", cursor: "pointer" }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
