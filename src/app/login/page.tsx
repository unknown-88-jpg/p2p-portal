import { AuthPanel } from '@/ui/AuthPanel';
import { LoginForm } from '@/ui/LoginForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Masuk' };
export default function LoginPage() { return <main className="shell"><div className="auth"><div className="auth-form"><LoginForm /></div><AuthPanel /></div></main>; }
