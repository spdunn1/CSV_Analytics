import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DERConnect — Inverter Test Analysis',
  description: 'EG4 FlexBOSS18 inverter load test data analysis platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
