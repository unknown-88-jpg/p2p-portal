import { AuthPanel } from '@/ui/AuthPanel';
import { SetPasswordForm } from '@/ui/SetPasswordForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Atur password' };
export default function SetPasswordPage() { return <main className="shell"><div className="auth"><div className="auth-form"><SetPasswordForm /></div><AuthPanel /></div></main>; }
