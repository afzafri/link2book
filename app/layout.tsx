import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Link2Book",
  description: "Turn web links into clean, portable EPUB books.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "sans-serif", padding: "2rem", maxWidth: "800px", margin: "0 auto" }}>
        {children}
      </body>
    </html>
  );
}
