import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  getGetDashboardSummaryQueryKey, getGetWalletQueryKey, getHealthCheckQueryKey, getListBotInstancesQueryKey,
  getListBotTemplatesQueryKey, getVerifyWalletTopupQueryKey, useHealthCheck, useCreateBotInstance,
  useCreateWalletTopup, useGetDashboardSummary, useGetWallet, useListBotInstances,
  useListBotTemplates, useRenewBotInstance, useRestartBotInstance, useStopBotInstance,
  useVerifyWalletTopup,
} from '@workspace/api-client-react';
import type { BotInstance, BotTemplate, WalletEntry } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, BadgeCheck, Bot,
  Check, ChevronDown, CircleHelp, Clock3, Command, ExternalLink,
  Gauge, Layers3, LoaderCircle, LogOut, Menu, MessageCircle, MoreHorizontal,
  Plus, RefreshCw, Rocket, ShieldCheck, WalletCards, X, Zap,
} from 'lucide-react';
import { Link, Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
function stripBase(path: string) { return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path; }

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#20c98a', colorForeground: '#edece6', colorMutedForeground: '#a0aaa7',
    colorDanger: '#ef7772', colorBackground: '#171e22', colorInput: '#101619',
    colorInputForeground: '#edece6', colorNeutral: '#344148', fontFamily: 'Manrope',
    borderRadius: '0.8rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#171e22] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[#344148]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#edece6] font-bold', headerSubtitle: 'text-[#a0aaa7]',
    socialButtonsBlockButtonText: 'text-[#edece6] font-semibold', formFieldLabel: 'text-[#edece6] font-semibold',
    footerActionLink: 'text-[#20c98a] font-bold', footerActionText: 'text-[#a0aaa7]',
    dividerText: 'text-[#a0aaa7]', identityPreviewEditButton: 'text-[#20c98a]',
    formFieldSuccessText: 'text-[#20c98a]', alertText: 'text-[#edece6]',
    logoBox: 'mb-5', logoImage: 'rounded-lg', socialButtonsBlockButton: 'border border-[#344148] bg-[#101619]',
    formButtonPrimary: 'bg-[#20c98a] text-[#07130f] font-extrabold', formFieldInput: 'bg-[#101619] border-[#344148] text-[#edece6]',
    footerAction: 'border-0', dividerLine: 'bg-[#344148]', alert: 'border-[#344148] bg-[#101619]',
    otpCodeFieldInput: 'bg-[#101619] border-[#344148] text-[#edece6]', formFieldRow: 'gap-2', main: 'gap-5',
  },
};

const money = (n?: number | null) => `KSh ${Number(n || 0).toLocaleString('en-KE')}`;
const date = (value?: string | null) => value ? new Date(value).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const shortDate = (value?: string | null) => value ? new Date(value).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }) : '—';
const statusTone: Record<string, string> = { running: 'green', deploying: 'amber', queued: 'amber', stopped: 'muted', past_due: 'red', failed: 'red', successful: 'green', completed: 'green', pending: 'amber' };

function Brand({ compact = false }: { compact?: boolean }) {
  return <Link href="/" className="brand" aria-label="BotCloud home"><span className="brand-mark"><MessageCircle size={18} strokeWidth={2.5}/><i/></span>{!compact && <span>bot<span>cloud</span><small>KENYA</small></span>}</Link>;
}
function Button({ children, variant = 'primary', className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'outline' | 'quiet' | 'danger' }) {
  return <button className={`btn btn-${variant} ${className}`} {...props}>{children}</button>;
}
function Status({ value }: { value?: string | null }) { const key = value || 'unknown'; return <span className={`status ${statusTone[key] || 'muted'}`}><i/>{key.replace('_', ' ')}</span>; }
function SystemStatus({ compact = false }: { compact?: boolean }) {
  const health = useHealthCheck({ query: { refetchInterval: 60000, queryKey: getHealthCheckQueryKey() } });
  const healthy = health.data?.status === 'ok' || health.data?.status === 'healthy';
  return <span className={`system-indicator ${health.isLoading ? 'checking' : health.error || !healthy ? 'degraded' : ''}`}><i/>{health.isLoading ? 'CHECKING SYSTEMS' : health.error || !healthy ? 'SYSTEM STATUS UNKNOWN' : compact ? 'ALL SYSTEMS NORMAL' : 'Nairobi region operational'}</span>;
}
function Skeleton({ className = '' }: { className?: string }) { return <div className={`skeleton ${className}`}/>; }
function QueryState({ loading, error, retry, children }: { loading: boolean; error: boolean; retry: () => void; children: ReactNode }) {
  if (loading) return <div className="state-grid"><Skeleton/><Skeleton/><Skeleton/></div>;
  if (error) return <div className="empty-state"><CircleHelp/><h3>Connection interrupted</h3><p>Your control room couldn't load this view.</p><Button variant="outline" onClick={retry}>Try again <RefreshCw size={15}/></Button></div>;
  return <>{children}</>;
}

function PublicHome() {
  const [location] = useLocation();
  return <main className="public-page noise-overlay">
    <header className="public-nav"><Brand/><div className="nav-status"><SystemStatus/></div><div className="public-actions"><Link href="/sign-in" className="nav-signin">Sign in</Link><Link href="/sign-up" className="btn btn-primary">Start building <ArrowRight size={16}/></Link></div></header>
    <section className="hero">
      <div className="hero-grid"/>
      <div className="hero-copy animate-rise">
        <div className="eyebrow"><span className="eyebrow-line"/> THE BOT INFRASTRUCTURE LAYER <span className="eyebrow-chip">KE · 01</span></div>
        <h1>Your bot.<br/><em>Always on.</em></h1>
        <p className="hero-sub">Run your WhatsApp business on infrastructure built for creators in Kenya. Deploy in minutes. Keep every conversation moving.</p>
        <div className="hero-ctas"><Link href="/sign-up" className="btn btn-primary btn-large">Launch your first bot <ArrowRight size={17}/></Link><a href="#how-it-works" className="text-link">See how it works <ArrowDownLeft size={15}/></a></div>
        <div className="hero-proof"><div className="avatar-stack"><i>W</i><i>M</i><i>A</i><i>+</i></div><span>Built for the people building<br/><b>what's next in Kenya.</b></span></div>
      </div>
      <div className="hero-visual animate-rise delay-1" aria-label="BotCloud operations console preview">
        <div className="visual-orbit orbit-one"/><div className="visual-orbit orbit-two"/>
        <div className="console-window">
          <div className="console-top"><div className="window-dots"><i/><i/><i/></div><span>BOTCLOUD / LIVE SYSTEMS</span><span className="live-tag"><i/> LIVE</span></div>
          <div className="console-content">
            <div className="console-greet"><div><small>WEDNESDAY, 14 MAY</small><h3>Good morning, creator.</h3></div><div className="console-avatar">JM</div></div>
            <div className="console-metrics"><div><small>ACTIVE BOTS</small><strong>04</strong><span className="metric-up">+1 this month</span></div><div><small>WALLET BALANCE</small><strong>2,450<span> KSh</span></strong><span>3 months of hosting</span></div></div>
            <div className="console-bot"><div className="bot-icon bot-icon-green"><MessageCircle size={17}/></div><div className="bot-meta"><strong>Jirani Shop Assistant</strong><small>+254 712 ••• ••82</small></div><Status value="running"/></div>
            <div className="console-bot"><div className="bot-icon bot-icon-coral"><Zap size={17}/></div><div className="bot-meta"><strong>OrderFlow Pro</strong><small>Initializing instance…</small></div><Status value="deploying"/></div>
            <div className="console-chart"><div className="chart-head"><span>MESSAGE ACTIVITY</span><small>LAST 7 DAYS</small></div><svg viewBox="0 0 440 72" preserveAspectRatio="none"><defs><linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#20c98a" stopOpacity=".3"/><stop offset="1" stopColor="#20c98a" stopOpacity="0"/></linearGradient></defs><path d="M0 57 C24 54 24 38 48 43 S82 61 107 38 136 46 163 28 195 44 220 34 252 15 278 25 310 46 334 22 366 42 392 16 425 17 440 7 L440 72 L0 72Z" fill="url(#area)"/><path d="M0 57 C24 54 24 38 48 43 S82 61 107 38 136 46 163 28 195 44 220 34 252 15 278 25 310 46 334 22 366 42 392 16 425 17 440 7" fill="none" stroke="#20c98a" strokeWidth="2"/></svg><div className="chart-axis"><span>08 MAY</span><span>10 MAY</span><span>12 MAY</span><span>14 MAY</span></div></div>
          </div>
          <div className="console-bottom"><ShieldCheck size={14}/> YOUR BOT INFRASTRUCTURE, HANDLED.</div>
        </div>
        <div className="float-chip chip-one"><span className="chip-icon"><Check size={14}/></span><span><b>Deployment ready</b><small>just now · Nairobi region</small></span></div>
        <div className="float-chip chip-two"><span className="chip-signal"><i/><i/><i/><i/></span><span><b>99.98% uptime</b><small>this month</small></span></div>
        <div className="visual-caption">CONTROL ROOM PREVIEW <span>01 — 04</span></div>
      </div>
      <div className="hero-foot"><span>HOSTED IN EAST AFRICA</span><span>PAY AS YOU GO</span><span>BUILT FOR WHATSAPP</span><span>SECURE BY DEFAULT</span></div>
    </section>
    <section className="proof-strip"><div><b>01 / YOUR BOT, ONLINE</b><span>Not another server to maintain</span></div><div><b>02 / YOUR WALLET, IN CONTROL</b><span>Top up in KSh with Paystack</span></div><div><b>03 / YOUR TIME, BACK</b><span>We handle the infrastructure</span></div></section>
    <section className="story-section" id="how-it-works">
      <div className="section-kicker">THE SETUP, WITHOUT THE SETUP</div><div className="story-grid"><h2>From idea to<br/><em>always-on.</em></h2><div className="story-text"><p>Good bots shouldn't need a DevOps team. Pick the tool you need, give it a name, and BotCloud takes care of the rest — from deployment to renewals.</p><Link href="/sign-up" className="text-link">Make your move <ArrowRight size={15}/></Link></div></div>
      <div className="steps-row"><div className="step-card"><small>STEP 01 / CHOOSE</small><div className="step-icon"><Layers3/></div><h3>Find your bot</h3><p>Choose from a growing collection of WhatsApp tools made for real businesses.</p></div><div className="step-connector"/></div><div className="steps-row steps-row-lower"><div className="step-card"><small>STEP 02 / FUND</small><div className="step-icon"><WalletCards/></div><h3>Top up in KSh</h3><p>Pay securely with Paystack. Your wallet covers bot hosting and renewals.</p></div><div className="step-connector"/></div><div className="steps-row"><div className="step-card"><small>STEP 03 / LAUNCH</small><div className="step-icon"><Rocket/></div><h3>Get back to work</h3><p>Your bot deploys in the background. We keep it running while you build.</p></div></div>
    </section>
    <section className="manifesto"><div className="manifesto-mark"><Command size={18}/><span>BC / SYSTEMS ONLINE</span></div><h2>The next great<br/>Kenyan business<br/><em>runs on WhatsApp.</em></h2><p>We're here to make sure its bot never clocks out.</p><Link href="/sign-up" className="btn btn-primary btn-large">Build what's next <ArrowRight size={17}/></Link><div className="manifesto-index">NBO · 01°17′S 36°49′E</div></section>
    <footer className="public-footer"><Brand/><span>MADE FOR KENYA. BUILT TO SCALE.</span><small>© {new Date().getFullYear()} BOTCLOUD SYSTEMS</small></footer>
  </main>;
}

function SignInPage() { return <div className="auth-page"><div className="auth-backdrop"/><div className="auth-brand"><Brand/><p>THE BOT INFRASTRUCTURE LAYER</p></div><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}/></div>; }
function SignUpPage() { return <div className="auth-page"><div className="auth-backdrop"/><div className="auth-brand"><Brand/><p>YOUR NEXT BOT STARTS HERE</p></div><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`}/></div>; }

function AppShell({ children, title, kicker }: { children: ReactNode; title: string; kicker: string }) {
  const [location, setLocation] = useLocation(); const { user } = useUser(); const { signOut } = useClerk(); const [mobileNav, setMobileNav] = useState(false);
  const links = [{ href: '/dashboard', label: 'Overview', icon: Gauge }, { href: '/bots', label: 'Bot catalog', icon: Layers3 }, { href: '/instances', label: 'My deployments', icon: Bot }, { href: '/wallet', label: 'Wallet & billing', icon: WalletCards }];
  const displayName = user?.firstName || 'Creator';
  return <div className="app-frame">
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}><div className="side-brand"><Brand/><button className="mobile-close" onClick={()=>setMobileNav(false)} aria-label="Close menu"><X size={19}/></button></div>
      <div className="workspace-label">WORKSPACE <span>KE / NBO</span></div><nav className="side-nav">{links.map(({ href,label,icon:Icon })=><Link key={href} href={href} onClick={()=>setMobileNav(false)} className={`side-link ${location===href?'active':''}`} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ','-')}`}><Icon size={17}/>{label}{href==='/instances'&&<span className="nav-count">›</span>}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="support-card"><div className="support-icon"><CircleHelp size={17}/></div><b>Need a hand?</b><p>We’re one message away.</p><a href="mailto:support@botcloud.co.ke">Talk to support <ArrowRight size={13}/></a></div><div className="profile-card"><div className="profile-avatar">{(displayName[0]||'C').toUpperCase()}</div><div className="profile-info"><b>{displayName}</b><small>BotCloud creator</small></div><button className="icon-button" aria-label="Sign out" onClick={()=>signOut({redirectUrl:basePath||'/'})}><LogOut size={16}/></button></div></div>
    </aside>
    {mobileNav&&<button className="mobile-scrim" onClick={()=>setMobileNav(false)} aria-label="Close navigation"/>}
    <div className="main-column"><header className="topbar"><button className="mobile-menu" onClick={()=>setMobileNav(true)} aria-label="Open menu"><Menu size={20}/></button><div className="breadcrumb"><span>BOTCLOUD</span><i>/</i><b>{title}</b></div><div className="topbar-actions"><div className="region-status"><SystemStatus compact/></div><button className="top-wallet" onClick={()=>setLocation('/wallet')}><WalletCards size={15}/> Wallet <ChevronDown size={13}/></button><div className="top-avatar">{(displayName[0]||'C').toUpperCase()}</div></div></header>
      <main className="page-content"><div className="page-heading animate-rise"><div><div className="page-kicker">{kicker}</div><h1>{title}</h1></div>{title==='Overview'&&<Link href="/bots" className="btn btn-primary"><Plus size={16}/> Deploy a bot</Link>}</div>{children}</main>
      <footer className="app-footer"><span>BOTCLOUD / INFRASTRUCTURE FOR WHAT'S NEXT</span><span><ShieldCheck size={13}/> ENCRYPTED CONNECTION <i/> NAIROBI REGION</span></footer>
    </div>
  </div>;
}

function Protected({ children }: { children: ReactNode }) {
  return <><Show when="signed-in">{children}</Show><Show when="signed-out"><Redirect to="/"/></Show></>;
}
function HomeRedirect() { return <><Show when="signed-in"><Redirect to="/dashboard"/></Show><Show when="signed-out"><PublicHome/></Show></>; }
function PageBoundary({ children }: { children: ReactNode }) { const [location] = useLocation(); return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>; }

function OverviewPage() {
  const query = useGetDashboardSummary(); const summary = query.data;
  return <AppShell title="Overview" kicker="YOUR OPERATIONS AT A GLANCE"><QueryState loading={query.isLoading} error={!!query.error} retry={()=>query.refetch()}>
    {summary&&<><section className="overview-hero animate-rise delay-1"><div className="overview-copy"><div className="eyebrow-mini"><span className="live-dot"/> YOUR CONTROL ROOM IS READY</div><h2>Keep your business<br/>in <em>good company.</em></h2><p>Your bots are working around the clock. Here’s how your operation is looking.</p><Link href="/instances" className="text-link">View all deployments <ArrowRight size={14}/></Link></div><div className="hero-stat-orbit"><div className="orbit-ring"/><div className="orbit-center"><span>LIVE BOTS</span><strong>{String(summary.activeBotCount).padStart(2,'0')}</strong><small>running now</small></div><div className="orbit-node"><MessageCircle size={15}/></div><div className="orbit-node orbit-node-two"><Zap size={14}/></div></div><div className="hero-coordinate">NBO / 01°17′S<br/>SYSTEMS NOMINAL</div></section>
      <div className="stats-grid animate-rise delay-2"><StatCard icon={<WalletCards/>} label="WALLET BALANCE" value={money(summary.walletBalanceKsh)} detail={`${summary.botsFundable} months of hosting`} tone="green" action={<Link href="/wallet">Add funds <ArrowUpRight size={13}/></Link>}/><StatCard icon={<Bot/>} label="ACTIVE BOTS" value={String(summary.activeBotCount).padStart(2,'0')} detail={`${summary.deployingBotCount} deployments in progress`} tone="aqua" action={<Link href="/instances">Manage bots <ArrowUpRight size={13}/></Link>}/><StatCard icon={<Activity/>} label="MONTHLY SPEND" value={money(summary.monthlySpendKsh)} detail="Across all active deployments" tone="gold" action={<Link href="/wallet">View ledger <ArrowUpRight size={13}/></Link>}/></div>
      <section className="dashboard-lower"><div className="panel activity-panel"><PanelHeading label="THE LATEST" title="Recent activity" trailing={<Link href="/wallet" className="small-link">Full ledger <ArrowRight size={13}/></Link>}/>{summary.recentActivity.length?<div className="activity-list">{summary.recentActivity.map((item:any)=><div className="activity-row" key={item.id}><div className={`activity-icon ${item.kind}`}><Activity size={15}/></div><div className="activity-text"><b>{item.title}</b><span>{item.detail}</span></div><time>{shortDate(item.createdAt)}</time></div>)}</div>:<div className="compact-empty"><Activity/><span>Your activity will show up here.</span></div>}</div>
      <div className="panel readiness-panel"><PanelHeading label="CAPACITY" title="Room to grow"/><div className="readiness-ring"><div><strong>{summary.botsFundable}</strong><span>bots fundable</span></div></div><p>Your balance covers <b>{summary.botsFundable} full month{summary.botsFundable===1?'':'s'}</b> of hosting at current usage.</p><div className="capacity-bar"><i style={{width:`${Math.max(4,Math.min(100,summary.botsFundable*24))}%`}}/></div><div className="capacity-meta"><span>MONTHLY RATE</span><b>{money(summary.monthlySpendKsh || 0)}</b></div><Link href="/wallet" className="btn btn-outline btn-full">Top up wallet <ArrowRight size={14}/></Link></div></section>
      <div className="renewal-note"><Clock3 size={15}/><span>NEXT RENEWAL</span><b>{date(summary.nextRenewalAt)}</b><i/> <span>Plan ahead. Your bots keep running when your wallet is funded.</span><Link href="/wallet">View wallet <ArrowRight size={13}/></Link></div>
    </>}
  </QueryState></AppShell>;
}
function StatCard({ icon,label,value,detail,tone,action }: {icon:ReactNode;label:string;value:string;detail:string;tone:string;action:ReactNode}) { return <article className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><div className="stat-label">{label}</div><strong className="stat-value">{value}</strong><div className="stat-detail">{detail}</div><div className="stat-action">{action}</div></article>; }
function PanelHeading({label,title,trailing}:{label:string;title:string;trailing?:ReactNode}) { return <div className="panel-heading"><div><small>{label}</small><h3>{title}</h3></div>{trailing}</div>; }

function BotsPage() {
  const query=useListBotTemplates(); const wallet=useGetWallet(); const mutation=useCreateBotInstance(); const client=useQueryClient(); const [selected,setSelected]=useState<BotTemplate|null>(null); const [name,setName]=useState(''); const [session,setSession]=useState(''); const [repo,setRepo]=useState(''); const [notice,setNotice]=useState('');
  const deploy=(e:React.FormEvent)=>{e.preventDefault();if(!selected)return; mutation.mutate({data:{templateId:selected.id,name:name.trim(),sessionId:session.trim(),repositoryUrl:repo.trim()}},{onSuccess:()=>{client.invalidateQueries({queryKey:getListBotInstancesQueryKey()});client.invalidateQueries({queryKey:getGetDashboardSummaryQueryKey()});client.invalidateQueries({queryKey:getGetWalletQueryKey()});setSelected(null);setName('');setSession('');setRepo('');setNotice('Deployment queued. We’ll bring your bot online shortly.');},onError:()=>setNotice('We couldn’t start this deployment. Check your wallet and try again.')});};
  const categories=useMemo(()=>Array.from(new Set(query.data?.map(t=>t.category)||[])),[query.data]);
  return <AppShell title="Bot catalog" kicker="TOOLS FOR YOUR WHATSAPP"><QueryState loading={query.isLoading} error={!!query.error} retry={()=>query.refetch()}>{query.data&&<><div className="catalog-intro"><div><p>Useful bots, ready for real work.</p><span>Choose a tool and we'll take care of keeping it online.</span></div><div className="wallet-capacity"><WalletCards size={16}/><span>YOUR BALANCE</span><b>{money(wallet.data?.balanceKsh)}</b><Link href="/wallet">Top up <ArrowRight size={12}/></Link></div></div>{notice&&<div className="inline-notice"><BadgeCheck size={16}/>{notice}<button onClick={()=>setNotice('')} aria-label="Dismiss"><X size={14}/></button></div>}
      {query.data.length===0?<div className="empty-state"><Layers3/><h3>The catalog is getting ready</h3><p>Check back soon for bots you can launch.</p></div>:<>{categories.map((category)=>{const templates=query.data!.filter(t=>t.category===category);return <section className="catalog-section" key={category}><div className="category-heading"><span>{category}</span><i/>{String(templates.length).padStart(2,'0')} AVAILABLE</div><div className="template-grid">{templates.map((template,index)=><TemplateCard key={template.id} template={template} index={index} onDeploy={()=>{setSelected(template);setName(template.name);setNotice('')}}/>)}</div></section>;})}</>}
      </>}</QueryState>
      {selected&&<div className="modal-backdrop" role="presentation" onClick={()=>setSelected(null)}><div className="deploy-modal" role="dialog" aria-modal="true" aria-labelledby="deploy-title" onClick={e=>e.stopPropagation()}><div className="modal-top"><div className="bot-icon bot-icon-green"><MessageCircle size={18}/></div><button className="icon-button" onClick={()=>setSelected(null)} aria-label="Close"><X size={18}/></button></div><div className="page-kicker">NEW DEPLOYMENT / {selected.category}</div><h2 id="deploy-title">Set up {selected.name}</h2><p className="modal-description">Give this instance a name and enter the session details for your WhatsApp bot.</p><form onSubmit={deploy} className="deploy-form"><label>INSTANCE NAME<input required minLength={2} maxLength={50} value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Jirani support" data-testid="input-instance-name"/></label><label>WHATSAPP SESSION ID<input required value={session} onChange={e=>setSession(e.target.value)} placeholder="Paste your session ID" data-testid="input-session-id"/></label><label>REPOSITORY URL <span className="optional">OPTIONAL</span><input value={repo} onChange={e=>setRepo(e.target.value)} placeholder="https://github.com/…" data-testid="input-repository-url"/></label><div className="deploy-cost"><span>MONTHLY HOSTING</span><strong>{money(selected.monthlyPriceKsh)}</strong><small>Wallet balance: {money(wallet.data?.balanceKsh)}</small></div>{mutation.error&&<p className="form-error">Deployment failed. Check your wallet balance and try again.</p>}<Button type="submit" className="btn-full" disabled={mutation.isPending}>{mutation.isPending?<><LoaderCircle className="spin" size={16}/> Preparing deployment…</>:<><Rocket size={16}/> Launch bot</>}</Button></form></div></div>}
    </AppShell>;
}
function TemplateCard({template,index,onDeploy}:{template:BotTemplate;index:number;onDeploy:()=>void}) { return <article className={`template-card animate-rise delay-${(index%3)+1}`}><div className="template-top"><div className={`bot-icon ${index%3===1?'bot-icon-gold':index%3===2?'bot-icon-coral':'bot-icon-green'}`}><MessageCircle size={18}/></div><span className="template-category">{template.category}</span><button className="icon-button template-more" aria-label={`More about ${template.name}`} onClick={()=>window.alert(`${template.name}: ${template.description}`)}><MoreHorizontal size={18}/></button></div><h3>{template.name}</h3><p>{template.description}</p><ul>{template.features.map(feature=><li key={feature}><Check size={13}/>{feature}</li>)}</ul><div className="template-bottom"><div><small>MONTHLY HOSTING</small><strong>{money(template.monthlyPriceKsh)}<span> / mo</span></strong></div><Button onClick={onDeploy}>Deploy <ArrowRight size={14}/></Button></div></article>; }

function WalletPage() {
  const query=useGetWallet();const topup=useCreateWalletTopup();const [amount,setAmount]=useState('1000');const [showForm,setShowForm]=useState(false);const [error,setError]=useState('');const client=useQueryClient();
  const submit=(e:React.FormEvent)=>{e.preventDefault();const numeric=Number(amount);if(!Number.isFinite(numeric)||numeric<50||numeric>500000){setError('Enter an amount between KSh 50 and KSh 500,000.');return;}setError('');topup.mutate({data:{amountKsh:numeric}},{onSuccess:(session)=>{client.invalidateQueries({queryKey:getGetWalletQueryKey()});window.location.assign(session.authorizationUrl);},onError:()=>setError('Checkout could not be started. Please try again.')});};
  return <AppShell title="Wallet" kicker="PAYMENTS / YOUR LEDGER"><QueryState loading={query.isLoading} error={!!query.error} retry={()=>query.refetch()}>{query.data&&<><section className="wallet-hero"><div className="wallet-main"><div className="page-kicker">AVAILABLE BALANCE <span className="balance-live"><i/> LIVE</span></div><strong>{money(query.data.balanceKsh)}</strong><div className="wallet-foot">KES · Kenyan shillings <i/> Secure payments powered by Paystack</div></div><div className="wallet-side"><div className="wallet-symbol"><WalletCards size={21}/></div><span>HOSTING CAPACITY</span><b>{query.data.botsFundable} <small>months</small></b><p>at your current monthly rate</p><Button onClick={()=>setShowForm(true)}><Plus size={15}/> Add funds</Button></div><div className="wallet-grid-art"/></section><div className="wallet-stats"><div><small>MONTHLY HOSTING RATE</small><b>{money(query.data.monthlyPriceKsh)}</b></div><div><small>ACTIVE DEPLOYMENTS</small><b>{String(query.data.activeBotCount).padStart(2,'0')}</b></div><div><small>PAYMENT NETWORK</small><b className="paystack-label"><ShieldCheck size={16}/> Paystack secured</b></div></div>
      <section className="panel ledger-panel"><PanelHeading label="ACCOUNT ACTIVITY" title="Wallet ledger" trailing={<span className="ledger-count">{query.data.entries.length} ENTRIES</span>}/>{query.data.entries.length?<div className="ledger-table"><div className="ledger-head"><span>TRANSACTION</span><span>REFERENCE</span><span>DATE</span><span>STATUS</span><span className="align-right">AMOUNT</span></div>{query.data.entries.map(entry=><LedgerRow key={entry.id} entry={entry}/>)}</div>:<div className="empty-state ledger-empty"><div className="empty-illustration"><WalletCards/></div><h3>Your wallet starts here.</h3><p>Top up your balance to deploy bots and keep your business online.</p><Button onClick={()=>setShowForm(true)}><Plus size={15}/> Add funds</Button></div>}</section></>}</QueryState>
    {showForm&&<div className="modal-backdrop" role="presentation" onClick={()=>setShowForm(false)}><div className="deploy-modal topup-modal" role="dialog" aria-modal="true" aria-labelledby="topup-title" onClick={e=>e.stopPropagation()}><div className="modal-top"><div className="bot-icon bot-icon-green"><WalletCards size={18}/></div><button className="icon-button" onClick={()=>setShowForm(false)} aria-label="Close"><X size={18}/></button></div><div className="page-kicker">PAYSTACK / KENYA</div><h2 id="topup-title">Top up your wallet</h2><p className="modal-description">Add funds securely with M-Pesa, card or bank transfer.</p><form className="deploy-form" onSubmit={submit}><label>AMOUNT IN KENYAN SHILLINGS<input type="number" min="50" max="500000" step="50" value={amount} onChange={e=>setAmount(e.target.value)} data-testid="input-topup-amount"/></label><div className="amount-presets">{[500,1000,2500,5000].map(v=><button type="button" className={Number(amount)===v?'selected':''} key={v} onClick={()=>setAmount(String(v))}>{v.toLocaleString()}</button>)}</div><div className="secure-note"><ShieldCheck size={15}/> You'll complete payment on Paystack's secure checkout.</div>{error&&<p className="form-error">{error}</p>}<Button type="submit" className="btn-full" disabled={topup.isPending}>{topup.isPending?<><LoaderCircle className="spin" size={16}/> Connecting to Paystack…</>:<>Continue to payment <ExternalLink size={15}/></>}</Button></form></div></div>}
  </AppShell>;
}
function LedgerRow({entry}:{entry:WalletEntry}) { const credit=entry.kind==='credit'||entry.kind==='refund';return <div className="ledger-row"><div className="ledger-description"><span className={`ledger-direction ${credit?'credit':'debit'}`}>{credit?<ArrowDownLeft size={15}/>:<ArrowUpRight size={15}/>}</span><span><b>{entry.description}</b><small>{entry.kind}</small></span></div><code>{entry.reference||'—'}</code><span className="ledger-date">{date(entry.createdAt)}</span><Status value={entry.status}/><strong className={`ledger-amount ${credit?'positive':''}`}>{credit?'+':'−'}{money(entry.amountKsh)}</strong></div>; }

function InstancesPage() {
  const query=useListBotInstances();const client=useQueryClient();const restart=useRestartBotInstance();const stop=useStopBotInstance();const renew=useRenewBotInstance();const [feedback,setFeedback]=useState('');
  const refresh=()=>{client.invalidateQueries({queryKey:getListBotInstancesQueryKey()});client.invalidateQueries({queryKey:getGetDashboardSummaryQueryKey()});client.invalidateQueries({queryKey:getGetWalletQueryKey()});};
  const act=(type:'restart'|'stop'|'renew',instance:BotInstance)=>{const mutation=type==='restart'?restart:type==='stop'?stop:renew;mutation.mutate({instanceId:instance.id},{onSuccess:()=>{setFeedback(`${instance.name} ${type==='restart'?'restarted':type==='stop'?'stopped':'renewed'} successfully.`);refresh();},onError:()=>setFeedback(`Could not ${type} ${instance.name}. Please try again.`)});};
  const busy=restart.isPending||stop.isPending||renew.isPending;
  return <AppShell title="My deployments" kicker="YOUR BOTS / LIVE STATUS"><QueryState loading={query.isLoading} error={!!query.error} retry={()=>query.refetch()}>{query.data&&<><div className="instance-summary"><div><span className="live-dot"/><b>{query.data.filter(i=>i.status==='running').length} RUNNING</b><i/>{query.data.length} TOTAL INSTANCES</div><Link href="/bots" className="btn btn-primary"><Plus size={15}/> Deploy a bot</Link></div>{feedback&&<div className="inline-notice"><BadgeCheck size={16}/>{feedback}<button onClick={()=>setFeedback('')} aria-label="Dismiss"><X size={14}/></button></div>}{query.data.length? <div className="instance-list">{query.data.map((instance,index)=><InstanceCard key={instance.id} instance={instance} index={index} busy={busy} onAction={act}/>)}</div>:<div className="empty-state deployments-empty"><div className="empty-illustration"><Bot/></div><div className="page-kicker">NO DEPLOYMENTS YET</div><h3>Your first bot is one good idea away.</h3><p>Explore the catalog, find the right tool, and we’ll handle the launch.</p><Link href="/bots" className="btn btn-primary">Browse bot catalog <ArrowRight size={15}/></Link></div>}</>}</QueryState></AppShell>;
}
function InstanceCard({instance,index,busy,onAction}:{instance:BotInstance;index:number;busy:boolean;onAction:(type:'restart'|'stop'|'renew',instance:BotInstance)=>void}) {
 return <article className={`instance-card animate-rise delay-${(index%3)+1}`}><div className="instance-main"><div className={`instance-avatar instance-tone-${index%4}`}><MessageCircle size={19}/></div><div className="instance-copy"><div className="instance-title"><h3>{instance.name}</h3><Status value={instance.status}/></div><p>{instance.templateName} <i/> Created {date(instance.createdAt)}</p><div className="instance-details">{instance.phoneNumber&&<span><MessageCircle size={13}/>{instance.phoneNumber}</span>}{instance.herokuAppName&&<span><Command size={13}/>{instance.herokuAppName}</span>}{instance.errorMessage&&<span className="instance-error">{instance.errorMessage}</span>}</div></div></div><div className="instance-renew"><small>NEXT RENEWAL</small><b>{date(instance.renewalAt)}</b><span>Monthly plan</span></div><div className="instance-actions">{instance.status==='running'&&<Button variant="outline" disabled={busy} onClick={()=>onAction('restart',instance)}><RefreshCw size={14}/> Restart</Button>}{instance.status==='running'&&<Button variant="quiet" disabled={busy} onClick={()=>onAction('stop',instance)}>Stop</Button>}{(instance.status==='past_due'||instance.status==='stopped')&&<Button variant="primary" disabled={busy} onClick={()=>onAction('renew',instance)}><RefreshCw size={14}/> Renew</Button>}{(instance.status==='deploying'||instance.status==='queued')&&<span className="provisioning"><LoaderCircle size={15}/> Provisioning</span>}{instance.status==='failed'&&<Button variant="outline" disabled={busy} onClick={()=>onAction('restart',instance)}><RefreshCw size={14}/> Retry</Button>}</div></article>;
}

function ReturnPage() {
 const reference=new URLSearchParams(window.location.search).get('reference')||'';const verify=useVerifyWalletTopup({reference},{query:{enabled:!!reference,queryKey:getVerifyWalletTopupQueryKey({reference}),retry:false}});const client=useQueryClient();const invalidated=useRef(false);
 useEffect(()=>{if(verify.data&&!invalidated.current){invalidated.current=true;client.invalidateQueries({queryKey:getGetWalletQueryKey()});client.invalidateQueries({queryKey:getGetDashboardSummaryQueryKey()});}},[verify.data,client]);
 return <AppShell title="Payment result" kicker="PAYSTACK / CHECKOUT"><div className="payment-result"><div className={`result-symbol ${verify.data?.status||'pending'}`}>{verify.isLoading?<LoaderCircle className="spin"/>:verify.data?.status==='successful'?<Check/>:verify.data?.status==='failed'?<X/>:<Clock3/>}</div><div className="page-kicker">PAYMENT VERIFICATION</div><h2>{verify.isLoading?'Confirming your payment…':verify.error?'We couldn’t verify this payment':verify.data?.status==='successful'?'Funds received.':verify.data?.status==='failed'?'Payment not completed.':'Payment is still processing.'}</h2><p>{verify.isLoading?'Paystack is confirming the transaction. This can take a few seconds.':verify.error?'Your payment status could not be confirmed. You can check your wallet in a moment.':verify.data?.status==='successful'?'Your wallet has been credited and your bots are ready to keep running.':verify.data?.status==='failed'?'No funds were added to your wallet. You can try again whenever you’re ready.':'We’ll update your wallet as soon as Paystack confirms the payment.'}</p>{verify.data&&<div className="result-details"><div><span>PAYMENT AMOUNT</span><b>{money(verify.data.amountKsh)}</b></div><div><span>NEW WALLET BALANCE</span><b>{money(verify.data.walletBalanceKsh)}</b></div><div><span>TRANSACTION STATUS</span><Status value={verify.data.status}/></div></div>}{!reference&&<div className="inline-notice"><CircleHelp size={15}/> No payment reference was found in this return.</div>}<div className="result-actions"><Link href="/wallet" className="btn btn-primary">Go to wallet <ArrowRight size={15}/></Link><Link href="/dashboard" className="btn btn-outline">Back to overview</Link></div></div></AppShell>;
}

function ClerkQueryClientCacheInvalidator() {
 const {addListener}=useClerk();const client=useQueryClient();const prevUserIdRef=useRef<string|null|undefined>(undefined);
 useEffect(()=>{const unsubscribe=addListener(({user})=>{const userId=user?.id??null;if(prevUserIdRef.current!==undefined&&prevUserIdRef.current!==userId)client.clear();prevUserIdRef.current=userId;});return unsubscribe;},[addListener,client]);return null;
}
function ClerkRoutes() {
 const [,setLocation]=useLocation();
 return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{signIn:{start:{title:'Welcome back',subtitle:'Your bots have been busy.'}},signUp:{start:{title:'Build something brilliant',subtitle:'Your WhatsApp operation starts here.'}}}} routerPush={to=>setLocation(stripBase(to))} routerReplace={to=>setLocation(stripBase(to),{replace:true})}>
  <QueryClientProvider client={queryClient}><ClerkQueryClientCacheInvalidator/><PageBoundary><Switch>
   <Route path="/" component={HomeRedirect}/>
   <Route path="/sign-in/*?" component={SignInPage}/><Route path="/sign-up/*?" component={SignUpPage}/>
   <Route path="/dashboard"><Protected><OverviewPage/></Protected></Route>
   <Route path="/bots"><Protected><BotsPage/></Protected></Route>
   <Route path="/wallet"><Protected><WalletPage/></Protected></Route>
   <Route path="/instances"><Protected><InstancesPage/></Protected></Route>
   <Route path="/payments/return"><Protected><ReturnPage/></Protected></Route>
   <Route component={NotFound}/>
  </Switch></PageBoundary><Toaster/></QueryClientProvider>
 </ClerkProvider>;
}
function App() {
 return <TooltipProvider><WouterRouter base={basePath}><ClerkRoutes/></WouterRouter></TooltipProvider>;
}

export default App;
