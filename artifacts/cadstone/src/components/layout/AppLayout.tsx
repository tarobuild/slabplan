import { Outlet } from "react-router-dom"
import Sidebar from "./Sidebar"
import TopNav from "./TopNav"

export default function AppLayout() {
  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <div data-print-hide="true">
        <TopNav />
      </div>
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-[1600px]">
        <aside data-print-hide="true" className="hidden w-72 shrink-0 lg:block">
          <Sidebar />
        </aside>
        <main className="flex-1 p-4 lg:p-6">
          <div data-print-hide="true" className="mb-4 lg:hidden">
            <Sidebar mobile />
          </div>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
