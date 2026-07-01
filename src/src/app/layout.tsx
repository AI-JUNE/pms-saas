import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'PMS — Project Management System', description: 'Modern multi-tenant project management.' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="ko"><body>{children}</body></html>);
}
