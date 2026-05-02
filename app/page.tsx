import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { NavBar } from '@/components/ui/NavBar';
import { SessionTable } from '@/components/sessions/SessionTable';

export const revalidate = 0;

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: sessions } = await supabase
    .from('sessions')
    .select('*, ingest_jobs(status, progress)')
    .order('created_at', { ascending: false })
    .limit(100);

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar email={user.email} />
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Test Sessions</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {sessions?.length ?? 0} session{sessions?.length !== 1 ? 's' : ''}
            </p>
          </div>
          <Link href="/upload" className="btn-primary">
            Upload new session
          </Link>
        </div>

        <SessionTable sessions={(sessions as Parameters<typeof SessionTable>[0]['sessions']) ?? []} />
      </main>
    </div>
  );
}
