import { Outlet } from "react-router-dom"
import Sidebar from "./Sidebar"
import TopNav from "./TopNav"

export default function AppLayout() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#F9FAFB]">
      <div data-print-hide="true">
        <TopNav />
      </div>

      <div className="flex flex-1 overflow-hidden">
        <aside
          data-print-hide="true"
          className="hidden w-56 shrink-0 overflow-hidden lg:flex lg:flex-col"
        >
          <Sidebar />
        </aside>

        <main className="flex-1 overflow-y-auto">
          <div className="p-4 lg:p-5">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
