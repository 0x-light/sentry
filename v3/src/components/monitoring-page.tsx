import React, { useState, useEffect, useCallback, useRef } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || 'https://sentry-api.tomaspalmeirim.workers.dev'

// ============================================================================
// TYPES
// ============================================================================

interface MonitoringData {
  generated_at: string
  users: {
    total: number; today: number; this_week: number; this_month: number
    paying: number; total_credits_outstanding: number
    recent: Array<{ email: string; name: string; credits: number; subscription: string | null; has_stripe: boolean; created_at: string }>
  }
  scans: {
    total: number; today: number; this_week: number; this_month: number
    total_tweets: number; total_signals: number; total_credits_used: number; unique_accounts: number
    top_accounts: Array<{ account: string; count: number }>
    recent: Array<{ user_email: string; accounts_count: number; accounts_list: string[]; range: string; range_days: number; tweets: number; signals: number; credits: number; created_at: string }>
  }
  revenue: {
    total_purchases: number; today: number; this_week: number; this_month: number
    total_credits_sold: number
    recent: Array<{ user_email: string; type: string; credits: number; description: string; created_at: string }>
  }
  costs: {
    all_time: CostBucket; today: CostBucket; this_week: CostBucket; this_month: CostBucket
  }
  action_breakdown: Record<string, { count: number; twitter: number; anthropic: number; total: number; input_tokens: number; output_tokens: number }>
  models: Record<string, number>
  recent_usage: Array<{ user_email: string; action: string; accounts: number; tweets: number; signals: number; input_tokens: number; output_tokens: number; cost_twitter: number; cost_anthropic: number; cost_total: number; created_at: string }>
  daily: Array<{ date: string; users: number; scans: number; cost_twitter: number; cost_anthropic: number; cost_total: number; credits_sold: number }>
}

interface CostBucket {
  twitter: number; anthropic: number; total: number; input_tokens: number; output_tokens: number; api_calls: number
}

// ============================================================================
// HELPERS
// ============================================================================

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 10_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

function fmtUsd(n: number): string {
  if (n < 0.01 && n > 0) return '<$0.01'
  return '$' + n.toFixed(2)
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toString()
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

function shortEmail(email: string): string {
  if (!email || email.length <= 24) return email
  const [local, domain] = email.split('@')
  if (local.length > 12) return local.slice(0, 10) + '…@' + domain
  return email
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function MetricCard({ title, value, sub, color = 'text-white' }: {
  title: string; value: string | number; sub?: React.ReactNode; color?: string
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="text-[11px] text-white/40 uppercase tracking-wider font-medium">{title}</div>
      <div className={`text-2xl font-semibold mt-1 tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-xs text-white/40 mt-2 space-y-0.5">{sub}</div>}
    </div>
  )
}

function SubMetric({ label, value }: { label: string; value: string | number }) {
  return <div className="flex justify-between"><span>{label}</span><span className="text-white/60 tabular-nums">{value}</span></div>
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs uppercase tracking-wider text-white/30 font-medium mt-8 mb-3 px-1">{children}</h2>
}

function MiniBar({ value, max, color = 'bg-blue-500' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="w-full h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function SparkBars({ data, dataKey, color = 'bg-blue-500' }: { data: Array<Record<string, any>>; dataKey: string; color?: string }) {
  const vals = data.map(d => d[dataKey] || 0)
  const max = Math.max(...vals, 1)
  return (
    <div className="flex items-end gap-px h-10 mt-2">
      {vals.map((v, i) => (
        <div key={i} className="flex-1 flex flex-col justify-end" title={`${data[i]?.date}: ${typeof v === 'number' && v < 1 ? fmtUsd(v) : v}`}>
          <div
            className={`w-full rounded-t-sm ${color} transition-all min-h-[1px]`}
            style={{ height: `${Math.max((v / max) * 100, v > 0 ? 4 : 0)}%` }}
          />
        </div>
      ))}
    </div>
  )
}

function DataTable({ headers, rows, emptyText = 'No data' }: {
  headers: string[]; rows: React.ReactNode[][]; emptyText?: string
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-white/[0.06]">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/[0.06]">
            {headers.map((h, i) => (
              <th key={i} className="text-left text-white/30 uppercase tracking-wider font-medium px-3 py-2.5 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={headers.length} className="px-3 py-6 text-center text-white/20">{emptyText}</td></tr>
          ) : (
            rows.map((row, ri) => (
              <tr key={ri} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                {row.map((cell, ci) => (
                  <td key={ci} className="px-3 py-2 whitespace-nowrap text-white/70">{cell}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function MonitoringPage() {
  const [secret, setSecret] = useState(() => localStorage.getItem('sentry_admin_secret') || '')
  const [secretInput, setSecretInput] = useState('')
  const [data, setData] = useState<MonitoringData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const intervalRef = useRef<number | null>(null)

  const fetchData = useCallback(async (s?: string) => {
    const key = s || secret
    if (!key) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/api/admin/monitoring?secret=${encodeURIComponent(key)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setData(json)
      setLastRefresh(new Date())
      localStorage.setItem('sentry_admin_secret', key)
      if (!secret) setSecret(key)
    } catch (e: any) {
      setError(e.message || 'Failed to fetch')
      if (e.message?.includes('Unauthorized')) {
        localStorage.removeItem('sentry_admin_secret')
        setSecret('')
      }
    } finally {
      setLoading(false)
    }
  }, [secret])

  // Read secret from URL param on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlSecret = params.get('secret')
    if (urlSecret) {
      setSecret(urlSecret)
      localStorage.setItem('sentry_admin_secret', urlSecret)
      window.history.replaceState({}, '', '/monitoring')
      fetchData(urlSecret)
    } else if (secret) {
      fetchData(secret)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-refresh every 30s
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (autoRefresh && secret) {
      intervalRef.current = window.setInterval(() => fetchData(), 30000)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [autoRefresh, secret, fetchData])

  // ----- LOGIN SCREEN -----
  if (!secret) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center font-mono">
        <div className="w-full max-w-sm p-6">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-2 h-3 bg-white rounded-[2px]" />
            <span className="text-sm tracking-tight">sentry monitoring</span>
          </div>
          {error && <div className="text-red-400 text-xs mb-4 p-2 rounded bg-red-500/10 border border-red-500/20">{error}</div>}
          <form onSubmit={(e) => { e.preventDefault(); fetchData(secretInput) }}>
            <label className="text-[11px] text-white/40 uppercase tracking-wider block mb-1.5">Admin Secret</label>
            <input
              type="password"
              value={secretInput}
              onChange={(e) => setSecretInput(e.target.value)}
              placeholder="Enter admin secret..."
              autoFocus
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors"
            />
            <button
              type="submit"
              disabled={!secretInput || loading}
              className="w-full mt-3 bg-white text-black text-sm font-medium py-2.5 rounded-lg hover:bg-white/90 transition-colors disabled:opacity-40"
            >
              {loading ? 'Connecting...' : 'Connect'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ----- DASHBOARD -----
  const d = data

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-mono">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#0a0a0a]/90 backdrop-blur border-b border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-12 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-3 bg-white rounded-[2px]" />
            <span className="text-sm tracking-tight">sentry monitoring</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-white/40">
            {lastRefresh && (
              <span>updated {lastRefresh.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</span>
            )}
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`px-2 py-1 rounded transition-colors ${autoRefresh ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-white/[0.04] text-white/40 border border-white/[0.06]'}`}
            >
              {autoRefresh ? '● live' : '○ paused'}
            </button>
            <button
              onClick={() => fetchData()}
              disabled={loading}
              className="px-2 py-1 rounded bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] transition-colors disabled:opacity-40"
            >
              {loading ? '↻' : '↻ refresh'}
            </button>
            <button
              onClick={() => { setSecret(''); setData(null); localStorage.removeItem('sentry_admin_secret') }}
              className="px-2 py-1 rounded bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] transition-colors"
            >
              logout
            </button>
          </div>
        </div>
      </div>

      {error && <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-4"><div className="text-red-400 text-xs p-3 rounded-lg bg-red-500/10 border border-red-500/20">{error}</div></div>}

      {!d ? (
        <div className="flex items-center justify-center h-64 text-white/20 text-sm">
          {loading ? 'Loading dashboard...' : 'No data'}
        </div>
      ) : (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-1">

          {/* ======== SUMMARY CARDS ======== */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard
              title="Users"
              value={fmt(d.users.total)}
              color="text-white"
              sub={<>
                <SubMetric label="today" value={`+${d.users.today}`} />
                <SubMetric label="7 days" value={`+${d.users.this_week}`} />
                <SubMetric label="30 days" value={`+${d.users.this_month}`} />
                <SubMetric label="paying" value={d.users.paying} />
              </>}
            />
            <MetricCard
              title="Scans"
              value={fmt(d.scans.total)}
              color="text-blue-400"
              sub={<>
                <SubMetric label="today" value={`+${d.scans.today}`} />
                <SubMetric label="7 days" value={`+${d.scans.this_week}`} />
                <SubMetric label="30 days" value={`+${d.scans.this_month}`} />
                <SubMetric label="unique accts" value={fmt(d.scans.unique_accounts)} />
              </>}
            />
            <MetricCard
              title="Revenue"
              value={`${fmt(d.revenue.total_credits_sold)} cr`}
              color="text-green-400"
              sub={<>
                <SubMetric label="purchases" value={d.revenue.total_purchases} />
                <SubMetric label="today" value={`+${d.revenue.today}`} />
                <SubMetric label="7 days" value={`+${d.revenue.this_week}`} />
                <SubMetric label="30 days" value={`+${d.revenue.this_month}`} />
              </>}
            />
            <MetricCard
              title="My Cost"
              value={fmtUsd(d.costs.all_time.total)}
              color="text-red-400"
              sub={<>
                <SubMetric label="today" value={fmtUsd(d.costs.today.total)} />
                <SubMetric label="7 days" value={fmtUsd(d.costs.this_week.total)} />
                <SubMetric label="30 days" value={fmtUsd(d.costs.this_month.total)} />
                <SubMetric label="API calls" value={fmt(d.costs.all_time.api_calls)} />
              </>}
            />
          </div>

          {/* ======== COST BREAKDOWN ======== */}
          <SectionTitle>Cost Breakdown</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <MetricCard
              title="Twitter API"
              value={fmtUsd(d.costs.all_time.twitter)}
              color="text-sky-400"
              sub={<>
                <SubMetric label="today" value={fmtUsd(d.costs.today.twitter)} />
                <SubMetric label="7 days" value={fmtUsd(d.costs.this_week.twitter)} />
                <SubMetric label="30 days" value={fmtUsd(d.costs.this_month.twitter)} />
              </>}
            />
            <MetricCard
              title="Anthropic API"
              value={fmtUsd(d.costs.all_time.anthropic)}
              color="text-purple-400"
              sub={<>
                <SubMetric label="today" value={fmtUsd(d.costs.today.anthropic)} />
                <SubMetric label="7 days" value={fmtUsd(d.costs.this_week.anthropic)} />
                <SubMetric label="30 days" value={fmtUsd(d.costs.this_month.anthropic)} />
              </>}
            />
            <MetricCard
              title="Tokens Used"
              value={fmtTokens(d.costs.all_time.input_tokens + d.costs.all_time.output_tokens)}
              color="text-amber-400"
              sub={<>
                <SubMetric label="input" value={fmtTokens(d.costs.all_time.input_tokens)} />
                <SubMetric label="output" value={fmtTokens(d.costs.all_time.output_tokens)} />
                <SubMetric label="tweets analyzed" value={fmt(d.scans.total_tweets)} />
                <SubMetric label="signals found" value={fmt(d.scans.total_signals)} />
              </>}
            />
          </div>

          {/* ======== DAILY SPARKLINES ======== */}
          <SectionTitle>Last 30 Days</SectionTitle>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="text-[11px] text-white/40 uppercase tracking-wider font-medium">New Users / Day</div>
              <SparkBars data={d.daily} dataKey="users" color="bg-white/60" />
              <div className="flex justify-between text-[10px] text-white/20 mt-1">
                <span>{d.daily[0]?.date?.slice(5)}</span><span>{d.daily[d.daily.length - 1]?.date?.slice(5)}</span>
              </div>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="text-[11px] text-white/40 uppercase tracking-wider font-medium">Scans / Day</div>
              <SparkBars data={d.daily} dataKey="scans" color="bg-blue-500/70" />
              <div className="flex justify-between text-[10px] text-white/20 mt-1">
                <span>{d.daily[0]?.date?.slice(5)}</span><span>{d.daily[d.daily.length - 1]?.date?.slice(5)}</span>
              </div>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="text-[11px] text-white/40 uppercase tracking-wider font-medium">Cost / Day</div>
              <SparkBars data={d.daily} dataKey="cost_total" color="bg-red-500/70" />
              <div className="flex justify-between text-[10px] text-white/20 mt-1">
                <span>{d.daily[0]?.date?.slice(5)}</span><span>{d.daily[d.daily.length - 1]?.date?.slice(5)}</span>
              </div>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="text-[11px] text-white/40 uppercase tracking-wider font-medium">Credits Sold / Day</div>
              <SparkBars data={d.daily} dataKey="credits_sold" color="bg-green-500/70" />
              <div className="flex justify-between text-[10px] text-white/20 mt-1">
                <span>{d.daily[0]?.date?.slice(5)}</span><span>{d.daily[d.daily.length - 1]?.date?.slice(5)}</span>
              </div>
            </div>
          </div>

          {/* ======== USAGE BY ACTION ======== */}
          <SectionTitle>Usage by Action</SectionTitle>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="space-y-3">
              {Object.entries(d.action_breakdown).sort((a, b) => b[1].count - a[1].count).map(([action, ab]) => {
                const maxCount = Math.max(...Object.values(d.action_breakdown).map(a => a.count))
                return (
                  <div key={action}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-white/70 font-medium">{action}</span>
                      <span className="text-white/40 tabular-nums">
                        {fmt(ab.count)} calls · {fmtUsd(ab.total)}
                        {ab.input_tokens > 0 && ` · ${fmtTokens(ab.input_tokens + ab.output_tokens)} tok`}
                      </span>
                    </div>
                    <MiniBar value={ab.count} max={maxCount} color="bg-blue-500/50" />
                  </div>
                )
              })}
            </div>
          </div>

          {/* ======== MODEL DISTRIBUTION ======== */}
          <SectionTitle>Model Distribution (User Preferences)</SectionTitle>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="space-y-3">
              {Object.entries(d.models).sort((a, b) => b[1] - a[1]).map(([model, count]) => {
                const totalUsers = Object.values(d.models).reduce((s, c) => s + c, 0)
                const pct = totalUsers > 0 ? ((count / totalUsers) * 100).toFixed(0) : '0'
                const tier = model.toLowerCase().includes('haiku') ? 'bg-emerald-500/50' : model.toLowerCase().includes('opus') ? 'bg-purple-500/50' : 'bg-blue-500/50'
                return (
                  <div key={model}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-white/70 font-medium">{model}</span>
                      <span className="text-white/40 tabular-nums">{count} users · {pct}%</span>
                    </div>
                    <MiniBar value={count} max={Math.max(...Object.values(d.models))} color={tier} />
                  </div>
                )
              })}
              {Object.keys(d.models).length === 0 && <div className="text-white/20 text-xs">No model data</div>}
            </div>
          </div>

          {/* ======== TOP SCANNED ACCOUNTS ======== */}
          <SectionTitle>Top Scanned Accounts</SectionTitle>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="flex flex-wrap gap-2">
              {d.scans.top_accounts.slice(0, 40).map(({ account, count }) => (
                <span key={account} className="inline-flex items-center gap-1 text-xs bg-white/[0.04] border border-white/[0.06] rounded px-2 py-1">
                  <span className="text-white/60">@{account}</span>
                  <span className="text-white/30 tabular-nums">{count}</span>
                </span>
              ))}
              {d.scans.top_accounts.length === 0 && <div className="text-white/20 text-xs">No scan data</div>}
            </div>
          </div>

          {/* ======== RECENT SIGNUPS ======== */}
          <SectionTitle>Recent Signups</SectionTitle>
          <DataTable
            headers={['Email', 'Name', 'Credits', 'Subscription', 'Stripe', 'Joined']}
            rows={d.users.recent.map(u => [
              <span className="font-medium text-white/90">{shortEmail(u.email)}</span>,
              u.name || <span className="text-white/20">—</span>,
              <span className="tabular-nums">{fmt(u.credits)}</span>,
              u.subscription ? <span className={`px-1.5 py-0.5 rounded text-[10px] ${u.subscription === 'active' ? 'bg-green-500/10 text-green-400' : 'bg-white/[0.04] text-white/40'}`}>{u.subscription}</span> : <span className="text-white/20">—</span>,
              u.has_stripe ? <span className="text-green-400">✓</span> : <span className="text-white/20">—</span>,
              <span className="text-white/40">{timeAgo(u.created_at)}</span>,
            ])}
          />

          {/* ======== RECENT PAYMENTS ======== */}
          <SectionTitle>Recent Payments</SectionTitle>
          <DataTable
            headers={['User', 'Type', 'Credits', 'Description', 'Date']}
            rows={d.revenue.recent.map(p => [
              <span className="font-medium text-white/90">{shortEmail(p.user_email)}</span>,
              <span className={`px-1.5 py-0.5 rounded text-[10px] ${p.type === 'recurring' ? 'bg-purple-500/10 text-purple-400' : 'bg-green-500/10 text-green-400'}`}>{p.type}</span>,
              <span className="tabular-nums text-green-400">+{fmt(p.credits)}</span>,
              <span className="text-white/50 max-w-[200px] truncate block">{p.description}</span>,
              <span className="text-white/40">{timeAgo(p.created_at)}</span>,
            ])}
            emptyText="No payments yet"
          />

          {/* ======== RECENT SCANS ======== */}
          <SectionTitle>Recent Scans</SectionTitle>
          <DataTable
            headers={['User', 'Accounts', 'Range', 'Tweets', 'Signals', 'Credits', 'Date']}
            rows={d.scans.recent.map(s => [
              <span className="font-medium text-white/90">{shortEmail(s.user_email)}</span>,
              <span className="tabular-nums">{s.accounts_count} <span className="text-white/30">{s.accounts_list.length > 0 ? `(${s.accounts_list.slice(0, 3).join(', ')}${s.accounts_count > 3 ? '…' : ''})` : ''}</span></span>,
              <span>{s.range || `${s.range_days}d`}</span>,
              <span className="tabular-nums">{fmt(s.tweets)}</span>,
              <span className="tabular-nums text-blue-400">{s.signals}</span>,
              <span className="tabular-nums text-amber-400">{s.credits}</span>,
              <span className="text-white/40">{timeAgo(s.created_at)}</span>,
            ])}
          />

          {/* ======== RECENT USAGE LOG ======== */}
          <SectionTitle>Recent API Usage</SectionTitle>
          <DataTable
            headers={['User', 'Action', 'Accts', 'Tweets', 'Twitter$', 'Claude$', 'Tokens', 'Date']}
            rows={d.recent_usage.map(u => [
              <span className="text-white/70">{shortEmail(u.user_email)}</span>,
              <span className={`text-xs ${u.action === 'analyze' ? 'text-purple-400' : u.action.includes('tweet') ? 'text-sky-400' : 'text-white/60'}`}>{u.action}</span>,
              <span className="tabular-nums">{u.accounts || <span className="text-white/20">—</span>}</span>,
              <span className="tabular-nums">{u.tweets || <span className="text-white/20">—</span>}</span>,
              <span className="tabular-nums text-sky-400">{u.cost_twitter > 0 ? fmtUsd(u.cost_twitter) : <span className="text-white/15">—</span>}</span>,
              <span className="tabular-nums text-purple-400">{u.cost_anthropic > 0 ? fmtUsd(u.cost_anthropic) : <span className="text-white/15">—</span>}</span>,
              <span className="tabular-nums text-white/40">{(u.input_tokens + u.output_tokens) > 0 ? fmtTokens(u.input_tokens + u.output_tokens) : <span className="text-white/15">—</span>}</span>,
              <span className="text-white/40">{timeAgo(u.created_at)}</span>,
            ])}
          />

          {/* ======== FOOTER ======== */}
          <div className="text-center text-white/15 text-[10px] py-8">
            sentry monitoring · data generated {d.generated_at ? fmtDate(d.generated_at) : '—'} · auto-refresh {autoRefresh ? 'on (30s)' : 'off'}
          </div>
        </div>
      )}
    </div>
  )
}
