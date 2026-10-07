/// <reference types="vite/client" />

import zhCN from '@astryxdesign/core/locales/zh-CN.json'
import { InternationalizationProvider } from '@astryxdesign/core/i18n'
import { Theme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral/built'
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { AppShell } from '~/components/AppShell'
import { SessionProvider } from '~/features/session/session'
import '~/styles/app.css'

export const Route = createRootRoute({
  head: () => ({
    links: [
      { rel: 'icon', type: 'image/png', href: '/site-icon.png' },
      { rel: 'apple-touch-icon', href: '/site-icon.png' },
    ],
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: '乡建 DAO' },
      {
        name: 'description',
        content: '连接乡村、社区与共建行动。',
      },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <Theme theme={neutralTheme} mode="light">
        <InternationalizationProvider locale="zh-CN" messages={{ 'zh-CN': zhCN }}>
          <SessionProvider>
            <AppShell>
              <Outlet />
            </AppShell>
          </SessionProvider>
        </InternationalizationProvider>
      </Theme>
    </RootDocument>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" data-theme="light">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
