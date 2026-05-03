import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { NavBar } from '@/components/ui/NavBar';
import { UploadWizard } from '@/components/upload/UploadWizard';

export default async function UploadPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar email={user.email} />
      <main className="flex-1">
        <UploadWizard />
      </main>
    </div>
  );
}
