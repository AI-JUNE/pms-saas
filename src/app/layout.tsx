import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'PMS — Project Management System', description: 'Modern multi-tenant project management.' };
export const viewport = { width: 'device-width', initialScale: 1, maximumScale: 5 };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="ko"><body>{children}</body></html>);
}
