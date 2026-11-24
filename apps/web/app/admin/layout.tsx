import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'Aprovação de chamados', robots: { index: false } };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
