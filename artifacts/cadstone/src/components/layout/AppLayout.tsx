import { Outlet } from "react-router-dom"
import ChatPanel from "@/components/agent/ChatPanel"
import ErrorBoundary from "@/components/ErrorBoundary"
import Sidebar from "./Sidebar"
import TopNav from "./TopNav"
import KeyboardShortcuts from "./KeyboardShortcuts"
import Breadcrumbs from "./Breadcrumbs"
import MobileBottomNav from "./MobileBottomNav"
import { BreadcrumbsProvider } from "@/hooks/use-breadcrumbs"

export default function AppLayout() {
  return (
    <BreadcrumbsProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-[#F9FAFB]">
        <div data-print-hide="true">
          <TopNav />
          <Breadcrumbs />
        </div>

        <div className="flex flex-1 overflow-hidden">
          <aside
            data-print-hide="true"
            className="hidden w-56 shrink-0 overflow-hidden lg:flex lg:flex-col"
          >
            <Sidebar />
          </aside>

          <main className="flex-1 overflow-y-auto pb-20 md:pb-0">
            <div className="p-4 lg:p-5">
              {/*
                Per-route ErrorBoundary: scoped *inside* the layout so a
                thrown render error in one route doesn't blank the whole
                app — the user keeps the TopNav + Sidebar and can navigate
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
    </BreadcrumbsProvider>
  )
}
