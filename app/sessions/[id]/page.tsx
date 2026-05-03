import { createClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import { NavBar } from '@/components/ui/NavBar';
import { SessionViewer } from '@/components/sessions/SessionViewer';

export const revalidate = 0;

export default async function SessionPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: session } = await supabase
    .from('sessions')
    .select('*, session_inverters(*, inverters(*))')
    .eq('id', params.id)
    .single();

  if (!session) notFound();

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <NavBar email={user.email} />
      <main className="flex-1">
        <SessionViewer session={session} />
      </main>
    </div>
  );
}
