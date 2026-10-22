import { AuthPanel } from '@/ui/AuthPanel';
import { SetPasswordForm } from '@/ui/SetPasswordForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Atur password' };
export default function SetPasswordPage() { return <main className="shell"><div className="auth"><div className="auth-form"><div className="auth-brand"><span className="sb-logo" aria-hidden="true">P</span>P2P Finance</div><SetPasswordForm /></div><AuthPanel /></div></main>; }
