import { Outlet } from "react-router-dom"
import ChatPanel from "@/components/agent/ChatPanel"
import ErrorBoundary from "@/components/ErrorBoundary"
import { TooltipProvider } from "@/components/ui/tooltip"
import AppNavigation from "./AppNavigation"
import TopNav from "./TopNav"
import KeyboardShortcuts from "./KeyboardShortcuts"
import MobileBottomNav from "./MobileBottomNav"
import { BreadcrumbsProvider } from "@/hooks/use-breadcrumbs"

// App shell: one navigation column on the left (rail on tablets, bottom tabs
// on phones), a slim context bar on top, and the page itself taking the rest
// of the screen. Wayfinding lives in one place instead of four.
export default function AppLayout() {
  return (
    <BreadcrumbsProvider>
      <TooltipProvider delayDuration={200}>
        <div data-app-shell className="app-surface flex h-dvh overflow-hidden">
          <a
            href="#main-content"
            className="sr-only z-50 rounded-md bg-card px-3 py-2 text-sm font-medium text-foreground shadow-md focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
          >
            Skip to content
          </a>

          <AppNavigation />

          <div className="flex min-w-0 flex-1 flex-col">
            <div data-print-hide="true">
              <TopNav />
            </div>

            <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto pb-24 outline-none md:pb-0">
              <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
                {/*
                  Per-route ErrorBoundary: scoped *inside* the layout so a
                  thrown render error in one route doesn't blank the whole
                  app — the user keeps the navigation and can move
                  away. The top-level boundary in App.tsx remains as a final
                  safety net for errors that escape this scope (e.g. bad
                  router setup, layout-level crashes).
                */}
                <ErrorBoundary>
                  <Outlet />
                </ErrorBoundary>
              </div>
            </main>
          </div>

          <ChatPanel />
          <KeyboardShortcuts />
          <MobileBottomNav />
        </div>
      </TooltipProvider>
    </BreadcrumbsProvider>
  )
}
