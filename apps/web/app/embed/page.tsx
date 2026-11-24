import type { Metadata } from 'next';
import { Chat } from '../chat';

// A versão do chat que o widget abre dentro do iframe (public/widget.js).
export const metadata: Metadata = { robots: { index: false } };

export default function Embed() {
  return <Chat variant="embed" />;
}
