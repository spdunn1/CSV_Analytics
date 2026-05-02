'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

interface NavBarProps {
  email?: string;
}

export function NavBar({ email }: NavBarProps) {
  const router = useRouter();
  const supabase = createClient();

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  return (
    <nav className="h-12 bg-gray-900 border-b border-gray-800 flex items-center px-4 gap-4 shrink-0">
      <Link href="/" className="text-sm font-bold text-gray-100 tracking-wide">
        DERConnect
      </Link>
      <span className="text-gray-700">|</span>
      <Link href="/" className="btn-ghost py-1 text-xs">Dashboard</Link>
      <Link href="/upload" className="btn-ghost py-1 text-xs">Upload</Link>
      <div className="flex-1" />
      {email && <span className="text-xs text-gray-500">{email}</span>}
      <button onClick={signOut} className="btn-ghost py-1 text-xs">Sign out</button>
    </nav>
  );
}
