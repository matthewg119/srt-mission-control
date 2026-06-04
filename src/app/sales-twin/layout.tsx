// Fullscreen kiosk layout — removes all Mission Control chrome.
// 100vh, no sidebar, no header, overflow hidden.
export default function SalesTwinLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#0A0606",
        overflow: "hidden",
        fontFamily: "'Barlow', sans-serif",
      }}
    >
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.44.0/tabler-icons.min.css"
      />
      <link
        href="https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400&family=Bebas+Neue&family=Barlow:wght@300;400;500;600;700;800&display=swap"
        rel="stylesheet"
      />
      {children}
    </div>
  );
}
