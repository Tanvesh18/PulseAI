import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import './lock.css'
import './auth-refine.css'
import './google-button.css'
import './polish.css'
import { DirectorDashboard } from './DirectorDashboard'
import { Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react'

type Role = 'employee' | 'manager' | 'hr' | 'director'
type User = { name: string; email: string; role: Role; avatarUrl?: string | null }

declare global {
  interface Window {
    google?: { accounts: { id: {
      initialize: (config: { client_id: string; callback: (response: { credential: string }) => void }) => void
      renderButton: (element: HTMLElement, options: Record<string, string | number>) => void
    } } }
  }
}

async function api(path: string, body: object) {
  const response = await fetch(`/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || 'Unable to sign in. Please try again.')
  return data as { token: string; user: User }
}

function App() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState<User | null>(() => {
    try {
      const storedUser = localStorage.getItem('pulseai_user')
      return storedUser && localStorage.getItem('pulseai_token') ? JSON.parse(storedUser) as User : null
    } catch {
      localStorage.removeItem('pulseai_user')
      localStorage.removeItem('pulseai_token')
      return null
    }
  })
  const [googleReady, setGoogleReady] = useState(Boolean(window.google))
  const googleButton = useRef<HTMLDivElement>(null)
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

  const completeSignIn = (result: { token: string; user: User }) => {
    localStorage.setItem('pulseai_token', result.token)
    localStorage.setItem('pulseai_user', JSON.stringify(result.user))
    setUser(result.user)
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (window.google) { setGoogleReady(true); window.clearInterval(timer) }
    }, 150)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!googleClientId || !googleReady || !window.google || !googleButton.current) return
    googleButton.current.innerHTML = ''
    window.google.accounts.id.initialize({ client_id: googleClientId, callback: async ({ credential }) => {
      setMessage(''); setLoading(true)
      try { completeSignIn(await api('/auth/google', { credential, role: 'director' })) }
      catch (error) { setMessage(error instanceof Error ? error.message : 'Google sign-in failed.') }
      finally { setLoading(false) }
    } })
    window.google.accounts.id.renderButton(googleButton.current, { theme: 'outline', size: 'large', width: 330, text: 'signin_with' })
  }, [googleClientId, googleReady])

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setMessage(''); setLoading(true)
    try { completeSignIn(await api('/auth/login', { email, password, role: 'director' })) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to continue.') }
    finally { setLoading(false) }
  }

  if (user) return <DirectorDashboard user={{ ...user, role: 'director' }} onSignOut={() => { localStorage.removeItem('pulseai_token'); localStorage.removeItem('pulseai_user'); setUser(null); setPassword('') }} />

  return <main className="auth-page">
    <section className="brand-panel"><div className="brand"><span className="pulse-mark">P</span><span>pulse<span>AI</span></span></div>
      <div className="brand-copy"><h1>Workforce<br /><em>oversight.</em></h1><p className="brand-description">A controlled Director workspace for organization-wide time compliance, approvals, and exceptions.</p></div>
      <div className="workflow-note"><span className="note-line" /> Secure, role-aware access for every workflow.</div><div className="orb orb-one" /><div className="orb orb-two" />
    </section>
    <section className="form-panel"><div className="form-shell"><header><h2>Director sign in</h2><p>Use your approved administrator account to continue.</p></header>
      <div className="workspace-card"><span><ShieldCheck size={20} /></span><div><strong>Director workspace</strong><p>Organization oversight and compliance reporting</p></div><LockKeyhole size={16} /></div>
      <form onSubmit={submit}><label>Work email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@emerson.com" autoComplete="email" required /></label>
        <label>Password<span className="password-field"><input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" autoComplete="current-password" minLength={8} required /><button type="button" className="show-password" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
        {message && <p className="form-message" role="alert">{message}</p>}<button className="primary-button" disabled={loading} type="submit">{loading ? 'Signing in…' : 'Sign in securely'}</button>
      </form><div className="divider"><span />or continue with<span /></div>
      {googleClientId ? (googleReady ? <div className="google-button" ref={googleButton} /> : <div className="google-unavailable">Loading Google sign-in…</div>) : <div className="google-unavailable">Google sign-in will appear after <code>VITE_GOOGLE_CLIENT_ID</code> is configured.</div>}
      <p className="admin-note">Director access is restricted to approved administrator accounts.</p>
    </div></section>
  </main>
}

export default App
