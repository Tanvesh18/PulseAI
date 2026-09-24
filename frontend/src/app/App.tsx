import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './styles/App.css'
import './styles/lock.css'
import './styles/auth-refine.css'
import './styles/google-button.css'
import '../styles/polish.css'
import '../styles/responsive.css'
import '../styles/bolder.css'
import '../styles/operations-refine.css'
import logo from '../assets/logo.png'
import { apiUrl, requestJson } from '../api/client'
import { DirectorDashboard } from '../features/dashboards/director/DirectorDashboard'
import { EmployeeDashboard } from '../features/dashboards/employee/EmployeeDashboard'
import { ManagerDashboard } from '../features/dashboards/manager/ManagerDashboard'
import { FinanceDashboard } from '../features/dashboards/finance/FinanceDashboard'
import { HRDashboard } from '../features/dashboards/hr/HRDashboard'
import { Banknote, ClipboardCheck, Eye, EyeOff, LockKeyhole, ShieldCheck, UserCog, UserRound } from 'lucide-react'

type Role = 'employee' | 'manager' | 'hr' | 'director' | 'finance'
type User = { name: string; email: string; role: Role; avatarUrl?: string | null }
const Github = ({ size = 18 }: { size?: number }) => <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.18c-3.22.7-3.9-1.36-3.9-1.36-.53-1.34-1.3-1.7-1.3-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.57-.29-5.27-1.29-5.27-5.74 0-1.27.45-2.3 1.19-3.11-.12-.29-.52-1.47.11-3.07 0 0 .97-.31 3.17 1.19a10.94 10.94 0 0 1 5.77 0c2.2-1.5 3.17-1.19 3.17-1.19.63 1.6.23 2.78.11 3.07.74.81 1.19 1.84 1.19 3.11 0 4.46-2.71 5.45-5.29 5.74.42.36.78 1.07.78 2.16v3.2c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" /></svg>

declare global { interface Window { google?: { accounts: { id: { initialize: (config: { client_id: string; callback: (response: { credential: string }) => void }) => void; renderButton: (element: HTMLElement, options: Record<string, string | number>) => void } } } } }

async function api(path: string, body: object) {
  return requestJson<{ token: string; user: User }>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), fallbackMessage: 'Unable to sign in. Check your details and try again.' })
}

const meta = {
  employee: { name: 'Employee', workspace: 'Employee workspace', description: 'Personal timesheets, status, and corrections', title: <>My work.<br /><em>In one place.</em></>, brand: 'A focused workspace for completing, submitting, and tracking your own timesheet.' },
  manager: { name: 'Manager', workspace: 'Manager workspace', description: 'Team approvals and returned-entry reasons', title: <>Team review.<br /><em>Under control.</em></>, brand: 'A controlled review queue for decisions on your team timesheets.' },
  hr: { name: 'HR', workspace: 'HR workspace', description: 'Workforce records, reporting lines, and leave calendar', title: <>Workforce records.<br /><em>In sync.</em></>, brand: 'Maintain the shared employee roster and work calendar used across PulseAI.' },
  finance: { name: 'Finance', workspace: 'Finance workspace', description: 'Approved work, billing configuration, and invoices', title: <>Approved work.<br /><em>Ready to bill.</em></>, brand: 'Prepare accurate client billing from Manager-approved work.' },
  director: { name: 'Director', workspace: 'Director workspace', description: 'Organization oversight and compliance reporting', title: <>Workforce<br /><em>oversight.</em></>, brand: 'A controlled Director workspace for organization-wide time compliance, approvals, and exceptions.' },
} satisfies Record<Role, { name: string; workspace: string; description: string; title: React.ReactNode; brand: string }>

const roles = [['employee', 'Employee', 'My timesheet and history', UserRound], ['director', 'Director', 'Approvals and oversight', ShieldCheck], ['manager', 'Manager', 'Team timesheet review', ClipboardCheck], ['finance', 'Finance', 'Billing and invoices', Banknote], ['hr', 'HR', 'Workforce and leave records', UserCog]] as const

function App() {
  const [role, setRole] = useState<Role>('director')
  const [registering, setRegistering] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState<User | null>(() => {
    try { const saved = localStorage.getItem('pulseai_user'); return saved && localStorage.getItem('pulseai_token') ? JSON.parse(saved) as User : null }
    catch { localStorage.removeItem('pulseai_user'); localStorage.removeItem('pulseai_token'); return null }
  })
  const [googleReady, setGoogleReady] = useState(Boolean(window.google))
  const googleButton = useRef<HTMLDivElement>(null)
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
  const completeSignIn = (result: { token: string; user: User }) => { localStorage.setItem('pulseai_token', result.token); localStorage.setItem('pulseai_user', JSON.stringify(result.user)); setUser(result.user) }
  const signOut = () => { localStorage.removeItem('pulseai_token'); localStorage.removeItem('pulseai_user'); setUser(null); setPassword('') }

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1)); const token = params.get('oauth_token'); const oauthUser = params.get('oauth_user'); const oauthError = params.get('oauth_error')
    if (!token && !oauthError) return
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    if (oauthError) { setMessage(oauthError); return }
    try { const nextUser = JSON.parse(oauthUser || '') as User; if (!nextUser?.email || !nextUser?.role) throw new Error(); localStorage.setItem('pulseai_token', token!); localStorage.setItem('pulseai_user', JSON.stringify(nextUser)); setUser(nextUser) } catch { setMessage('GitHub sign-in could not be completed. Please try again.') }
  }, [])
  useEffect(() => { const timer = window.setInterval(() => { if (window.google) { setGoogleReady(true); window.clearInterval(timer) } }, 150); return () => window.clearInterval(timer) }, [])
  useEffect(() => { if (!googleClientId || !googleReady || !window.google || !googleButton.current) return; googleButton.current.innerHTML = ''; window.google.accounts.id.initialize({ client_id: googleClientId, callback: async ({ credential }) => { setLoading(true); try { completeSignIn(await api('/auth/google', { credential, role })) } catch (error) { setMessage(error instanceof Error ? error.message : 'Google sign-in failed.') } finally { setLoading(false) } } }); window.google.accounts.id.renderButton(googleButton.current, { theme: 'outline', size: 'large', width: 320, text: 'signin_with' }) }, [role, googleClientId, googleReady])
  const chooseRole = (next: Role) => { setRole(next); setRegistering(false); setMessage('') }
  const submit = async (event: FormEvent) => { event.preventDefault(); setMessage(''); setLoading(true); try { completeSignIn(registering ? await api('/auth/register', { name, email, password, role: 'employee' }) : await api('/auth/login', { email, password, role })) } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to continue.') } finally { setLoading(false) } }
  if (user?.role === 'director') return <DirectorDashboard user={{ ...user, role: 'director' }} onSignOut={signOut} />
  if (user?.role === 'employee') return <EmployeeDashboard user={{ ...user, role: 'employee' }} onSignOut={signOut} />
  if (user?.role === 'manager') return <ManagerDashboard user={{ ...user, role: 'manager' }} onSignOut={signOut} />
  if (user?.role === 'hr') return <HRDashboard user={{ ...user, role: 'hr' }} onSignOut={signOut} />
  if (user?.role === 'finance') return <FinanceDashboard user={{ ...user, role: 'finance' }} onSignOut={signOut} />
  const active = meta[role]; const RoleIcon = role === 'employee' ? UserRound : role === 'manager' ? ClipboardCheck : role === 'hr' ? UserCog : role === 'finance' ? Banknote : ShieldCheck
  return <main className="auth-page"><section className="brand-panel"><div className="brand"><img className="pulse-mark" src={logo} alt="" /><span>pulse<span>AI</span></span></div><div className="brand-copy"><h1>{active.title}</h1><p className="brand-description">{active.brand}</p></div><div className="workflow-note"><span className="note-line" /> Secure, role-aware access for every workflow.</div></section><section className="form-panel"><div className="form-shell"><header><h2>{registering ? 'Create employee account' : `${active.name} sign in`}</h2><p>{registering ? 'Use the same active work email held in the employee roster.' : `Use your work account to access the ${active.workspace.toLowerCase()}.`}</p></header><div className="role-grid" aria-label="Choose workspace role">{roles.map(([id, label, hint, Icon]) => <button type="button" key={id} aria-pressed={role === id} className={`role-card ${role === id ? 'selected' : ''}`} onClick={() => chooseRole(id)}><span className="role-icon"><Icon size={17} /></span><span><strong>{label}</strong><small>{hint}</small></span></button>)}</div><div className="workspace-card"><span><RoleIcon size={20} /></span><div><strong>{active.workspace}</strong><p>{active.description}</p></div><LockKeyhole size={16} /></div><form onSubmit={submit}>{registering && <label>Full name<input value={name} onChange={event => setName(event.target.value)} placeholder="Your name" autoComplete="name" required /></label>}<label>Work email<input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@emerson.com" autoComplete="email" required /></label><label>Password<span className="password-field"><input type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your password" autoComplete={registering ? 'new-password' : 'current-password'} minLength={8} required /><button type="button" className="show-password" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>{message && <p className="form-message" role="alert">{message}</p>}<button className="primary-button" disabled={loading} type="submit">{loading ? 'Please wait...' : registering ? 'Create employee account' : 'Sign in securely'}</button></form>{role === 'employee' && <p className="switch-mode">{registering ? 'Already have an account? ' : 'First time here? '}<button type="button" onClick={() => { setRegistering(!registering); setMessage('') }}>{registering ? 'Sign in' : 'Create your account'}</button></p>}<div className="divider"><span />or continue with<span /></div>{googleClientId ? (googleReady ? <div className="google-button" ref={googleButton} /> : <div className="google-unavailable">Loading Google sign-in...</div>) : <div className="google-unavailable">Google sign-in is currently unavailable. Use your approved work email and password to continue.</div>}<button type="button" className="github-button" disabled={loading} onClick={() => window.location.assign(apiUrl(`/auth/github?role=${encodeURIComponent(role)}`))}><Github size={18} /> Continue with GitHub</button><p className="admin-note">{role === 'employee' ? 'Employee accounts require an active work-email record.' : role === 'manager' ? 'Manager access requires an account and assigned employee records.' : role === 'hr' ? 'HR accounts are provisioned by an administrator.' : role === 'finance' ? 'Finance accounts are provisioned by an administrator.' : 'Director access is restricted to approved administrator accounts.'}</p></div></section></main>
}

export default App

