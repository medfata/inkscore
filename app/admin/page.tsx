"use client";

import Link from 'next/link';
import { AdminGate, ChevronRightIcon, KeyIcon, ServerIcon } from './admin-ui';

/**
 * Admin landing: wallet-gated (same flow as /admin/points) with a minimal nav
 * menu to the admin sub-pages. The old tabbed dashboard is deprecated.
 */
export default function AdminPage() {
  return (
    <AdminGate>
      {({ address }) => (
        <div className="min-h-screen bg-[#0a0a0f] text-white">
          <div className="w-full px-5 sm:px-8 lg:px-12 2xl:px-20 py-8 sm:py-12">
            {/* Header */}
            <header className="animate-fade-in-up mb-7 sm:mb-9">
              <h1 className="text-[28px] sm:text-[34px] leading-tight font-semibold tracking-[-0.02em]">
                Admin
              </h1>
              <p className="mt-1 text-[15px] text-[#98989d]">
                Signed in as <span className="font-mono text-white/60">{address.slice(0, 6)}…{address.slice(-4)}</span>
              </p>
            </header>

            {/* Nav menu */}
            <nav className="grid gap-4 sm:grid-cols-2 max-w-3xl">
              <Link
                href="/admin/points"
                className="animate-fade-in-up group rounded-2xl bg-[#1c1c1e] p-6 transition-colors hover:bg-[#242426]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.07] text-[#0a84ff]">
                    <KeyIcon className="h-6 w-6" />
                  </div>
                  <ChevronRightIcon className="h-5 w-5 text-white/25 transition-transform group-hover:translate-x-0.5 group-hover:text-white/50" />
                </div>
                <h2 className="mt-5 text-[19px] font-semibold tracking-[-0.01em]">Points Bonus</h2>
                <p className="mt-1.5 text-[14px] leading-relaxed text-[#98989d]">
                  Global and per-wallet bonus points added on top of activity scores.
                </p>
              </Link>

              <Link
                href="/admin/proxies"
                className="animate-fade-in-up group rounded-2xl bg-[#1c1c1e] p-6 transition-colors hover:bg-[#242426]"
                style={{ animationDelay: '80ms' }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.07] text-[#30d158]">
                    <ServerIcon className="h-6 w-6" />
                  </div>
                  <ChevronRightIcon className="h-5 w-5 text-white/25 transition-transform group-hover:translate-x-0.5 group-hover:text-white/50" />
                </div>
                <h2 className="mt-5 text-[19px] font-semibold tracking-[-0.01em]">Proxy Pool</h2>
                <p className="mt-1.5 text-[14px] leading-relaxed text-[#98989d]">
                  ProxyScrape API keys, bandwidth, and the egress IP pool for wallet metrics.
                </p>
              </Link>
            </nav>
          </div>
        </div>
      )}
    </AdminGate>
  );
}
