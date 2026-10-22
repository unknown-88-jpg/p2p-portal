import { AuthPanel } from '@/ui/AuthPanel';
import { LoginForm } from '@/ui/LoginForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Masuk' };
export default function LoginPage() { return <main className="shell"><div className="auth"><div className="auth-form"><div className="auth-brand"><span className="sb-logo" aria-hidden="true">P</span>P2P Finance</div><LoginForm /></div><AuthPanel /></div></main>; }
