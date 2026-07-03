import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "facturá. — Facturación electrónica simple",
  description:
    "Facturación electrónica argentina para monotributistas y responsables inscriptos. ARCA + Mercado Pago + WhatsApp.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-AR" className={inter.variable}>
      <body className="min-h-screen bg-bg font-sans">{children}</body>
    </html>
  );
}
