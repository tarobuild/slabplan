import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { Toaster } from "sonner";
import { useAuthStore } from "@/store/auth";
import api, { setAccessToken } from "@/lib/api";
import AppLayout from "@/components/layout/AppLayout";

import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import DashboardPage from "@/pages/dashboard";
import JobsPage from "@/pages/jobs";
import JobDetailPage from "@/pages/job-detail";
import LeadsPage from "@/pages/leads";
import SettingsPage from "@/pages/settings";
import NotFound from "@/pages/not-found";

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isInitialized } = useAuthStore();
  if (!isInitialized) return null;
  if (!user) return <Redirect to="/login" />;
  return (
    <AppLayout>
      <Component />
    </AppLayout>
  );
}

function PublicOnlyRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isInitialized } = useAuthStore();
  if (!isInitialized) return null;
  if (user) return <Redirect to="/dashboard" />;
  return <Component />;
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/login" component={() => <PublicOnlyRoute component={LoginPage} />} />
      <Route path="/register" component={() => <PublicOnlyRoute component={RegisterPage} />} />
      <Route path="/dashboard" component={() => <ProtectedRoute component={DashboardPage} />} />
      <Route path="/jobs/:id/files/documents" component={() => <ProtectedRoute component={JobDetailPage} />} />
      <Route path="/jobs/:id/files/photos" component={() => <ProtectedRoute component={JobDetailPage} />} />
      <Route path="/jobs/:id/files/videos" component={() => <ProtectedRoute component={JobDetailPage} />} />
      <Route path="/jobs/:id/schedule" component={() => <ProtectedRoute component={JobDetailPage} />} />
      <Route path="/jobs/:id/daily-logs" component={() => <ProtectedRoute component={JobDetailPage} />} />
      <Route path="/jobs/:id" component={() => <ProtectedRoute component={JobDetailPage} />} />
      <Route path="/jobs" component={() => <ProtectedRoute component={JobsPage} />} />
      <Route path="/sales/leads" component={() => <ProtectedRoute component={LeadsPage} />} />
      <Route path="/settings" component={() => <ProtectedRoute component={SettingsPage} />} />
      <Route path="/" component={() => <Redirect to="/dashboard" />} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  const { setAuth, clearAuth, setInitialized } = useAuthStore();

  useEffect(() => {
    api.post("/auth/refresh", {})
      .then((res) => {
        setAuth(res.data.user, res.data.accessToken);
      })
      .catch(() => {
        clearAuth();
      })
      .finally(() => {
        setInitialized();
      });
  }, []);

  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <AppRouter />
      <Toaster position="top-right" richColors closeButton duration={4000} />
    </WouterRouter>
  );
}
