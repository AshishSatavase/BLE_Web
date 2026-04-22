import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Firefighter Emergency Dashboard',
  description: 'Live BLE mesh emergency alerts',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
